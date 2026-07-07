/**
 * FactBase Radar — GPT-5記事生成の共有ロジック。
 * scripts/radar/summarize.ts（初回生成）と scripts/radar/followup.ts（続報反映）の両方から使う。
 *
 * 名誉毀損・出鱈目要約を構造的に防ぐ設計:
 *   - 入力は「確認済みの見出しとURL」、官公庁ページ本文抜粋、報道ページ本文抜粋、
 *     国会会議録・関連法令（条文抜粋）・Wikipedia背景
 *   - 報道ベースの争点は全文「〜と報じられています」形式を強制
 *   - 公式発表ベースの争点は一次資料抜粋に書かれている内容のみ事実として書ける
 *   - 出力後に断定表現の機械チェック → 引っかかったら公開せずHELDに落とす
 *
 * 記事フォーマットは「一言でまとめ → ポイント（争点の性質に応じた3観点）→ 詳しく → 論点 → 出典」
 * の段階的構成（スマホで数秒のスキャン→関心があれば深掘り、の読まれ方に最適化）。
 * 「時系列」セクションは、日付を跨いだ変遷が実際に確認できる争点だけに自動判定で挿入する
 * （isTimelineWorthy参照）。単一時点のスナップショット報道にまで無理に時系列を作らない。
 *
 * 検証ループ（generateVerifiedArticle）:
 *   執筆（GPT-5）と検証（nano）を別プロセスに分離する。同じモデルに書かせて同じモデルに
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
import { AI_MODELS } from "@/lib/constants";
import { createOpenAIClient } from "@/lib/openai-client";
import { verifyClaimsAgainstSources, type ClaimToVerify } from "@/lib/ai";

const SYSTEM = `あなたはFactBaseの編集デスクです。速報段階の争点について「現時点で確認できる情報の整理」を書きます。

# 絶対ルール（法的リスク回避・厳守）
- 与えられた見出しリスト・一次資料抜粋・報道抜粋に書かれていること以外を書かない。憶測・背景知識・記憶による補完は禁止
- 報道内容を事実として書かない。必ず「〜と○○が報じています」「〜と伝えられています」形式
- 例外1: 「一次資料抜粋」（政府・国会・裁判所等の公式ページ本文）に書かれている内容は
  「〜と発表されています」「法案は〜を定めています」と公式発表の内容として書いてよい
- 例外2: 「報道抜粋」（報道機関ページ本文）は、必ず媒体名を付けた帰属付き引用としてのみ使う
  （「◯◯新聞は〜と報じています」）。複数媒体の報道抜粋がある場合は、内容が一致しているか
  食い違っているかを比較し、食い違いがあれば「◯◯は〜、△△は〜と、報道内容が分かれています」
  と具体的に書く。これが読者にとって最も価値のある整理（＝情報の錯綜を整理すること）
- 例外3: 「国会会議録」は公式の発言記録なので、発言者名を付けた帰属付き引用として事実の形で
  使ってよい（「○○議員は国会で『〜』と発言しました」）。日付・院・委員会名から
  審議の時系列（いつ何が議論されたか）を組み立てるのに使う
- 例外4: 「背景解説（Wikipedia）」は、争点の一般的な背景・用語・経緯の説明にのみ使う。
  今回の争点固有の最新事実（今何が起きているか）の裏付けには使わない
  （Wikipediaは更新が追いついていない可能性があるため、あくまで一般教養レベルの補足に限定）
- 例外5: 「関連法令」（法令名・法令番号・現行/廃止の別、および条文抜粋）は、
  与えられた抜粋の範囲内でのみ引用してよい（「〜法第○条は『…』と定めています（e-Gov）」）。
  抜粋が無い法令は存在事実のみ。争点との関連が薄い場合は無理に使わず省略する
- 「海外メディア報道抜粋」は国内の報道抜粋と同様、必ず媒体名付きの帰属引用として使う
  （「ロイターは〜と報じています」）。国内報道と論調・強調点に違いがある場合のみ比較し、
  大きな違いが確認できなければ「大きな論調の違いは確認できない」と正直に書く
- 「世論調査報道抜粋」は、世論調査結果を報じた記事本文。具体的な支持率・賛否割合等の数値が
  書かれている場合のみ、必ず調査主体・媒体名・調査時期を付けた帰属引用として使ってよい
  （「◯◯新聞の世論調査では〜割が…と回答しました（△月調査）」）。数値の記載が無ければ無理に使わない
- 「違法」「有罪」「汚職」「犯罪」を事実として断定しない。疑惑は「〜との報道がある」とだけ書く
- 個人への評価・推測（「悪質」「怪しい」等）を書かない
- 確認できないことは「確認できないこと」として正直に列挙する。これがFactBaseの価値
- 見出し・一次資料抜粋・報道抜粋・国会会議録・背景解説にない固有名詞・数値・日付を書かない

# claims（機械検証用・別枠のJSONフィールド）
articleHtml内で「報道抜粋・一次資料抜粋・国会会議録・法令抜粋・海外報道抜粋」の具体的な記述を
根拠にした主張（固有名詞・数値・日付・引用を含む具体的事実）を、claims配列に
{"text": "主張の要約（60字以内）", "sourceUrl": "根拠にした抜粋のURL（与えられたものをそのまま）"}
として列挙すること。判断・論点・呼びかけ・見出しのみのソース（本文抜粋が無いもの）は対象外。
これは別プロセスの検証係が「本当にそのURLの資料にその内容が書かれているか」を機械的に照合するための
ものなので、sourceUrlは必ず与えられた資料抜粋のURLそのものを使うこと（捏造・推測は厳禁）。

# 文体
です・ます調。1文60字以内。冷静・中立。感嘆符なし。
箇条書き中心にし、各セクションはスマホで数秒で読み切れる分量にする。
各セクションの最も重要な事実・数字は<strong>で1箇所だけ強調してよい（多用しない）。
長い説明的な段落は書かない。`;

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
  /** 世論調査結果を報じた記事本文の抜粋。「世論の受け止め」セクションで支持率等の数値を引用する材料 */
  pollingExcerpts?: ReportExcerptInput[];
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
}

