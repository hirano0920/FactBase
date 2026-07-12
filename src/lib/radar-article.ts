/**
 * TwoSides Radar — 記事生成の共有ロジック（主筆: Grok 4.3）。
 * scripts/radar/promote.ts（本番）および summarize/followup（手動・レガシー）から使う。
 *
 * 記事の使命: スプリットスレッド（賛否討論）の導火線＝共通事実 + 対立軸。
 * 名誉毀損・出鱈目要約を構造的に防ぐ設計は維持:
 *   - 入力は見出し・URL、官公庁/報道本文抜粋、国会会議録・法令・Wikipedia背景
 *   - 報道は「〜と報じられています」形式。公式は一次資料の範囲のみ事実可
 *   - 断定表現の機械チェック → 引っかかったら公開せずHELD
 *
 * 構成の優先順位: 共通事実 →（媒体差があれば）比較 → 背景（あれば）→ 対立の軸 → 賛否理由（厚め）→ 出典。
 * 「時系列」は日付を跨いだ変遷がある争点だけ挿入（isTimelineWorthy）。
 *
 * 検証ループ（generateVerifiedArticle）:
 *   執筆（記事モデル）と検証（nano）を別プロセスに分離する。同じモデルに書かせて同じモデルに
 *   自己採点させると、検索・幻覚のどちらが紛れ込んでも自己承認してしまう循環になるため。
 *   1. Writer: articleHtmlに加え、資料に基づく主張を claims:[{text, sourceUrl}] としてタグ付けさせる
 *   2. Verify: 各claimについて「そのsourceUrlの資料抜粋に本当に書かれているか」をnanoの独立呼び出しで
 *      閉じたyes/no判定（src/lib/ai.ts の verifyClaimsAgainstSources）。sourceUrlが与えた資料に
 *      存在しない場合は機械的に即不合格（nano呼び出し不要）
 *   3. 網羅性チェック: claimsはWriterの自己申告なので、タグ付け漏れ（意図的・非意図的問わず）を
 *      articleHtml全文の直接スキャンで補う。数量的事実（金額・割合・件数等）と<strong>強調箇所を
 *      機械抽出し、資料本文のどこにも見つからなければ不合格にする（nano不要・0円）
 *   4. 不合格の項目があれば、具体的な理由をWriterに差し戻して再生成（最大2回）
 *   5. それでも解消しない場合はHELD相当として呼び出し側に伝える（callsite側でTopicCandidate.statusを更新）
 */
import { AI_MODELS, SITE } from "@/lib/constants";
import { createArticleClient, resolveArticleModel } from "@/lib/openai-client";
import { verifyClaimsAgainstSources, type ClaimToVerify } from "@/lib/ai";
import {
  debateTypeArticleHint,
  debateTypeBulletsSpec,
  type DebateType,
} from "@/lib/debate-type";

const SYSTEM = `あなたは${SITE.name}の編集デスクです。

# この記事の目的（最重要）
スプリットスレッドで議論する人に、中立な共通土台を「最低限」渡すことです。
長文のまとめ記事でも、偏向報道でも、百科事典でもありません。
読者がすぐ自分の立場を取れるよう、確認できる事実と、対立する両側の論点だけを渡します。

# 絶対ルール（法的リスク回避・厳守）
- 与えられた見出し・一次資料抜粋・報道抜粋に書かれていること以外を書かない。憶測・記憶での補完は禁止
- 報道は事実として断定しない。「〜と○○が報じています」「〜と伝えられています」形式
  （悪い例:「日銀は金利を引き上げました」「フジがハラスメントと認定しました」）
  （良い例:「朝日新聞は、日銀が金利を引き上げたと報じています」）
- 例外1: 一次資料抜粋は「〜と発表されています」「法案は〜を定めています」と書いてよい
- 例外2: 報道抜粋は媒体名付き帰属のみ。複数媒体なら一致点と食い違いを比較。差が無ければ無理に作らない
- 例外3: 国会会議録は発言者名付きで引用してよい
- 例外4: Wikipediaは本件固有の経緯が補えるときだけ。『○○とは…』の辞書定義は禁止。使えなければセクション省略
- 例外5: 関連法令は抜粋の範囲内のみ。無ければセクション省略（「資料にありません」禁止）
- 世論調査は数値があるときだけ。無ければ省略（「数値はありません」禁止）
- 「違法」「有罪」「汚職」「犯罪」を事実断定しない。個人評価（「悪質」等）も書かない
- 抜粋にない固有名詞・数値・日付を書かない。抜粋が無いとき具体数値は書かない
- 数値は抜粋の表記をそのまま使う。leadで「A円からB円台」のように矛盾して読める並べ方をしない
- leadは「いま何が論点か」（またはOFFICIALの「いま分かっていること」）と同一内容にする。短い別要約を作らない
- leadに「報道ベースで真偽未確認」等の定型ラベルを付けない

# 何を書くか（最低限）
1. いま何が論点か — 冒頭3〜4文。①報道・公式が「何を」言ったか（具体的内容を先に）②経緯③反応と対立軸
2. どこで意見が分かれるか — 両側の立場を1行ずつ
3. 両側の主張（最重要・同じ分量）。①で書いた事実の再掲禁止。理由・反論・論点だけ
4. 各社の差 — 冒頭と重複する事実の再掲禁止。論調の違い・追加情報のみ
5. 背景・法令は点火に必要なら短く
6. まだ分からないこと（短く）

# 両側の見せ方（視覚的にも内容的にも対になる）
- 政策: 「賛成側が言うこと」「反対側が言うこと」
- 声明対立・ゴシップの当事者対立: 当事者名で揃える（「批判・告発側が言うこと」「本人・事務所側が言うこと」）
  「賛成＝被害者／反対＝本人」の無理当て禁止。片方のリストに反対側の応援を混ぜない
- 戦争・外交・国際対立: 実在する陣営・立場名で揃える（例:「停戦を急ぐ側」「軍事圧力を優先する側」）
- 両側とも各3〜4項目。一方だけ厚くしない。教科書的一般論で埋めない

# 国内主／海外主の使い分け
- 国内が主戦場の争点（国内政治・社会炎上・国内経済など）:
  国内報道だけで書く。海外の類似事例・数字を時系列や賛否に混ぜない。
  「海外ではどう報じられているか」は、海外報道抜粋が与えられていない限り出さない
- 海外が主戦場の争点（戦争・外交・米中など）:
  海外報道抜粋があれば使い、国内報道との違いが分かるときだけ比較する

# claims（機械検証用）
具体的事実だけを {"text":"60字以内","sourceUrl":"与えられた抜粋URL"} で列挙。
論点・判断・見出しのみソースは対象外。URL捏造禁止。

# 文体・見出し（わかりやすい文章の一般的な原則を反映）
- です・ます。1文60字以内。感嘆符なし。煽り・釣り禁止
- 箇条書き中心。長い段落禁止。まとめサイト口調・絵文字禁止
- 見出しは会話に入りやすい言葉（「いま何が論点か」「賛成側が言うこと」）
- <strong>は事実トークン（数字・固有名詞）のみ。観点ラベル自体を囲まない
- 官公庁的な言い回し（「〜に鑑み」「〜と存じます」「〜を踏まえ」等）を避け、話し言葉に近い平易な言葉を使う
- 「〜性」「〜化」「〜的」を多用した硬い体言止めより、動詞で言い切る文を優先する
- 各箇条書きは結論を先に書いてから理由・詳細を続ける（結論ファースト。「なぜなら」の説明から書き始めない）`;