/**
 * OFFICIAL（公式発表・法案・判決・金融政策・統計・要人声明・事件の公式見解など）向け構成。
 * 見出しの並びは固定してUI表示の一貫性を保ちつつ、中身の観点は争点の性質に応じてAIが選ぶ。
 * 「法案=何が変わる/なぜ今/誰に影響」を全種類に固定すると、判決・金融政策・事件の公式発表等
 * 法案以外のOFFICIAL争点で無理やり当てはめることになり機能しないため、観点自体を可変にする。
 * 抽象的な指示だけだとLLMの解釈がぶれるため、争点タイプ別に具体的な出力例を1つずつ示して固定する。
 */
const OFFICIAL_FORMAT = `<h2>ポイント</h2>
      争点の性質に合う1パターンを選び、<ul><li><strong>観点語:</strong> 内容</li></ul>の3項目で書く（観点語は例をそのまま使ってよいし、争点により近い言葉に言い換えてもよい）。
      - 法案・条例: <ul><li><strong>何が変わる:</strong> …</li><li><strong>なぜ今:</strong> …</li><li><strong>誰に影響:</strong> …</li></ul>
      - 判決・司法判断: <ul><li><strong>何が確定した:</strong> …</li><li><strong>法的根拠:</strong> …</li><li><strong>今後への影響:</strong> …</li></ul>
      - 金融政策・経済指標: <ul><li><strong>何を決定・発表したか:</strong> …</li><li><strong>理由や背景:</strong> …</li><li><strong>市場や生活への影響:</strong> …</li></ul>
      - 事件・災害の公式発表: <ul><li><strong>何が起きた（公式発表内容）:</strong> …</li><li><strong>被害・対応状況:</strong> …</li><li><strong>今後の見通し:</strong> …</li></ul>
      - 要人の声明・辞任等の人事: <ul><li><strong>何が起きたか:</strong> …</li><li><strong>経緯:</strong> …</li><li><strong>今後どうなるか:</strong> …</li></ul>
      いずれも一次資料・見出しから分かる範囲で書き、分からない項目は「一次資料からは確認できない」と書く
    <h2>詳しく（背景と経緯）</h2><ul><li>…</li></ul>（何がどう進んできたか。国会会議録があれば日付・発言者付きの時系列として、
      背景解説（Wikipedia）があれば一般的な経緯の補足として使う）
    <h2>法的な位置づけ</h2><ul><li>…</li></ul>（関連法令が与えられている場合のみ書く。法令名・現行/廃止の別など存在レベルの
      事実を1〜2件。争点との関連が薄い場合はこのセクション自体を省略する）
    <h2>国内外の報道比較</h2><ul><li><strong>国内:</strong> …</li><li><strong>海外:</strong> …</li></ul>
      （海外メディア報道抜粋が与えられている場合のみ書く。論調・強調点の違いを中立に。大きな違いが無ければ
      「大きな論調の違いは確認できない」と1行で書く。海外メディア報道抜粋が無い場合はこのセクション自体を省略する）
    <h2>各立場の主張</h2><ul><li><strong>与党（自民・公明）:</strong> …</li><li><strong>野党:</strong> …</li><li><strong>専門家・業界団体:</strong> …</li></ul>
      （見出しリスト・報道抜粋・国会会議録に各立場の主張が明示されている場合のみ書く。
      記載が無い立場は「報道から確認できない」と書く。推測・一般論で埋めない。
      立場が分かれない争点（天災の公式発表・司法判決の確定事実等）はこのセクション自体を省略する）
    <h2>論点</h2><ul><li>…</li></ul>（意見・評価が分かれうるポイントを中立に2〜3個。読者が自分の立場を考えられる問いの形で。事実が確定していて論点が特にない場合は無理に作らず1個でもよい）
    <h2>世論の受け止め</h2><ul><li>…</li></ul>（世論調査報道抜粋に具体的な支持率・賛否割合の数値がある場合のみ書く。
      調査主体・媒体名・調査時期を明記し、数値をそのまま引用する。世論調査報道抜粋が無い、または数値の記載が無い場合は
      このセクション自体を省略する）
    <h2>現時点で確認できないこと</h2><ul><li>…</li></ul>（正直に列挙）
    <h2>今後の見通し</h2><ul><li>…</li></ul>（次に何が起きるか・見るべき一次情報。国会審議中なら次の審議段階、係争中なら次の期日等）
    <h2>出典</h2><ul><li><a href>…</a></li></ul>（与えられたURLのみ）`;