export interface ArticleClaim {
  text: string;
  sourceUrl: string;
}

export interface ArticleJson {
  lead: string;
  bullets: string[];
  articleHtml: string;
  /** 続報反映時のみ: 前回からの変化点を1文で（タイムライン表示用）。初回生成時は空文字でよい */
  followUpNote?: string;
  /** 機械検証（generateVerifiedArticle）用。articleHtml内の具体的事実と根拠URLのペア */
  claims?: ArticleClaim[];
}

const BANNED_PATTERNS = [
  /(?<!と報じられて)(?<!との報道が)(?:は|が)(?:違法|有罪|汚職|犯罪)(?:だ|である|です)/,
  /間違いな[いく]/,
  /確実に(?:違法|不正|犯罪)/,
];

export function violatesBan(article: ArticleJson): string | null {
  const all = `${article.lead} ${article.bullets.join(" ")} ${article.articleHtml} ${article.followUpNote ?? ""}`;
  for (const p of BANNED_PATTERNS) {
    const m = all.match(p);
    if (m) return m[0];
  }
  return null;
}

export interface PrimaryExcerptInput {
  title: string;
  url: string;
  text: string;
}

export interface ReportExcerptInput {
  feed: string;
  title: string;
  url: string;
  text: string;
}

export interface DietSpeechInput {
  date: string;
  house: string;
  meeting: string;
  speaker: string;
  snippet: string;
  url: string;
}

export interface BackgroundInput {
  title: string;
  extract: string;
  url: string;
}

export interface LawArticleSnippetInput {
  position: string;
  text: string;
}

export interface LawInfoInput {
  lawTitle: string;
  lawNum: string;
  promulgationDate: string;
  repealStatus: string;
  url: string;
  articleSnippets?: LawArticleSnippetInput[];
}

export interface GenerateArticleParams {
  issueTitle: string;
  isReported: boolean;
  sources: { title: string; url: string; feed: string; publishedAt?: string }[];
  /** 公式ページ本文の抜粋（OFFICIAL争点のみ）。見出しだけでは書けない実質のある内容を書くための材料 */
  primaryExcerpts?: PrimaryExcerptInput[];
  /** 報道機関ページ本文の抜粋（REPORTED争点のみ）。媒体間の論調の一致・食い違いを整理するための材料 */
  reportExcerpts?: ReportExcerptInput[];
  /** 海外/英字メディアページ本文の抜粋。国内報道との論調比較（国内外の報道比較）の材料 */
  internationalReportExcerpts?: ReportExcerptInput[];
  /** 世論調査結果を報じた記事本文の抜粋。数値がある場合のみ「世論の受け止め」で引用 */
  pollingExcerpts?: ReportExcerptInput[];
  /**
   * 媒体横断の主張diff（一致点/食い違い/単独媒体限定）を整形済みテキストで渡す（claim-diff.ts生成）。
   * 呼び出し側（detect.ts/promote.ts）が事前に1回だけ計算し、再試行ループでは使い回す。
   */
  claimDiffBlock?: string;
  /** 国会での関連発言（発言者・日付付き）。審議の時系列を組み立てる材料 */
  dietSpeeches?: DietSpeechInput[];
  /** 争点の一般的な背景解説（Wikipedia）。最新事実の裏付けには使わない */
  background?: BackgroundInput | null;
  /** 関連法令（e-Gov検索結果）。条文本文までは無く、存在レベルの事実としてのみ使う */
  laws?: LawInfoInput[];
  /** e-Stat政府統計（経済系トピックで数値の一次情報として使う） */
  estatStats?: { statsName: string; govOrg: string; statsDataUrl: string; surveyDate: string }[];
  /** 続報再生成時のみ渡す。前回のまとめとの継続性を保たせる */
  previousArticle?: { lead: string; articleHtml: string };
  /**
   * generateVerifiedArticle の再生成ループ専用。前回出力のclaimsが検証で不合格になった理由を
   * 具体的に渡し、該当箇所の削除・修正を指示する。通常のgenerateArticle単体呼び出しでは使わない
   */
  revisionFeedback?: string[];
  /** TwoSides 争点タイプ。記事テンプレの両側見出し・書き方を分岐する */
  debateType?: DebateType | null;
  /** policy のスローバーン再燃 */
  reignite?: boolean;
}

/**
 * OFFICIAL向け。冒頭で「何が決まったか」→ 対立の両側を厚く。
 * 見出しは会話に入りやすい言葉。空セクションは出さない。
 */
const OFFICIAL_FORMAT = `<h2>いま分かっていること</h2>
      争点の性質に合う1パターンを選び、<ul><li><strong>観点語:</strong> 内容</li></ul>の3項目。
      - 法案・条例: <ul><li><strong>何が変わる:</strong> …</li><li><strong>なぜ今:</strong> …</li><li><strong>誰に影響:</strong> …</li></ul>
      - 判決・司法判断: <ul><li><strong>何が確定した:</strong> …</li><li><strong>法的根拠:</strong> …</li><li><strong>今後への影響:</strong> …</li></ul>
      - 金融政策・経済指標: <ul><li><strong>何を決めたか:</strong> …</li><li><strong>理由:</strong> …</li><li><strong>暮らし・市場への影響:</strong> …</li></ul>
      - 事件・災害の公式発表: <ul><li><strong>何が起きたか:</strong> …</li><li><strong>被害・対応:</strong> …</li><li><strong>これから:</strong> …</li></ul>
      - 要人の声明・人事: <ul><li><strong>何が起きたか:</strong> …</li><li><strong>経緯:</strong> …</li><li><strong>これから:</strong> …</li></ul>
      分からない項目は「一次資料からは確認できない」と書く
    <h2>背景</h2><ul><li>…</li></ul>（国会会議録またはWikipediaで本件固有の経緯が補える場合のみ。辞書定義は禁止。使えなければ省略）
    <h2>法律ではどうなっているか</h2><ul><li>…</li></ul>（関連法令の抜粋がある場合のみ。無ければ省略。「資料にありません」禁止）
    <h2>海外ではどう報じられているか</h2><ul><li><strong>共通:</strong> …</li><li><strong>国内:</strong> …</li><li><strong>海外:</strong> …</li></ul>
      （海外報道抜粋があり、海外が主戦場または意味ある差がある場合のみ。国内主なら省略）
    <h2>どこで意見が分かれるか</h2><ul><li><strong>立場A:</strong> …</li><li><strong>立場B:</strong> …</li></ul>
      （資料の言い分だけ。両側が対になるラベル。与党/野党固定はしない。
      立場が分かれない争点はこのセクションを省略）
    <h2>賛成側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
    <h2>反対側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
      （声明対立なら h2 を当事者名に置き換える。各3〜4項目・同じ分量。具体点から。一般論禁止。
      天災の公式発表など一方の立場が無い場合のみ両セクション省略可）
    <h2>数字で見る世論</h2><ul><li>…</li></ul>（世論調査の数値がある場合のみ。無ければ省略）
    <h2>まだ分からないこと</h2><ul><li>…</li></ul>（未確定点を1〜3項目）
    <h2>出典</h2><ul><li><a href>…</a></li></ul>（与えられたURLのみ）`;

/**
 * REPORTED向け。導火線優先・見出しは読みたくなる言葉。
 * 空セクション・プレースホルダ・他国混入・一般論賛否を禁止。
 */