/**
 * REPORTED（報道ベース・🔴LIVE）向け構成。
 * 「確認できること/できないこと」を分けて情報の錯綜を整理するのが役割。
 */
const REPORTED_FORMAT = `<h2>何が報じられているか</h2><p>2〜3文で要点を具体的に</p>（報道抜粋があれば固有名詞・数字を含めて何が起きたとされているか）
    <h2>各社の報道はどう食い違っているか</h2><ul><li><strong>媒体名:</strong> その媒体固有の報道内容</li></ul>
      （報道抜粋が複数媒体分ある場合のみ。全社が同じ内容なら「食い違いは確認できない（各社ほぼ同内容）」と1行で書く。
      報道抜粋が1媒体以下しか無い場合はこのセクション自体を省略してよい）
    <h2>詳しく（背景と経緯）</h2><ul><li>…</li></ul>（国会会議録または背景解説（Wikipedia）が与えられている場合のみ書く。
      国会会議録があれば日付・発言者付きの時系列として、背景解説があれば一般的な経緯の補足として使う。
      どちらも無い場合はこのセクション自体を省略する）
    <h2>国内外の報道比較</h2><ul><li><strong>国内:</strong> …</li><li><strong>海外:</strong> …</li></ul>
      （海外メディア報道抜粋が与えられている場合のみ書く。論調・強調点の違いを中立に。大きな違いが無ければ
      「大きな論調の違いは確認できない」と1行で書く。海外メディア報道抜粋が無い場合はこのセクション自体を省略する）
    <h2>法的な位置づけ</h2><ul><li>…</li></ul>（関連法令が与えられている場合のみ書く。法令名・現行/廃止の別など存在レベルの
      事実を1〜2件。争点との関連が薄い場合や関連法令が無い場合はこのセクション自体を省略する）
    <h2>現時点で確認できること</h2><ul><li>…</li></ul>（報道の存在・公式発表の有無。箇条書き）
    <h2>現時点で確認できないこと</h2><ul><li>…</li></ul>（正直に列挙。箇条書き）
    <h2>各立場の主張</h2><ul><li><strong>報道している側の立場:</strong> …</li><li><strong>当事者・政府の公式見解:</strong> …</li><li><strong>専門家・識者の見方:</strong> …</li></ul>
      （見出しリスト・報道抜粋・国会会議録に各立場の主張が明示されている場合のみ書く。
      記載が無い立場は「報道から確認できない」と書く。推測・一般論で埋めない。
      立場が分かれない争点はこのセクション自体を省略する）
    <h2>論点</h2><ul><li>…</li></ul>（この争点で意見が分かれるポイントを中立に2〜3個。読者が自分の立場を持てる問いの形にする）
    <h2>世論の受け止め</h2><ul><li>…</li></ul>（世論調査報道抜粋に具体的な支持率・賛否割合の数値がある場合のみ書く。
      調査主体・媒体名・調査時期を明記し、数値をそのまま引用する。世論調査報道抜粋が無い、または数値の記載が無い場合は
      このセクション自体を省略する）
    <h2>今後見るべき一次情報</h2><ul><li>…</li></ul>（本人声明・政府発表・資料など種類を挙げる。URLは捏造しない）
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
 * 「詳しく（背景と経緯）」の直後に挿入する追加セクション。isTimelineWorthy=trueの時だけformatに足す。
 * 単なる日付の列挙で終わらせず、「当初の報道と後の確定情報の違い」を明記させるのが狙い
 * （ユーザーの言う「最初はこう報じられてたけど実はこうでした」を拾う）。
 */
const TIMELINE_SECTION_ADDENDUM = `
    追加セクション（今回は日付を跨いだ変遷が確認できるため、上記「詳しく（背景と経緯）」の直後に挿入すること）:
    <h2>時系列</h2><ul><li><strong>M月D日:</strong> 出来事・報道内容</li></ul>
      （sourcesリストに付記された日付、または国会会議録の日付だけを根拠に古い順で並べる。日付が分からない事実は含めない。
      特に「当初は〜と報じられていたが、後に〜と判明/確定した」という変遷があれば明記する。単なる列挙で終わらせず、
      何がどう変わったかが伝わるようにする）`;

export async function generateArticle(params: GenerateArticleParams): Promise<ArticleJson> {
  const {
    issueTitle,
    isReported,
    sources,
    primaryExcerpts = [],
    reportExcerpts = [],
    internationalReportExcerpts = [],
    pollingExcerpts = [],
    dietSpeeches = [],
    background = null,
    laws = [],
    estatStats = [],
    previousArticle,
    revisionFeedback = [],
  } = params;
  const openai = createOpenAIClient({ timeout: 60_000, maxRetries: 1 });
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
      ? `\n\n# 海外/英字メディア報道抜粋（各社ページ本文。必ず媒体名付きの帰属引用として使い、