const REPORTED_FORMAT = `<h2>いま何が論点か</h2><p>3〜4文。必ずこの順序で書く:
      ① 何が報じられたか — 媒体名付き（「週刊文春は〜と報じています」）。報道の具体的内容（行為・発言・出来事）を最初に書く。否定や反応の前に、読者が「何の話か」を100%把握できること
      ② 最小限の経緯（時期・場面・共演等）
      ③ 当事者・関係者の反応と、意見が分かれる軸
      断定禁止・帰属付き。2文だけの薄い要約禁止</p>
    <h2>どこで意見が分かれるか</h2><ul><li><strong>立場A:</strong> …</li><li><strong>立場B:</strong> …</li></ul>
      （資料の言い分だけ。両側が視覚的に対になるラベル。声明対立は当事者名。戦争・外交は実陣営名。
      曖昧ラベル禁止。立場が分かれない争点は省略）
    <h2>賛成側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
    <h2>反対側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
      （最重要。声明対立なら h2 を当事者名に置き換え、bullets とも揃える。
      各3〜4項目・同じ分量。「いま何が論点か」「各社は何を伝えているか」で既出の事実を繰り返さない。
      各側の主張・理由・反論だけ。一般論禁止。他国の数字を混ぜない。
      片方のリストに反対側の応援や両論を混ぜない。
      本当に一方の立場が無い争点に限り両セクション省略可）
    <h2>各社は何を伝えているか</h2><ul><li><strong>各社が揃って伝えていること:</strong> …</li><li><strong>媒体名:</strong> 固有の内容（差がある場合のみ）</li></ul>
      （報道抜粋が複数媒体分ある場合のみ。冒頭で述べた共通の事実を繰り返さない — 論調の差・追加情報・食い違いだけ。
      差が無ければ「大きな差は確認できない」1行。1媒体以下ならセクション省略可）
    <h2>背景</h2><ul><li>…</li></ul>（国会会議録またはWikipediaで本件固有の経緯が補える場合のみ。
      『○○とは…』の辞書定義は禁止。使えなければセクションごと省略）
    <h2>海外ではどう報じられているか</h2><ul><li><strong>共通:</strong> …</li><li><strong>国内:</strong> …</li><li><strong>海外:</strong> …</li></ul>
      （海外報道抜粋が与えられていて、かつ海外が主戦場の争点、または国内報道との意味ある差がある場合のみ。
      国内主の争点で海外類似事例を足すのは禁止。該当しなければセクションごと省略）
    <h2>法律ではどうなっているか</h2><ul><li>…</li></ul>（関連法令の抜粋がある場合のみ。無ければ省略。「資料にありません」禁止）
    <h2>数字で見る世論</h2><ul><li>…</li></ul>（世論調査の数値がある場合のみ。無ければ省略）
    <h2>まだ分からないこと</h2><ul><li>…</li></ul>（未確定点を1〜3項目。URL捏造禁止）
    <h2>出典</h2><ul><li><a href>…</a></li></ul>（与えられたURLのみ）`;

/**
 * 時系列セクションを追加挿入する条件（純関数・テスト可能）。
 * 全ての争点に無理やり時系列を作らせると、単一時点のスナップショット報道まで
 * 水増しの箇条書きになってしまうため、「実際に変遷があった」と判断できる場合だけに絞る:
 *   - 続報再生成（previousArticleあり）: 定義上「前はこうだったが今はこう変わった」の変遷そのもの
 *   - 初回生成でも、日付が分かるソース・国会発言が複数の異なる日にまたがっていれば
 *     スローバーン型（数日かけて審議・報道が積み上がった話題）とみなす
 */
const TIMELINE_MIN_SPAN_HOURS = 20;
const TIMELINE_MIN_DATED_ITEMS = 3;

export function isTimelineWorthy(
  sources: { publishedAt?: string }[],
  dietSpeeches: { date?: string }[],
  hasPreviousArticle: boolean,
): boolean {
  if (hasPreviousArticle) return true;

  const timestamps = [
    ...sources.map((s) => (s.publishedAt ? new Date(s.publishedAt).getTime() : NaN)),
    ...dietSpeeches.map((d) => (d.date ? new Date(d.date).getTime() : NaN)),
  ].filter((t) => Number.isFinite(t));
  if (timestamps.length < TIMELINE_MIN_DATED_ITEMS) return false;

  const distinctDays = new Set(timestamps.map((t) => new Date(t).toISOString().slice(0, 10))).size;
  if (distinctDays < 2) return false;

  const spanHours = (Math.max(...timestamps) - Math.min(...timestamps)) / 3_600_000;
  return spanHours >= TIMELINE_MIN_SPAN_HOURS;
}

/**
 * 「背景」または「詳しく（背景と経緯）」の直後に挿入。isTimelineWorthy=trueの時だけ。
 */
const TIMELINE_SECTION_ADDENDUM = `
    追加セクション（日付を跨いだ変遷があるため、「背景」の直後に挿入。背景が無い場合は「いま何が論点か」または「いま分かっていること」の直後）:
    <h2>これまでの流れ</h2><ul><li><strong>M月D日:</strong> 出来事・報道内容</li></ul>
      （sourcesまたは国会会議録の日付だけを根拠に古い順。日付不明は含めない。
      日本の争点に他国の類似事例を混ぜない。
      「当初は〜と報じられていたが、後に〜と判明した」変遷があれば明記する）`;

export async function generateArticle(params: GenerateArticleParams): Promise<ArticleJson> {
  const {
    issueTitle,
    isReported,
    sources,
    primaryExcerpts = [],
    reportExcerpts = [],
    internationalReportExcerpts = [],
    pollingExcerpts = [],
    claimDiffBlock = "",
    dietSpeeches = [],
    background = null,
    laws = [],
    estatStats = [],
    previousArticle,
    revisionFeedback = [],
    debateType = null,
    reignite = false,
  } = params;
  const openai = createArticleClient({ timeout: 180_000, maxRetries: 1 });
  const sourceList = sources
    .map(
      (s, i) =>
        `${i + 1}. [${s.feed}]${s.publishedAt ? `（${s.publishedAt}）` : ""} ${s.title}\n   ${s.url}`,
    )
    .join("\n");

  const excerptBlock =
    primaryExcerpts.length > 0
      ? `\n\n# 一次資料抜粋（公式ページ本文。この内容は公式発表として事実の形で書いてよい）
${primaryExcerpts.map((e, i) => `【資料${i + 1}】${e.title}\n${e.url}\n${e.text}`).join("\n---\n")}`
      : "";

  const reportExcerptBlock =
    reportExcerpts.length > 0
      ? `\n\n# 報道抜粋（各社ページ本文。必ず媒体名付きの帰属引用として使い、媒体間の一致・食い違いを比較すること）
${reportExcerpts.map((e, i) => `【報道${i + 1}: ${e.feed}】${e.title}\n${e.url}\n${e.text}`).join("\n---\n")}`
      : "";

  const internationalReportExcerptBlock =
    internationalReportExcerpts.length > 0
      ? `\n\n# 海外/英字メディア報道抜粋（媒体名付き帰属のみ。「海外ではどう報じられているか」で使う。
国内主の争点ならこのブロックがあっても海外セクションは出さず、賛否にも混ぜない）
${internationalReportExcerpts.map((e, i) => `【海外報道${i + 1}: ${e.feed}】${e.title}\n${e.url}\n${e.text}`).join("\n---\n")}`
      : "";

  const pollingExcerptBlock =
    pollingExcerpts.length > 0
      ? `\n\n# 世論調査報道抜粋（数値がある場合のみ「数字で見る世論」で使う。無ければセクション省略）
${pollingExcerpts.map((e, i) => `【世論調査${i + 1}: ${e.feed}】${e.title}\n${e.url}\n${e.text}`).join("\n---\n")}`
      : "";

  const lawsBlock =
    laws.length > 0
      ? `\n\n# 関連法令（e-Gov。「法的な位置づけ」セクションで使う。条文抜粋がある場合のみ引用可）
${laws
  .map((l, i) => {
    const snippets =
      l.articleSnippets && l.articleSnippets.length > 0
        ? `\n条文抜粋:\n${l.articleSnippets.map((s) => `- [${s.position}] ${s.text}`).join("\n")}`
        : "";
    return `【法令${i + 1}】${l.lawTitle}（${l.lawNum}、${l.repealStatus ? "廃止済み" : "現行"}）\n${l.url}${snippets}`;
  })
  .join("\n---\n")}`
      : "";

  const dietBlock =
    dietSpeeches.length > 0
      ? `\n\n# 国会会議録（公式発言記録。発言者名付きの帰属引用として事実の形で使ってよい。時系列の材料にする）
${dietSpeeches.map((s, i) => `【発言${i + 1}】${s.date} ${s.house}${s.meeting} ${s.speaker}\n${s.snippet}\n${s.url}`).join("\n---\n")}`
      : "";

  const backgroundBlock = background
    ? `\n\n# 背景解説（Wikipedia。一般的な背景・用語説明にのみ使い、今回の争点の最新事実の裏付けには使わない）
${background.title}\n${background.extract}\n${background.url}`
    : "";

  const estatBlock =
    estatStats.length > 0
      ? `\n\n# 関連政府統計（e-Stat。経済・労働・物価等の争点で、数値の一次情報として「ポイント」または「詳しく」で参照してよい。
URLはe-Stat統計ページのリンクとして出典に含めること）
${estatStats.map((s, i) => `【統計${i + 1}】${s.statsName}（${s.govOrg}、調査時点: ${s.surveyDate || "不明"}）\n${s.statsDataUrl}`).join("\n---\n")}`
      : "";

  const previousBlock = previousArticle
    ? `\n\n# 前回までのまとめ（この続きとして更新する。矛盾させず、新情報を反映する）
${previousArticle.lead}
${previousArticle.articleHtml}`
    : "";

  const revisionBlock =
    revisionFeedback.length > 0
      ? `\n\n# 検証係からの差し戻し（重要・必ず反映すること）
以下の主張は、検証係が根拠資料と照合した結果「裏付けが確認できない」と判定しました。
該当箇所を資料の範囲内の表現に修正するか、裏付けが取れない場合は記述自体を削除してください。
${revisionFeedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
      : "";

  const followUpFieldBlock = previousArticle
    ? `,\n  "followUpNote": "前回からの変化点を具体的に1〜2文で。新事実／各社報道の食い違いの変化／未確定のままの点、のうち
      該当するものを書く（例: 「A社が本人コメントを新たに報道。B社は依然未確認と伝えている」）。140字以内"`
    : "";

  const includeTimeline = isTimelineWorthy(sources, dietSpeeches, !!previousArticle);
  const format =
    (isReported ? REPORTED_FORMAT : OFFICIAL_FORMAT) + (includeTimeline ? TIMELINE_SECTION_ADDENDUM : "");
  const leadSpec = isReported
    ? "「いま何が論点か」セクションと同一内容（短い別要約は作らない）。報道の具体的内容を①として含める。150〜280字。帰属付き・断定禁止"
    : "「いま分かっていること」と同内容。短い別要約は作らない。150〜280字";
  const effectiveType: DebateType = debateType ?? "policy";
  const bulletsSpec = debateTypeBulletsSpec(effectiveType, isReported);
  const typeHint = debateTypeArticleHint(effectiveType, reignite);

  const intlHint =
    internationalReportExcerpts.length > 0
      ? "\n# 海外報道抜粋あり: 海外が主戦場の争点、または国内との意味ある差があるときだけ「海外ではどう報じられているか」を書く。国内主なら使わずセクション省略。"
      : "\n# 海外報道抜粋なし: 「海外ではどう報じられているか」は出さない。他国の類似事例も書かない。";

  const res = await openai.chat.completions.create({
    model: resolveArticleModel(AI_MODELS.article),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `争点: ${issueTitle}
種別: ${isReported ? "報道ベース（断定禁止・帰属付き）" : "公式発表ベース"}
目的: スプリットスレッド参加者への最低限の中立土台（長文まとめ・偏向報道にしない）${intlHint}

# この争点の書き方（厳守）
${typeHint}
${excerptBlock}${reportExcerptBlock}${internationalReportExcerptBlock}${claimDiffBlock}${pollingExcerptBlock}${dietBlock}${backgroundBlock}${lawsBlock}${estatBlock}${previousBlock}${revisionBlock}

# 確認済みの報道見出し（前回分含む最新の全件）
${sourceList}

# 出力形式（JSONのみ）
{
  "lead": "${leadSpec}",
  "bullets": ${bulletsSpec},
  "articleHtml": "HTML。見出しの文言・順序は厳守。各セクション内は箇条書き中心で、長い段落にしない:
    ${format}"${followUpFieldBlock},
  "claims": [{"text": "本文中の具体的事実の要約（60字以内）", "sourceUrl": "根拠にした資料抜粋のURL"}]
}`,
      },
    ],
  });

  const text = res.choices[0]?.message?.content ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON抽出失敗");
  return JSON.parse(match[0]) as ArticleJson;
}