「国内外の報道比較」セクションで国内報道との論調・強調点の違いを比較する材料にする）
${internationalReportExcerpts.map((e, i) => `【海外報道${i + 1}: ${e.feed}】${e.title}\n${e.url}\n${e.text}`).join("\n---\n")}`
      : "";

  const pollingExcerptBlock =
    pollingExcerpts.length > 0
      ? `\n\n# 世論調査報道抜粋（世論調査結果を報じた記事本文。具体的な支持率・賛否割合等の数値がある場合のみ、
調査主体・媒体名・調査時期を付けた帰属引用として「世論の受け止め」セクションで使う。数値の記載が無ければ無理に使わない）
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
    ? "一言でまとめ。①何が報じられているか ②現時点で確認できること/できないこと ③今の段階。150字以内"
    : "一言でまとめ。この発表・法案・判決・声明等で結局何がどうなるのかを結論ファーストで。150字以内";
  const bulletsSpec = isReported
    ? `["確認できること: …", "確認できないこと: …", "今後見るべき一次情報: …"]`
    : `articleHtmlの「ポイント」セクションと同じ3項目を同じ観点語で（例: ["何が変わる: …", "なぜ今: …", "誰に影響: …"] や ["何を決定したか: …", "理由: …", "市場・生活への影響: …"] など、争点の性質に応じて選んだ観点語を使う）`;

  const res = await openai.chat.completions.create({
    model: AI_MODELS.article,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `争点: ${issueTitle}
種別: ${isReported ? "報道ベース（真偽未確認ラベル必須）" : "公式発表ベース"}
${excerptBlock}${reportExcerptBlock}${internationalReportExcerptBlock}${pollingExcerptBlock}${dietBlock}${backgroundBlock}${lawsBlock}${estatBlock}${previousBlock}${revisionBlock}

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
 * articleHtml内の<strong>強調箇所を抽出する。
 * プロンプトで「最も重要な事実・数字は<strong>で1箇所だけ強調してよい」と指示しているため、
 * Writerが自ら「これが一番大事」と示した箇所であり、claims配列への自己申告漏れが最も痛いのもここ。
 */
export function extractHighlightedFacts(articleHtml: string): string[] {
  const matches = [...articleHtml.matchAll(/<strong>([\s\S]*?)<\/strong>/g)].map((m) =>
    stripHtmlTags(m[1]).trim(),
  );
  return [...new Set(matches.filter((m) => m.length >= 2))];
}

function containsEitherWay(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a);
}

/** 与えた資料本文（+見出し）のどこにも出現しない数値を検出する */
export function findUngroundedNumbers(numbers: string[], haystacks: string[]): string[] {
  return numbers.filter((n) => !haystacks.some((h) => h.includes(n)));
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
  return highlights.filter(
    (h) => !claimTexts.some((c) => containsEitherWay(c, h)) && !haystacks.some((hay) => hay.includes(h)),
  );
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