/**
 * claimのsourceUrlから根拠抜粋本文を引けるURL→本文の索引を作る（純関数・テスト可能）。
 * Writerに渡したのと同じ材料からだけ作る（Writerが見ていない外部情報で照合すると
 * 「本当は書いてよかったのに再取得タイミングの差で不合格になる」誤検出が起きるため）。
 */
export function buildSourceTextIndex(
  params: Pick<
    GenerateArticleParams,
    | "primaryExcerpts"
    | "reportExcerpts"
    | "internationalReportExcerpts"
    | "pollingExcerpts"
    | "dietSpeeches"
    | "laws"
    | "background"
  >,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const e of params.primaryExcerpts ?? []) index.set(e.url, e.text);
  for (const e of params.reportExcerpts ?? []) index.set(e.url, e.text);
  for (const e of params.internationalReportExcerpts ?? []) index.set(e.url, e.text);
  for (const e of params.pollingExcerpts ?? []) index.set(e.url, e.text);
  for (const s of params.dietSpeeches ?? []) index.set(s.url, s.snippet);
  for (const l of params.laws ?? []) {
    if (l.articleSnippets && l.articleSnippets.length > 0) {
      index.set(l.url, l.articleSnippets.map((s) => s.text).join("\n"));
    }
  }
  if (params.background) index.set(params.background.url, params.background.extract);
  return index;
}

export interface UngroundedClaim extends ArticleClaim {
  reason: "source_not_found" | "unsupported" | "ungrounded_number" | "unclaimed_highlight";
}

/**
 * sourceUrlが与えた資料に存在しないclaimを機械的に検出する（nano呼び出し不要・0円・即時）。
 * Writerが存在しないURLを捏造した場合、または見出しのみのソースを誤って引用元にした場合を弾く。
 */
export function findUngroundedByMissingSource(
  claims: ArticleClaim[],
  index: Map<string, string>,
): UngroundedClaim[] {
  return claims
    .filter((c) => !index.has(c.sourceUrl))
    .map((c) => ({ ...c, reason: "source_not_found" as const }));
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

/**
 * 金額・割合・件数等、捏造されると実害の大きい数量的事実の抽出パターン。
 * 「◯年/◯月/◯日」単体は文脈的な言い換え（「今年度」等）が自然に起きやすく誤検出が多いため対象外にし、
 * 金額・割合・件数など数値そのものが意味を持つ表現に絞る。
 */
// 単位は長い複合表現（億円等）を先に試す必要がある（正規表現の交替は最初に一致した選択肢で確定するため、
// 「億」を先に置くと「140億円」が「140億」で打ち切られてしまう）
const GROUNDABLE_NUMBER_PATTERN =
  /[0-9０-９]+(?:\.[0-9０-９]+)?(?:億円|兆円|万円|万人|万件|億|兆|万|円|人|件|条|倍|カ国|ヶ国|ポイント|%|％)/g;

/** articleHtml本文（タグ除去後）から数量的事実を機械抽出する（claimsに依らない独立チェック用） */
export function extractGroundableNumbers(articleHtml: string): string[] {
  const text = stripHtmlTags(articleHtml);
  const matches = text.match(GROUNDABLE_NUMBER_PATTERN) ?? [];
  return [...new Set(matches)];
}

/**
 * テンプレの観点ラベル（「共通して報じられていること:」「媒体名:」「6月4日:」等）は
 * 事実ではないのに <strong> で囲まれやすい。検証の誤爆を防ぐため除外する。
 */
const HIGHLIGHT_LABEL_ONLY =
  /^(?:共通して報じられていること|各社が揃って伝えていること|媒体名|国内|海外|共通|与党[^:：]*|野党[^:：]*|専門家[^:：]*|推進側|慎重・反対側|擁護[^:：]*|批判[^:：]*|告発側|報道している側の立場|当事者[^:：]*|本人(?:・事務所)?側|事務所[^:：]*|企業側|日銀[^:：]*|政府[^:：]*|何が変わる|なぜ今|誰に影響|何を決定したか|何を決めたか|理由|市場・生活への影響|暮らし・市場への影響|確認できること|確認できないこと|今後見るべき一次情報|共通事実|賛成側の芯|反対側の芯|いま分かっていること|A側が言うこと|B側が言うこと|賛成側が言うこと|反対側が言うこと)[:：]?$/;
/**
 * 「6月4日:」「今年6月26日:」「2026年7月1日:」に加え、正確な日が分からない時系列見出し
 * 「4月:」「今年7月:」も日付ラベルとして除外する（実例: 日にちまで分からないタイムライン項目が
 * 「4月:」という<strong>見出しになり、事実トークンとして誤検出されHELDになった）。
 */
const HIGHLIGHT_DATE_LABEL = /^(?:今年|昨年|本年|\d{4}年)?\d{1,2}月(?:\d{1,2}日)?[:：]?$/;
/** 数字・％・円・人など、捏造されると実害の大きいトークンを含むか */
const HIGHLIGHT_HAS_FACT_TOKEN =
  /[0-9０-９]|[%％]|円|人|件|条|倍|ポイント|兆|億|万|議席|票/;

/**
 * articleHtml内の<strong>強調箇所を抽出する。
 * プロンプトで「最も重要な事実・数字は<strong>で1箇所だけ強調してよい」と指示しているため、
 * Writerが自ら「これが一番大事」と示した箇所であり、claims配列への自己申告漏れが最も痛いのもここ。
 * ただしテンプレのラベルだけの strong は検証対象外（誤爆防止）。
 */
export function extractHighlightedFacts(articleHtml: string): string[] {
  const matches = [...articleHtml.matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) =>
    stripHtmlTags(m[1]).trim(),
  );
  return [
    ...new Set(
      matches.filter((m) => {
        if (m.length < 2) return false;
        if (HIGHLIGHT_LABEL_ONLY.test(m)) return false;
        if (HIGHLIGHT_DATE_LABEL.test(m)) return false;
        // 「ダイヤモンド・オンライン:」「日経:」など、コロン終わりで事実トークン無しは観点ラベル
        if (/[:：]$/.test(m) && !HIGHLIGHT_HAS_FACT_TOKEN.test(m)) return false;
        // ラベル以外でも、事実トークンが無い短い見出しはスキップ（「賛成」「反対」等）
        if (m.length <= 24 && !HIGHLIGHT_HAS_FACT_TOKEN.test(m)) return false;
        return true;
      }),
    ),
  ];
}

/**
 * 全角数字・全角％を半角に正規化する。claim検証は部分文字列マッチのため、
 * Writerが資料の全角表記を半角で書き直した（またはその逆）だけで「裏付けなし」と
 * 誤判定していた（言い換え数字・全角半角の表記ゆれ）。比較直前にこれを通すだけで解消する。
 */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/％/g, "%");
}

function containsEitherWay(a: string, b: string): boolean {
  const na = normalizeDigits(a);
  const nb = normalizeDigits(b);
  return na.includes(nb) || nb.includes(na);
}

/** 与えた資料本文（+見出し）のどこにも出現しない数値を検出する */
export function findUngroundedNumbers(numbers: string[], haystacks: string[]): string[] {
  const normalizedHaystacks = haystacks.map(normalizeDigits);
  return numbers.filter((n) => {
    const normalized = normalizeDigits(n);
    return !normalizedHaystacks.some((h) => h.includes(normalized));
  });
}

/**
 * <strong>強調箇所のうち、claimsとして自己申告もされておらず、資料本文にも見つからないものを検出する。
 * 「claimsに含まれていないのに本文にある具体的事実」を捕まえる網羅性チェックの本体。
 */
export function findUnclaimedHighlights(
  highlights: string[],
  claimTexts: string[],
  haystacks: string[],
): string[] {
  const normalizedHaystacks = haystacks.map(normalizeDigits);
  return highlights.filter((h) => {
    const normalizedH = normalizeDigits(h);
    return (
      !claimTexts.some((c) => containsEitherWay(c, h)) &&
      !normalizedHaystacks.some((hay) => hay.includes(normalizedH))
    );
  });
}

export interface VerifiedArticleResult {
  article: ArticleJson;
  verified: boolean;
  /** verified=falseの場合、最終試行後も裏付けが取れなかったclaim */
  unresolvedClaims: UngroundedClaim[];
  /** 実際に行った生成試行回数（初回=1） */
  attempts: number;
}

/**
 * Writer（GPT-5）→Verify（nano、独立呼び出し）→不合格ならWriterへ差し戻し、のループ。
 * 検証は3段: ①claimsのsourceUrlが実在の資料か ②その資料に本当に書かれているか（nano）
 * ③claimsに自己申告されていない数値・強調箇所が資料に見つかるか（網羅性チェック）。
 * ①③は機械的な文字列照合（0円）、②だけnanoを使う（対象を絞ってからnanoに投げるためコストも絞れる）。
 * ③はclaims自己申告への依存を補う: Writerがタグ付けし忘れた（あるいは意図的に避けた）
 * 危うい記述も、articleHtml全文を直接スキャンして捕まえる。
 */
export async function generateVerifiedArticle(
  params: GenerateArticleParams,
  maxRetries = 2,
): Promise<VerifiedArticleResult> {
  const index = buildSourceTextIndex(params);
  const sourceTitles = (params.sources ?? []).map((s) => s.title);
  const haystacks = [...index.values(), ...sourceTitles];
  let feedback: string[] = [];
  let article: ArticleJson = { lead: "", bullets: [], articleHtml: "" };

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    article = await generateArticle({ ...params, revisionFeedback: feedback });
    const claims = article.claims ?? [];

    const missingSource = findUngroundedByMissingSource(claims, index);
    const toCheck = claims.filter((c) => index.has(c.sourceUrl));

    const checkItems: ClaimToVerify[] = toCheck.map((c, i) => ({
      id: String(i),
      claim: c.text,
      sourceExcerpt: index.get(c.sourceUrl) ?? "",
    }));
    const results = checkItems.length > 0 ? await verifyClaimsAgainstSources(checkItems) : [];
    const supportedById = new Map(results.map((r) => [r.id, r.supported]));
    const unsupported: UngroundedClaim[] = toCheck
      .filter((_, i) => supportedById.get(String(i)) === false)
      .map((c) => ({ ...c, reason: "unsupported" as const }));

    const ungroundedNumbers: UngroundedClaim[] = findUngroundedNumbers(
      extractGroundableNumbers(article.articleHtml),
      haystacks,
    ).map((text) => ({ text, sourceUrl: "", reason: "ungrounded_number" as const }));
    const unclaimedHighlights: UngroundedClaim[] = findUnclaimedHighlights(
      extractHighlightedFacts(article.articleHtml),
      claims.map((c) => c.text),
      haystacks,
    ).map((text) => ({ text, sourceUrl: "", reason: "unclaimed_highlight" as const }));

    const failed = [...missingSource, ...unsupported, ...ungroundedNumbers, ...unclaimedHighlights];
    if (failed.length === 0) {
      return { article, verified: true, unresolvedClaims: [], attempts: attempt };
    }
    if (attempt > maxRetries) {
      return { article, verified: false, unresolvedClaims: failed, attempts: attempt };
    }
    feedback = failed.map((f) =>
      f.sourceUrl
        ? `「${f.text}」（出典として提示されたURL: ${f.sourceUrl}）— 資料での裏付けが確認できません`
        : `「${f.text}」— 与えられた資料のどこにも見つからない記述です。事実確認できる表現に修正するか削除してください。`,
    );
  }
  return { article, verified: false, unresolvedClaims: [], attempts: maxRetries + 1 };
}

/**
 * 「どこで意見が分かれるか」以降の対立軸セクション（賛成側/反対側、または声明対立なら当事者名など
 * debateTypeで見出しが変わる）だけをarticleHtmlから抜き出す。
 * レスバ支援AI（rebuttal）・スティールマンAIは従来summaryJson.bullets（1行要約×2〜3項目）しか見ておらず、
 * 記事本文にある3〜4項目・具体点付きの厚い両論セクションが渡っていなかった。
 * 見出し文言はdebateTypeごとに変わる（OFFICIAL_FORMAT/REPORTED_FORMAT参照）ため、
 * 既知の非論点セクション（背景・出典等）を除外方式で弾き、残りを「対立軸セクション」とみなす。
 */
const NON_ARGUMENT_HEADINGS = new Set([
  "いま分かっていること",
  "いま何が論点か",
  "各社は何を伝えているか",
  "背景",
  "法律ではどうなっているか",
  "海外ではどう報じられているか",
  "どこで意見が分かれるか",
  "数字で見る世論",
  "まだ分からないこと",
  "出典",
  "これまでの流れ",
]);

export interface ArgumentSection {
  heading: string;
  items: string[];
}

export function extractArgumentSections(articleHtml: string): ArgumentSection[] {
  const sections: ArgumentSection[] = [];
  for (const m of articleHtml.matchAll(/<h2>([^<]+)<\/h2>([\s\S]*?)(?=<h2>|$)/g)) {
    const heading = stripHtmlTags(m[1]).trim();
    if (!heading || NON_ARGUMENT_HEADINGS.has(heading)) continue;
    const items = [...m[2].matchAll(/<li>([\s\S]*?)<\/li>/g)]
      .map((li) => stripHtmlTags(li[1]).trim())
      .filter(Boolean);
    if (items.length > 0) sections.push({ heading, items });
  }
  return sections;
}

/** レスバ支援AI等のプロンプトに埋め込む用のプレーンテキスト（長すぎる場合は呼び出し側でtrim） */
export function formatArgumentSectionsForPrompt(sections: ArgumentSection[]): string {
  return sections
    .map((s) => `【${s.heading}】\n${s.items.map((i) => `- ${i}`).join("\n")}`)
    .join("\n\n");
}
