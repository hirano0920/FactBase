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
import {
  createArticleClient,
  createEconomyArticleClient,
  resolveArticleModel,
  resolveEconomyArticleModel,
} from "@/lib/openai-client";
import { verifyClaimsAgainstSources, verifySidesAxisAlignment, type ClaimToVerify, extractKeyFacts, checkFactConsistency } from "@/lib/ai";
import {
  debateTypeArticleHint,
  debateTypeBulletsSpec,
  type DebateType,
} from "@/lib/debate-type";
import {
  findStructureIssues,
  autoRepairArticle,
  normalizeArticleSurfaces,
  sideSectionsPlain,
} from "@/lib/article-quality";
import {
  repairSideSectionsWithMini,
  collectSourceHintsForRepair,
} from "@/lib/article-repair";

const SYSTEM = `あなたは${SITE.name}の編集デスクです。JSON形式の記事データを生成します。

# この記事の目的（最重要）
スプリットスレッドで議論する人に、中立な共通土台を「最低限」渡すことです。
長文のまとめ記事でも、偏向報道でも、百科事典でもありません。
読者がすぐ自分の立場を取れるよう、確認できる事実と、対立する両側の論点だけを渡します。

# 絶対ルール（法的リスク回避・厳守）
- 与えられた見出し・一次資料抜粋・報道抜粋に書かれていること以外を書かない。憶測・記憶での補完は禁止
- 「確認済み事実リスト」が与えられた場合、それに含まれる事実だけを記事に書いてよい。
  リストにない具体的記述（数値・日付・固有名詞・行為の詳細）を書いてはならない。
  「リスト外の事実だが抜粋には書いてある」という場合も、リストに載っていなければ使ってはならない。
  これはでっち上げ防止のための最終安全策である。
- 報道を事実として断定しない。ただし「いま何が論点か」の冒頭段落とlead・bulletsでは
  帰属（「〜と報じています」「〜と述べた」）を書かなくてよい
  （読者にはUI側で常に「報道ベース・真偽は未確認」バッジが表示されるため、
  冒頭で毎回「報道」「報じる」と書くと読みにくくなりタイパを損なう）。
  代わりに事実をストレートに書くが、断定しないよう「〜とされる」「〜の可能性が報じられている」
  「〜との見方が広がっている」等の控えめな表現を用いる。
  （良い例:「日銀が金利を引き上げたとされる。朝日など複数メディアが伝えた。」）
  （悪い例:「日銀は金利を引き上げました」← 事実断定）
- 冒頭以降のセクション（賛成側/反対側・各社は何を伝えているか）では従来通り帰属を付ける。
  同じセクション内で同じ媒体の話を続ける2文目以降は、帰属を毎文繰り返さなくてよい。
  ただし確定した事実であるかのような断定語（「認定した」「確定した」「事実だ」等）は全セクションで禁止。
  帰属を1回にまとめようとして複数の事実を1文に詰め込まない（「1文60字以内」ルール違反）。
  （良い例:「朝日新聞は、日銀が金利を引き上げたと報じています。同じ紙面で物価見通しの
  上方修正も伝えています。」← 1文目で帰属済みなので2文目は繰り返さなくてよい）
- 例外1: 一次資料抜粋は「〜と発表されています」「法案は〜を定めています」と書いてよい
- 例外2: 報道抜粋は媒体名付き帰属のみ。複数媒体なら一致点と食い違いを比較。差が無ければ無理に作らない
- 例外3: 国会会議録は発言者名付きで引用してよい
- 例外4: Wikipediaは本件固有の経緯が補えるときだけ。『○○とは…』の辞書定義は禁止。使えなければセクション省略
- 例外5: 関連法令は抜粋の範囲内のみ。無ければセクション省略（「資料にありません」禁止）
- 世論調査は数値があるときだけ。無ければ省略（「数値はありません」禁止）
- 「違法」「有罪」「汚職」「犯罪」を事実断定しない。個人評価（「悪質」等）も書かない
- 抜粋にない固有名詞・数値・日付を書かない。抜粋が無いとき具体数値は書かない
- 数値は抜粋の表記をそのまま使う。leadで「A円からB円台」のように矛盾して読める並べ方をしない
- ★固有名詞は「翻訳」してから使う: GPIF→「年金運用の巨大基金」、学位剥奪→「博士号はく奪」等
  一般読者に一発で意味が通じる形に変換すること。トランプ・岸田首相等、誰でも分かる固有名詞はそのままでOK
  55字以内に収まらない固有名詞は、固有名詞を削って一般語だけで書け
- leadは「いま何が論点か」（またはOFFICIALの「いま分かっていること」）と同一内容にする。短い別要約を作らない
- leadに「報道ベースで真偽未確認」等の定型ラベルを付けない
- bulletsの1項目目は冒頭と同じ具体事実。2・3項目目は両側セクションと同じ芯。フィード・スレッド・記事で別要約を書かない

# 何を書くか（最低限）
1. いま何が論点か — 冒頭3〜4文。必ず以下の順序で書く:
   ① 何が起きたか — 固有名詞を「翻訳」しながら書け（「GPIF→年金運用の巨大基金」「学位剥奪→博士号はく奪」等、
      一般読者が一発で意味を理解できるように）。固有名詞だけで意味が通じる（トランプ、岸田首相）はそのままでOK
   ② それが読者の生活・お金・安全・権利にどう影響するか = フック（最重要。ここが無いと誰も読み続けない）
   ③ 最小限の経緯（1文あれば十分）
   ④ 意見が分かれる軸
2. どこで意見が分かれるか — 両側の立場を1行ずつ。タイトルの自分ごとフック（例:貿易・円・燃料・SNS）があれば対立軸にも落とす
3. 両側の主張（最重要・同じ分量・同じ根拠密度）。①で書いた事実の再掲禁止。理由・反論・論点だけ
4. 各社の差 — 冒頭と重複する事実の再掲禁止。論調の違い・追加情報のみ
5. 背景・法令は点火に必要なら短く
6. まだ分からないこと（短く）

# 両側の見せ方（視覚的にも内容的にも対になる）★品質の最重要
- 政策: 「賛成側が言うこと」「反対側が言うこと」。賛成リストに反対・慎重論を混ぜない
- 声明対立・ゴシップの当事者対立: 当事者名で揃える（「批判・告発側が言うこと」「本人・事務所側が言うこと」）
  「賛成＝被害者／反対＝本人」の無理当て禁止。片方のリストに反対側の応援を混ぜない
- 戦争・外交・国際対立: 実在する陣営・立場名で揃える（例:「停戦を急ぐ側」「軍事圧力を優先する側」）
- ★両側は同じ論点について賛否・評価を述べること。片方が「対応（事後）の是非」、もう片方が
  「発生前の管理・準備体制」のように、報道に出てくる別の論点にすり替わっていないか確認する
  （悪い例: 設問「対応は適切か」に対し、擁護側=「救助は全力でやっている」／批判側=「事前の
  ダム管理に問題があった」— これは対応の是非と事前管理の是非という別の2つの問いが混ざっている。
  どちらか1つの論点に両側を揃えるか、設問側を「対応・管理を含め全体として妥当だったか」のように
  両側を包含する広さに調整する）
- 両側とも各2〜4項目。一方だけ厚くしない（資料が薄い側は2項目で可）
- ★両側とも資料に根拠がある主張だけ書く。各項目に媒体名・発言者名・国会発言者など帰属を付ける
  （良い例:「○○議員は〜と指摘しています」「朝日は〜と伝えています」）
  （悪い例:「過度な規制が国際競争力を損なう恐れがある」「現行法で対応可能だ」— 資料に無い教科書一般論）
- 片側だけ具体手口・数字があり、もう片側が抽象スローガンだけの非対称は禁止
- ★資料に反対・慎重側の根拠が薄いときは捏造しない。その側は帰属付き2項目までに留め、足りない点は「まだ分からないこと」へ回す
  （空の側を一般論で埋める方が不合格になる）

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
- 各箇条書きは結論を先に書いてから理由・詳細を続ける（結論ファースト。「なぜなら」の説明から書き始めない）
- **句読点ルール: 読点（、）は文の構造を明確にするためだけに使う。冗長な読点は避ける。「A、B」のように修飾語と被修飾語の間に入れる読点は不要（「加熱式たばこ、40円値上げ」ではなく「加熱式たばこ40円値上げ」）。外しても意味が通じる読点はすべて削れ。**`;

/**
 * TwoSides News 用。スプリット議論ではなく「数十ソース横断のタイパまとめ」。
 * 両側セクションは書かない。事実・影響・タイムライン・各社差・未確定点に集中する。
 */
const NEWS_SYSTEM = `あなたは${SITE.name} Newsの編集デスクです。JSON形式の記事データを生成します。

# この記事の目的（最重要）
ホットな話題を、複数メディアの報道を横断参照したうえで、
「必要な情報だけ・最短時間で・わかりやすく・学びになる」中立まとめにすることです。
長文まとめでも偏向報道でもありません。TVのニュース番組より短く、Yahoo!1記事より広く、ここで完結するタイパ記事です。

# 絶対ルール（法的リスク回避・厳守）
- 与えられた見出し・一次資料抜粋・報道抜粋に書かれていること以外を書かない。憶測・記憶での補完は禁止
- 「確認済み事実リスト」が与えられた場合、それに含まれる事実だけを記事に書いてよい。
  リストにない具体的記述（数値・日付・固有名詞・行為の詳細）を書いてはならない。
- 報道を事実として断定しない。冒頭・lead・bulletsでは帰属を毎文書かなくてよいが、
  「〜とされる」「〜との見方」等の控えめ表現を使う。詳細セクションでは媒体名帰属を付ける。
- 例外: 一次資料は「〜と発表されています」、国会会議録は発言者名付きで引用してよい
- 「違法」「有罪」「汚職」「犯罪」を事実断定しない。個人評価も書かない
- 抜粋にない固有名詞・数値・日付を書かない
- ★固有名詞は「翻訳」してから使う: GPIF→「年金運用の巨大基金」等
- leadは冒頭セクションと同一内容にする
- bulletsの1項目目は冒頭と同じ具体事実。2項目目は読者への影響。3項目目は今後の注目点

# 何を書くか（最低限）
1. いま分かっていること — 何が起きたか／読者への影響／最小限の経緯
2. なぜ注目されているか — 1〜3項目（市場・生活・制度など）
3. 各社は何を伝えているか — 一致点と差だけ（事実の再掲禁止）
4. これまでの流れ — 日付付きの変遷があるときだけ
5. 背景・数字・法令 — 点火に必要なら短く
6. まだ分からないこと

# 書いてはいけないこと
- 「賛成側が言うこと」「反対側が言うこと」のような両側強制セクション
- 無理な二項対立の捏造
- 百科事典的な長い背景

# claims（機械検証用）
具体的事実だけを {"text":"60字以内","sourceUrl":"与えられた抜粋URL"} で列挙。URL捏造禁止。

# 文体
- です・ます。1文60字以内。感嘆符なし。煽り禁止
- 箇条書き中心。長い段落禁止
- <strong>は事実トークン（数字・固有名詞）のみ
- 結論ファースト。冗長な読点は削る`;

const NEWS_FORMAT = `<h2>いま分かっていること</h2><p>3〜4文。必ずこの順序:
  ① 何が起きたか — 事実をストレートに。固有名詞は翻訳。媒体名は不要
  ② 読者の生活・お金・仕事・安全にどう影響するか = フック（必須）
  ③ 最小限の経緯（省略可）
  lead・bullets1項目目と同一内容。断定しない控えめ表現</p>
<h2>なぜ注目されているか</h2><ul><li>…</li><li>…</li></ul>
  （市場・生活・制度・国際関係など、読者が「自分ごと」にできる観点。資料に基づく）
<h2>各社は何を伝えているか</h2><ul><li><strong>各社が揃って伝えていること:</strong> …</li><li><strong>媒体名:</strong> 固有の内容（差がある場合のみ）</li></ul>
  （冒頭の事実再掲禁止。論調の差・追加情報だけ。差が無ければ「大きな差は確認できない」1行）
<h2>これまでの流れ</h2><ul><li><strong>日付:</strong> …</li></ul>
  （日付付きの変遷がある場合のみ。無ければセクション省略）
<h2>背景</h2><ul><li>…</li></ul>（本件固有の経緯が補える場合のみ。辞書定義禁止。無ければ省略）
<h2>数字で見る</h2><ul><li>…</li></ul>（統計・金額・比率など抜粋にある数値のみ。無ければ省略）
<h2>まだ分からないこと</h2><ul><li>…</li></ul>（未確定点を1〜3項目）
<h2>出典</h2><ul><li><a href>…</a></li></ul>（与えられたURLのみ）`;

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

/** 30字超の長いclaimは検証が不安定になるため、事前に分割・短縮する */
const MAX_CLAIM_CHARS = 30;

/** attribution-only / vague / too-long claims — skip nano verify to save cost */
const THIN_CLAIM_PATTERN =
  /^(?:と(?:報じ|伝え|述べ|指摘|主張)|(?:報じ|伝え|述べ|指摘|主張)(?:ている|ています|られた)|その他|なお|また|一方|加えて|さらに|具体的|詳細は|記事で|以下|上記|下記)/u;

function isThinClaim(text: string): boolean {
  const t = text.trim();
  if (t.length > MAX_CLAIM_CHARS) return true;      // too long → unstable for nano
  if (t.length < 5) return true;                     // too short
  return THIN_CLAIM_PATTERN.test(t);
}

/**
 * UnsupportedになったclaimをarticleHtmlから該当文を削除して局所修正する。
 * 全文再生成より遥かに安い（0円）。該当文が見つからなければ元のHTMLをそのまま返す。
 */
function stripUnsupportedClaimsFromHtml(
  articleHtml: string,
  unsupported: UngroundedClaim[],
): string {
  let html = articleHtml;
  for (const u of unsupported) {
    // unsupported.text は claim の text。最大で20文字前方・後方を含めて削除する
    const target = u.text.trim();
    if (target.length < 6) continue;
    // 「。Aは〜と報じている。」のような文を丸ごと削除
    // 前後に句点があれば含めて削除、なければclaim文字列だけ削除
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 文単位で削除: 「。claim_text。」または「 claim_text」を削除
    const patterns = [
      new RegExp(`。${escaped}[。．]?`, "g"),
      new RegExp(`[。．]${escaped}`, "g"),
      new RegExp(`<li>[^<]*?${escaped}[^<]*?</li>`, "gi"),
    ];
    for (const re of patterns) {
      const before = html.length;
      html = html.replace(re, "");
      if (html.length < before) break; // 削除成功 → 次へ
    }
  }
  return html;
}

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
  /** e-Stat政府統計（経済系トピックで数値の一次情報として使う・名称レベル） */
  estatStats?: { statsName: string; govOrg: string; statsDataUrl: string; surveyDate: string }[];
  /**
   * e-Stat基幹指標の確定数値（CPI・失業率等）。textは決定的に組み立てた逐語文字列で、
   * Writerはこれを一字一句そのまま引用する（数値の改変・再計算・時点の推測は禁止）。
   * 政府の確定値なので事実裏取り検証の対象外（数値グラウンディングのhaystackに加える）。
   */
  estatFigures?: { text: string; sourceUrl: string }[];
  /**
   * 参議院本会議の政党別賛否内訳（法案系争点のみ）。
   * Writerはここに書かれた政党名・人数・賛否を一字一句そのまま引用する（改変・要約による人数変更禁止）。
   */
  dietVote?: {
    billTitle: string;
    voteDate: string;
    totalFor: number;
    totalAgainst: number;
    parties: { party: string; memberCount: number; for: number; against: number }[];
    /**
     * 党議に反して投票した議員（離反者）。roleは会議録で確認できた現職閣僚の肩書のみ
     * （党内役職は会議録に載らず確認できないためnull）。空配列＝離反者なし。
     */
    defectors: { name: string; party: string; vote: "for" | "against" | "abstain"; role: string | null }[];
    sourceUrl: string;
  };
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
  /**
   * 長期争点用の過去報道抜粋（historical-enrich）。
   * 「これまでの流れ」専用。直近速報の reportExcerpts とは別バンドル。
   */
  datedExcerpts?: (ReportExcerptInput & { publishedAt?: string })[];
  /**
   * geopolitics + sustained 等で、冒頭=直近24h / タイムライン=確認済み経緯 に分離する。
   */
  timelineFirst?: boolean;
  /**
   * 軸ロック: 現実の対立軸を証拠から確定した結果。Writerに「この軸で書け」と拘束するためのもの。
   * buildLockedAxis（axis-lock.ts）が抽出した軸で、null/undefinedの場合は従来通りWriterが
   * 与えられた資料から軸を判断する（fail-soft）。
   */
  lockedAxis?: { axis: string; sideA: string; sideB: string };
  /**
   * 事前事実抽出結果。nano（RADAR_CLASSIFY_MODEL）が抜粋から抽出した「事実として確定している具体的な内容」のリスト。
   * Writerはこのリストにない事実を書いてはいけない。未定義の場合は従来通り全文から判断する（fail-open）。
   * この仕組みにより、grok-4.3のでっち上げ／hallucinationを原理的に防止する。
   */
  factList?: { fact: string; sourceUrl: string }[];
  /**
   * プロダクトトラック。news のときは両側セクションなしのタイパまとめ記事を書く。
   * 未指定・debate は従来のスプリット議論向け。
   */
  track?: "debate" | "news";
  /**
   * Writerモデルの階層。"economy"は非政治ジャンル向けの低コストモデル（DeepSeek）。
   * DEEPSEEK_API_KEY未設定時はflagshipに自動フォールバックする。未指定はflagship。
   */
  writerTier?: "flagship" | "economy";
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
      固有名詞は翻訳して使うこと（GPIF→「年金運用の巨大基金」等）。一般読者が一発で意味を理解できるように。
    <h2>背景</h2><ul><li>…</li></ul>（国会会議録またはWikipediaで本件固有の経緯が補える場合のみ。辞書定義は禁止。使えなければ省略）
    <h2>法律ではどうなっているか</h2><ul><li>…</li></ul>（関連法令の抜粋がある場合のみ。無ければ省略。「資料にありません」禁止）
    <h2>海外ではどう報じられているか</h2><ul><li><strong>共通:</strong> …</li><li><strong>国内:</strong> …</li><li><strong>海外:</strong> …</li></ul>
      （海外報道抜粋があり、海外が主戦場または意味ある差がある場合のみ。国内主なら省略）
    <h2>どこで意見が分かれるか</h2><ul><li><strong>立場A:</strong> …</li><li><strong>立場B:</strong> …</li></ul>
      （資料の言い分だけ。両側が対になるラベル。与党/野党固定はしない。
      立場が分かれない争点はこのセクションを省略）
    <h2>賛成側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
    <h2>反対側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
      （声明対立なら h2 を当事者名に置き換える。各3〜4項目・同じ分量・同じ根拠密度。
      各<li>に媒体名・発言者・議員名など帰属を付ける。資料に無い教科書一般論で埋めない。
      天災の公式発表など一方の立場が無い場合のみ両セクション省略可）
    <h2>数字で見る世論</h2><ul><li>…</li></ul>（世論調査の数値がある場合のみ。無ければ省略）
    <h2>まだ分からないこと</h2><ul><li>…</li></ul>（未確定点を1〜3項目）
    <h2>出典</h2><ul><li><a href>…</a></li></ul>（与えられたURLのみ）`;

/**
 * REPORTED向け。導火線優先・見出しは読みたくなる言葉。
 * 空セクション・プレースホルダ・他国混入・一般論賛否を禁止。
 */
const REPORTED_FORMAT = `<h2>いま何が論点か</h2><p>3〜4文。必ずこの順序で書く:
     ① 何が起きたか — 事実をストレートに。媒体名は不要。一般読者に伝わる言葉で書く。固有名詞は翻訳する
        （「GPIF→年金運用の巨大基金」「学位剥奪→博士号はく奪」「宮崎麗果→約1.5億円脱税のインフルエンサー」等）
     ② この話が読者の生活・お金・安全・権利にどう関係するか = フック（必ず1文入れる。ここが無いと最後まで読まれない）
     ③ 最小限の経緯（省略してもよい）
     ④ 意見が分かれる軸
     「〜と報じている」「〜と述べた」は書かない。断定しないよう「〜とされる」「〜との見方」等の控えめ表現。lead・bullets1項目目と同一内容</p>
    <h2>どこで意見が分かれるか</h2><ul><li><strong>立場A:</strong> …</li><li><strong>立場B:</strong> …</li></ul>
      （資料の言い分だけ。両側が視覚的に対になるラベル。声明対立は当事者名。戦争・外交は実陣営名。
      曖昧ラベル禁止。立場が分かれない争点は省略。
      争点タイトルに自分ごとフック（貿易・円・燃料・年金・SNS等）があれば、その波及を対立軸の文言に含める）
    <h2>賛成側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
    <h2>反対側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
      （最重要。声明対立なら h2 を当事者名に置き換え、bullets とも揃える。
      各3〜4項目・同じ分量・同じ根拠密度。「いま何が論点か」「各社は何を伝えているか」で既出の事実を繰り返さない。
      各側の主張・理由・反論だけ。各<li>に媒体名・発言者・議員・有識者など帰属を付ける。
      「国際競争力を損なう」「現行法で十分」「慎重にすべき」等の資料に無い教科書一般論で埋めない。
      片側だけ具体・もう片側だけ抽象スローガンは禁止。薄い側の根拠が資料に無ければ捏造せず「まだ分からないこと」へ。
      片方のリストに反対側の応援や両論を混ぜない。他国の数字を混ぜない。
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
  datedExcerptCount = 0,
): boolean {
  if (hasPreviousArticle) return true;
  if (datedExcerptCount >= 3) return true;

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
 * 帰属付き報道表現（「〜と報じている」等）。timelineFirst 時は nano unsupported をソフトパスする。
 * 数値捏造・source_not_found はこの対象外。
 */
const ATTRIBUTED_REPORT_CLAIM =
  /と(?:報じて(?:いる|います|いた)?|伝えて(?:いる|います|いた)?|述べて(?:いる|います)?|発表して(?:いる|います)?)|と報じられて|と伝えられて|との報道|によると|とみられると|と指摘して/;

export function isAttributedReportClaim(text: string): boolean {
  return ATTRIBUTED_REPORT_CLAIM.test(text);
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

/**
 * 長期争点（geopolitics / sustained）向け。速報と確認済み経緯を分離する。
 */
const TIMELINE_FIRST_REPORTED_FORMAT = `<h2>いま何が論点か</h2><p>直近24時間で新たに報じられたことだけを3〜4文。
     ① 何が起きたか — 事実をストレートに。固有名詞は翻訳する。媒体名・帰属は不要
     ② この話が読者の生活・お金・安全・権利にどう関係するか = フック（必ず1文入れる）
     ③ それが何の続きか（1文。詳細は「これまでの流れ」へ）
     ④ いま意見が分かれる軸
     数ヶ月前の経緯の要約をここに詰め込まない。断定しないよう控えめな表現に</p>
    <h2>これまでの流れ</h2><ul><li><strong>M月D日:</strong> 媒体名が報じた確認済みの出来事</li></ul>
      （過去報道抜粋の日付付き項目だけ。古い順。5〜12項目。日付不明は含めない。
      速報の未確認情報を混ぜない。「〜と報じられた」帰属付き）
    <h2>どこで意見が分かれるか</h2><ul><li><strong>立場A:</strong> …</li><li><strong>立場B:</strong> …</li></ul>
      （実在する陣営・立場名。曖昧ラベル禁止）
    <h2>賛成側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
    <h2>反対側が言うこと</h2><ul><li>…</li><li>…</li><li>…</li></ul>
      （陣営名の h2 に置き換えてよい。各3〜4項目・同じ根拠密度。冒頭・タイムラインの事実再掲禁止。
      主張・理由だけ。各項目に媒体・発言者帰属。資料に無い一般論埋め禁止）
    <h2>各社は何を伝えているか</h2><ul><li><strong>各社が揃って伝えていること:</strong> …</li><li><strong>媒体名:</strong> 固有の内容</li></ul>
      （直近報道の論調差・追加情報のみ。タイムラインの再掲禁止）
    <h2>海外ではどう報じられているか</h2><ul><li>…</li></ul>
      （海外報道抜粋があり差がある場合のみ）
    <h2>まだ分からないこと</h2><ul><li>…</li></ul>
      （速報で真偽が揺れている点・公式未確認・報道間の食い違いを1〜4項目。ここが未確定の逃げ場）
    <h2>出典</h2><ul><li><a href>…</a></li></ul>（与えられたURLのみ）`;

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
    estatFigures = [],
    dietVote,
    previousArticle,
    revisionFeedback = [],
    debateType = null,
    reignite = false,
    datedExcerpts = [],
    timelineFirst = false,
    track = "debate",
    writerTier = "flagship",
  } = params;
  const useEconomy = writerTier === "economy" && Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const openai = useEconomy
    ? createEconomyArticleClient({ timeout: 180_000, maxRetries: 1 })
    : createArticleClient({ timeout: 180_000, maxRetries: 1 });
  const writerModel = useEconomy
    ? resolveEconomyArticleModel(AI_MODELS.articleEconomy)
    : resolveArticleModel(AI_MODELS.article);
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

  const claimDiffHint =
    claimDiffBlock
      ? claimDiffBlock
      : "";

  const reportExcerptBlock =
    reportExcerpts.length > 0
      ? `\n\n# 報道本文（参考資料。冒頭の媒体比較ブロックと併せて参照し、事実の裏取り・帰属引用に使う。全件を読もうとせず差分だけ確認すること）
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

  const datedExcerptBlock =
    datedExcerpts.length > 0
      ? `\n\n# 過去報道抜粋（タイムライン専用・${datedExcerpts.length}件）
「これまでの流れ」の材料。日付付きの確認済み経緯だけに使う。直近24時間の速報断定には使わない。
${datedExcerpts
  .map(
    (e, i) =>
      `【過去${i + 1}: ${e.feed}${e.publishedAt ? ` / ${e.publishedAt}` : ""}】${e.title}\n${e.url}\n${e.text}`,
  )
  .join("\n---\n")}`
      : "";

  const estatBlock =
    estatStats.length > 0
      ? `\n\n# 関連政府統計（e-Stat。経済・労働・物価等の争点で、数値の一次情報として「ポイント」または「詳しく」で参照してよい。
URLはe-Stat統計ページのリンクとして出典に含めること）
${estatStats.map((s, i) => `【統計${i + 1}】${s.statsName}（${s.govOrg}、調査時点: ${s.surveyDate || "不明"}）\n${s.statsDataUrl}`).join("\n---\n")}`
      : "";

  // ★★★ 確定政府統計値（e-Stat基幹指標）。textは決定的に組み立てた正確な数値。
  // 一字一句そのまま引用し、数値・単位・時点を絶対に改変・再計算・丸めないこと。
  const estatFiguresBlock =
    estatFigures.length > 0
      ? `\n\n# ★★★ 確定政府統計値（厳守: 以下は政府が公表した確定数値です）★★★
- 数値・単位・時点を含め、**一字一句そのまま**引用すること。改変・再計算・四捨五入・時点の推測は禁止。
- この争点が数値と関係するなら、「ポイント」または「詳しく」で自然に1つ引用する（無理に全部使わなくてよい）。
- 出典URLは出典セクションにリンクとして含めること。
${estatFigures.map((f, i) => `【確定値${i + 1}】${f.text}\n出典: ${f.sourceUrl}`).join("\n")}`
      : "";

  // ★★★ 参議院の政党別賛否内訳。政党名・人数・賛否は一次情報（本会議投票結果）そのもの。
  // 数字の言い換え・要約による改変を禁止し、逐語引用させる。
  // 離反者（党議に反した議員）がいる場合は、そのまま個人名で書ける貴重な材料なので明示的に案内する。
  const defectorLines =
    dietVote && dietVote.defectors.length > 0
      ? `\n\n離反者（党の多数派と逆に投票した議員。実名で書いてよい）:
${dietVote.defectors
  .map(
    (d) =>
      `- ${d.name}（${d.party}${d.role ? `・現職${d.role}` : ""}）が${d.vote === "for" ? "賛成" : d.vote === "against" ? "反対" : "棄権"}`,
  )
  .join("\n")}`
      : "";
  const dietVoteBlock = dietVote
    ? `\n\n# ★★★ 参議院本会議の投票結果（厳守: 以下は公式の記名投票・押しボタン投票の確定結果です）★★★
- 政党名・議席数・賛成/反対の人数・議員名・肩書を**一字一句そのまま**引用すること。合算や概算による書き換え禁止。
- roleが付いていない議員に「◯◯大臣」等の肩書を憶測で付けてはならない（会議録で確認できた人だけにroleが付く）。
- 「各社は何を伝えているか」または「詳しく」で、賛否が分かれた政党の内訳を自然に引用してよい。
- 離反者がいる場合は「◯◯党の△△議員だけが反対した」のような具体的な記述にすると読者の関心を引く。
- 出典URLは出典セクションにリンクとして含めること。
案件: ${dietVote.billTitle}（${dietVote.voteDate}・参議院本会議）
総数: 賛成${dietVote.totalFor}票／反対${dietVote.totalAgainst}票
${dietVote.parties.map((p) => `${p.party}(${p.memberCount}名): 賛成${p.for}／反対${p.against}`).join("\n")}${defectorLines}
出典: ${dietVote.sourceUrl}`
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

  const includeTimeline =
    timelineFirst || isTimelineWorthy(sources, dietSpeeches, !!previousArticle, datedExcerpts.length);
  const isNews = track === "news";
  const format = isNews
    ? NEWS_FORMAT + (includeTimeline ? TIMELINE_SECTION_ADDENDUM : "")
    : timelineFirst
      ? TIMELINE_FIRST_REPORTED_FORMAT
      : (isReported ? REPORTED_FORMAT : OFFICIAL_FORMAT) + (includeTimeline ? TIMELINE_SECTION_ADDENDUM : "");
  const leadSpec = isNews
    ? "「いま分かっていること」と同一。読者への影響（フック）を最初に。固有名詞は翻訳。120〜200字。帰属不要・断定しない。二項対立の軸は書かない"
    : timelineFirst
      ? "「いま何が論点か」と同一。直近24時間の新規報道だけ。読者への影響（フック）を最初に。固有名詞は翻訳。120〜200字。帰属不要・断定しない。経緯の百科要約は禁止"
      : isReported
        ? "「いま何が論点か」と同一。読者への影響（フック）を最初に書く。固有名詞は翻訳する。120〜200字。帰属不要・断定しない"
        : "「いま分かっていること」と同内容。読者への影響（フック）を最初に。固有名詞は翻訳。短い別要約は作らない。120〜200字";
  const effectiveType: DebateType = debateType ?? "policy";
  const bulletsSpec = isNews
    ? `3項目: 1)「いま分かっていること」と同じ具体事実 2)読者への影響・なぜ注目か 3)今後の注目点や未確定点。各40〜120字`
    : debateTypeBulletsSpec(effectiveType, isReported);
  const typeHint = isNews
    ? "この記事はTwoSides News（タイパまとめ）。両側セクションは書かない。事実・影響・各社差・未確定点に集中する。"
    : debateTypeArticleHint(effectiveType, reignite);
  const timelineFirstHint = timelineFirst
    ? "\n# timeline-firstモード: 冒頭=直近24hのみ。経緯は「これまでの流れ」。未確定は「まだ分からないこと」。過去抜粋の日付以外でタイムラインを作らない。"
    : "";

  const intlHint =
    internationalReportExcerpts.length > 0
      ? "\n# 海外報道抜粋あり: 海外が主戦場の争点、または国内との意味ある差があるときだけ「海外ではどう報じられているか」を書く。国内主なら使わずセクション省略。"
      : "\n# 海外報道抜粋なし: 「海外ではどう報じられているか」は出さない。他国の類似事例も書かない。";

  const attributionLabels = [
    ...new Set(
      [
        ...reportExcerpts.map((e) => e.feed),
        ...internationalReportExcerpts.map((e) => e.feed),
        ...dietSpeeches.map((s) => s.speaker).filter(Boolean),
        ...primaryExcerpts.map((e) => e.title).filter(Boolean),
      ]
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 40),
    ),
  ].slice(0, 16);
  const attributionHint =
    attributionLabels.length > 0
      ? `\n# 使える帰属ラベル（両側の各項目で積極的に使う。これに無い一般論で埋めない）: ${attributionLabels.join("、")}`
      : "\n# 帰属: 資料にある媒体名・発言者名だけを使い、教科書一般論で両側を埋めない。";

  // ★★★ 事前事実抽出ブロック: nanoが抜粋から抽出した「事実として確定している具体的な内容」。
  // Writerはこのリストにない事実を書いてはならない（でっち上げ防止）。
  const factFoundationBlock = params.factList && params.factList.length > 0
    ? `\n# ★★★ 確認済み事実リスト（厳守: 以下の事実だけが検証済みです。リストにない具体的記述を書いてはいけません）★★★\n${params.factList.map((f, i) => `${i + 1}. ${f.fact}（出典: ${f.sourceUrl}）`).join("\n")}\n\n（注意: このリストは最低限の事実です。記事に必要十分な情報を網羅しているとは限りません。リスト外の事実を書く代わりに、「詳細はまだ明らかになっていない」などの表現を使ってください。）`
    : "";

  // ★★★ 軸ロックブロック: buildLockedAxisが確定した対立軸。この軸から逸脱した執筆を禁止する。
  const lockedAxisBlock = params.lockedAxis
    ? `\n# ★★★ 論争の軸（厳守: この軸から逸脱しないこと。以下の軸について賛成/反対の両側から整理すること）★★★\n論点: ${params.lockedAxis.axis}\n${params.lockedAxis.sideA} ←→ ${params.lockedAxis.sideB}`
    : "";

  const res = await openai.chat.completions.create({
    model: writerModel,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: isNews ? NEWS_SYSTEM : SYSTEM },
      {
        role: "user",
        content: `争点: ${issueTitle}
種別: ${isReported ? "報道ベース（冒頭は帰属不要・簡潔な事実。詳細セクションでのみ帰属）" : "公式発表ベース"}
目的: スプリットスレッド参加者への最低限の中立土台（長文まとめ・偏向報道にしない）${intlHint}${timelineFirstHint}${attributionHint}

# この争点の書き方（厳守）
${typeHint}
${excerptBlock}${claimDiffHint}${reportExcerptBlock}${internationalReportExcerptBlock}${pollingExcerptBlock}${dietBlock}${datedExcerptBlock}${backgroundBlock}${lawsBlock}${estatBlock}${estatFiguresBlock}${dietVoteBlock}${previousBlock}${revisionBlock}

# 確認済みの報道見出し（前回分含む最新の全件）
${sourceList}
${lockedAxisBlock}${factFoundationBlock}

# 出力形式（JSONのみ）
{
  "lead": "${leadSpec}",
  "bullets": ${bulletsSpec},
  "articleHtml": "HTML。見出しの文言・順序は厳守。各セクション内は箇条書き中心で、長い段落にしない:
    ${format}"${followUpFieldBlock},
  "claims": [{"text": "本文中の具体的事実の要約（30字以内）", "sourceUrl": "根拠にした資料抜粋のURL"}]
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
  params: Partial<Pick<GenerateArticleParams, "sources">> &
    Pick<
      GenerateArticleParams,
      | "primaryExcerpts"
      | "reportExcerpts"
      | "internationalReportExcerpts"
      | "pollingExcerpts"
      | "dietSpeeches"
      | "laws"
      | "background"
      | "datedExcerpts"
    >,
): Map<string, string> {
  const index = new Map<string, string>();
  // Writerには「確認済みの報道見出し」としてsourcesのURLも引用可能と明示しているため、
  // ここに含めないとWriterが見出しだけを根拠に書いたclaimがsource_not_found（存在しないURL扱い）
  // として偽陽性でHELDされてしまう（本文までは無いので後段のunsupported判定に委ねる）。
  for (const s of params.sources ?? []) index.set(s.url, s.title);
  for (const e of params.primaryExcerpts ?? []) index.set(e.url, e.text);
  for (const e of params.reportExcerpts ?? []) index.set(e.url, e.text);
  for (const e of params.internationalReportExcerpts ?? []) index.set(e.url, e.text);
  for (const e of params.pollingExcerpts ?? []) index.set(e.url, e.text);
  for (const e of params.datedExcerpts ?? []) index.set(e.url, e.text);
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
  reason:
    | "source_not_found"
    | "unsupported"
    | "ungrounded_number"
    | "unclaimed_highlight"
    | "opening_too_thin"
    | "incident_first_missing"
    | "duplicate_facts"
    | "bullets_too_thin"
    | "sides_ungrounded"
    | "sides_asymmetric"
    | "lead_opening_mismatch"
    | "relatability_missing"
    | "sentence_too_long"
    | "sides_axis_mismatch";
}

/**
 * UngroundedClaim.reasonのうち「文章の書き方・構成」の問題（本文中の見出しラベル・箇条書きの薄さ・
 * 文の長さ等）で、資料に無い事実を書いた（捏造・裏取り失敗）とは全く別種の失敗。
 * 呼び出し側（promote.ts等）がHELD理由を"unverified_claim"と一括りにして記録すると、
 * 実際には文章のスタイル要件を満たせなかっただけの記事まで「事実がでっち上げられた」ように
 * 見えてしまう（2026-07-16、実データの精査でこの混同を発見）。HELD理由を出す側は
 * hasFactualClaimIssue で分岐し、スタイルのみの失敗は別のdecisionプレフィックスにすること。
 */
export const STRUCTURE_CLAIM_REASONS = new Set<UngroundedClaim["reason"]>([
  "opening_too_thin",
  "incident_first_missing",
  "duplicate_facts",
  "bullets_too_thin",
  "sides_ungrounded",
  "sides_asymmetric",
  "lead_opening_mismatch",
  "relatability_missing",
  "sentence_too_long",
  "sides_axis_mismatch",
]);

/** unresolvedClaimsに、資料に無い事実を書いた（本物の裏取り失敗）ものが1件でも含まれるか */
export function hasFactualClaimIssue(claims: readonly UngroundedClaim[]): boolean {
  return claims.some((c) => !STRUCTURE_CLAIM_REASONS.has(c.reason));
}

/**
 * "unsupported"（claim単位のnano照合）と"unclaimed_highlight"は、タイパよく読みやすい表現に
 * 言い換えるほど元の資料の字面から離れる（＝わかりやすさを追求すればするほど偽陽性が増える）
 * 構造的な弱点があるチェックのため、ここでは「捏造」とみなさない（公開はブロックしない）。
 *
 * 一方で以下の2つは言い換えでは説明がつかない、実害の大きい捏造:
 * - "source_not_found": claimが存在しないURLを引用している（出典の捏造）
 * - "ungrounded_number": 本文の金額・割合・件数が資料のどこにも数値として存在しない
 *   （findUngroundedNumbersは単位換算（億→兆等）まで許容した上で判定しているため、
 *   ここに残るのは言い換えでは説明できないケースに絞られている）
 * この2つが1件でもあれば公開をブロックする。
 */
const HARD_FACTUAL_CLAIM_REASONS = new Set<UngroundedClaim["reason"]>([
  "source_not_found",
  "ungrounded_number",
]);

/** unresolvedClaimsに、言い換えでは説明がつかない捏造（存在しない出典・存在しない数値）が含まれるか */
export function hasHardFactualClaimIssue(claims: readonly UngroundedClaim[]): boolean {
  return claims.some((c) => HARD_FACTUAL_CLAIM_REASONS.has(c.reason));
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

const MONEY_UNIT_MULTIPLIER: Record<string, number> = {
  "兆円": 1e12,
  "億円": 1e8,
  "万円": 1e4,
  "円": 1,
};
const MONEY_TOKEN_PATTERN = /[0-9]+(?:\.[0-9]+)?(?:兆円|億円|万円|円)/g;

/** 「30兆円」「3000億円」等の金額トークンを円単位の数値に変換する。金額以外はnull */
function parseMoneyToYen(token: string): number | null {
  const m = normalizeDigits(token).match(/^([0-9]+(?:\.[0-9]+)?)(兆円|億円|万円|円)$/);
  if (!m) return null;
  return parseFloat(m[1]) * MONEY_UNIT_MULTIPLIER[m[2]];
}

/**
 * 記事が「30000億円」を読みやすく「3兆円」と単位変換して書いた場合、文字列としては
 * 資料本文に出現しないが数値としては同じ事実。捏造ではなく言い換えなので、
 * 円換算した数値が資料本文のどこかの金額表現と一致すればグラウンディング済みとみなす。
 */
function isMoneyEquivalentInHaystacks(token: string, haystacks: string[]): boolean {
  const targetYen = parseMoneyToYen(token);
  if (targetYen === null) return false;
  for (const h of haystacks) {
    const matches = h.match(MONEY_TOKEN_PATTERN) ?? [];
    for (const m of matches) {
      const yen = parseMoneyToYen(m);
      if (yen !== null && Math.abs(yen - targetYen) <= Math.max(1, targetYen * 1e-6)) return true;
    }
  }
  return false;
}

/** 与えた資料本文（+見出し）のどこにも出現しない数値を検出する */
export function findUngroundedNumbers(numbers: string[], haystacks: string[]): string[] {
  const normalizedHaystacks = haystacks.map(normalizeDigits);
  return numbers.filter((n) => {
    const normalized = normalizeDigits(n);
    if (normalizedHaystacks.some((h) => h.includes(normalized))) return false;
    if (isMoneyEquivalentInHaystacks(n, haystacks)) return false;
    return true;
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
  /** 検証ループ内で両側mini修理を既に使ったか（品質ゲート側の二重修理を防ぐ） */
  sideRepairUsed: boolean;
}

/**
 * Writer（GPT-5）→Verify（nano、独立呼び出し）→不合格ならWriterへ差し戻し、のループ。
 * 検証は4段: ①claimsのsourceUrlが実在の資料か ②その資料に本当に書かれているか（nano）
 * ③claimsに自己申告されていない数値・強調箇所が資料に見つかるか（網羅性チェック）
 * ④構造（incidentFirst・重複再掲・両側根拠・lead一致・自分ごとブリッジ）— 嘘でなくても読めない／偏った記事を弾く。
 * ①③④は機械的（0円）、②だけnanoを使う。
 * 検証通過後は normalizeArticleSurfaces で lead/bullets を冒頭・両側HTMLに揃える。
 */
export async function generateVerifiedArticle(
  params: GenerateArticleParams,
  maxRetries?: number,
): Promise<VerifiedArticleResult> {
  // timeline-first / reignite は長期争点で直しきれないケースが多いが、
  // 検証不合格でも公開続行（fail-soft）するためリトライは1回で十分。
  // コスト削減: リトライループを減らす（grok-4.3は1回$0.05-0.10）。
  const retries =
    maxRetries ?? (params.timelineFirst || params.reignite ? 1 : 1);
  const index = buildSourceTextIndex(params);
  const sourceTitles = (params.sources ?? []).map((s) => s.title);
  const datedUrls = new Set((params.datedExcerpts ?? []).map((e) => e.url));
  // e-Stat確定指標の逐語文字列は政府の確定値。記事がこの数値を引用しても
  // ungrounded_number で誤検出しないよう、グラウンディング用haystackに含める。
  const estatFigureTexts = (params.estatFigures ?? []).map((f) => f.text);
  // 参議院投票の政党別内訳も同様に確定値。党名・人数の組み合わせをhaystackに含める。
  const dietVoteTexts = params.dietVote
    ? [
        `賛成${params.dietVote.totalFor}反対${params.dietVote.totalAgainst}`,
        ...params.dietVote.parties.map((p) => `${p.party}${p.memberCount}名賛成${p.for}反対${p.against}`),
      ]
    : [];
  const haystacks = [...index.values(), ...sourceTitles, ...estatFigureTexts, ...dietVoteTexts];
  let feedback: string[] = [];
  let article: ArticleJson = { lead: "", bullets: [], articleHtml: "" };
  let sideRepairUsed = false;

  // ★★★ 事前事実抽出: Writer呼び出し前にnanoで全抜粋から事実を抽出する。
  // 抽出された事実だけをWriterに渡すことで、でっち上げ／hallucinationを原理的に防止する。
  // 抽出に失敗した場合はfacts=[]となり、従来通り全抜粋からWriterが判断する（fail-open）。
  const allExcerpts = [
    ...(params.primaryExcerpts ?? []).map(e => ({ url: e.url, text: e.text ?? "" })),
    ...(params.reportExcerpts ?? []).map(e => ({ url: e.url, text: e.text ?? "", feed: e.feed })),
    ...(params.internationalReportExcerpts ?? []).map(e => ({ url: e.url, text: e.text ?? "", feed: e.feed })),
    ...(params.pollingExcerpts ?? []).map(e => ({ url: e.url, text: e.text ?? "", feed: e.feed })),
  ].filter(e => e.text.length >= 20 && e.url.length >= 4);
  const preFacts = await extractKeyFacts(allExcerpts);
  if (preFacts.length > 0) {
    console.log(`  🏗️ 事前事実抽出: ${preFacts.length}件`);
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    article = await generateArticle({ ...params, revisionFeedback: feedback, factList: preFacts.map(f => ({ fact: f.text, sourceUrl: f.sourceUrl })) });
    const claims = article.claims ?? [];

    // ★ A1: thin claim pre-filter — 帰属だけ・短すぎ・長すぎのclaimはnano検証に回さない
    const thickClaims = claims.filter((c) => !isThinClaim(c.text));
    const thinClaimCount = claims.length - thickClaims.length;

    const missingSource = findUngroundedByMissingSource(thickClaims, index);
    const withSource = thickClaims.filter((c) => index.has(c.sourceUrl));
    // timeline-first: 帰属付き速報クレームはソフトパス対象なので nano を呼ばない（コスト削減）
    // タイムライン用（datedExcerpts URL）のクレームは従来どおり厳格照合
    const softPass = (c: (typeof claims)[number]) =>
      Boolean(
        params.timelineFirst &&
          isAttributedReportClaim(c.text) &&
          !datedUrls.has(c.sourceUrl),
      );
    const toCheck = withSource.filter((c) => !softPass(c));

    const checkItems: ClaimToVerify[] = toCheck.map((c, i) => ({
      id: String(i),
      claim: c.text,
      sourceExcerpt: index.get(c.sourceUrl) ?? "",
    }));
    const results = checkItems.length > 0 ? await verifyClaimsAgainstSources(checkItems) : [];
    const supportedById = new Map(results.map((r) => [r.id, r.supported]));
    const unsupported: UngroundedClaim[] = toCheck
      .filter((_c, i) => supportedById.get(String(i)) === false)
      .map((c) => ({ ...c, reason: "unsupported" as const }));

    const ungroundedNumbers: UngroundedClaim[] = findUngroundedNumbers(
      extractGroundableNumbers(article.articleHtml),
      haystacks,
    ).map((text) => ({ text, sourceUrl: "", reason: "ungrounded_number" as const }));

    // <strong>自己申告漏れは強調解除で0円解消（全文再生成しない）
    let workingHtml = article.articleHtml;
    let unclaimedHighlights: UngroundedClaim[] = findUnclaimedHighlights(
      extractHighlightedFacts(workingHtml),
      claims.map((c) => c.text),
      haystacks,
    ).map((text) => ({ text, sourceUrl: "", reason: "unclaimed_highlight" as const }));
    if (unclaimedHighlights.length > 0) {
      workingHtml = stripStrongMarks(
        workingHtml,
        unclaimedHighlights.map((u) => u.text),
      );
      unclaimedHighlights = findUnclaimedHighlights(
        extractHighlightedFacts(workingHtml),
        claims.map((c) => c.text),
        haystacks,
      ).map((text) => ({ text, sourceUrl: "", reason: "unclaimed_highlight" as const }));
    }

    // ★ A2: unsupported claims を局所削除（全文再生成より安い）
    let surgeryCleared: UngroundedClaim[] = [];
    if (unsupported.length > 0) {
      const before = workingHtml.length;
      const stripped = stripUnsupportedClaimsFromHtml(workingHtml, unsupported);
      if (stripped.length < before) {
        workingHtml = stripped;
        surgeryCleared = unsupported;
        console.log(
          `  🔪 claim局所削除: unsupported${unsupported.length}件 / thinスキップ${thinClaimCount}件 — 全文再生成を回避（attempt ${attempt}）`,
        );
      }
    }
    // 局所削除で解消したunsupportedは失敗リストから除外
    const surgeryClearedSet = new Set(surgeryCleared.map((u) => u.text));

    // 0円修復 →（両側だけダメなら）mini局所リライト最大1回
    let working = autoRepairArticle(
      { ...article, articleHtml: workingHtml },
      { issueTitle: params.issueTitle },
    );
    let structureIssues = findStructureIssues(working, {
      isReported: params.isReported,
      debateType: params.debateType,
      issueTitle: params.issueTitle,
      track: params.track,
    });
    const sidesOnly =
      structureIssues.length > 0 &&
      structureIssues.every(
        (i) => i.reason === "sides_ungrounded" || i.reason === "sides_asymmetric",
      );
    if (sidesOnly && !sideRepairUsed) {
      const hints = collectSourceHintsForRepair({
        reportExcerpts: params.reportExcerpts,
        primaryExcerpts: params.primaryExcerpts,
        internationalReportExcerpts: params.internationalReportExcerpts,
        dietSpeeches: params.dietSpeeches,
        claimDiffBlock: params.claimDiffBlock,
      });
      if (hints.length > 0) {
        sideRepairUsed = true;
        try {
          const repairedHtml = await repairSideSectionsWithMini({
            issueTitle: params.issueTitle,
            articleHtml: working.articleHtml,
            sourceHints: hints,
            failureReason: structureIssues.map((i) => i.message).join(" / "),
          });
          if (repairedHtml) {
            working = autoRepairArticle(
              { ...working, articleHtml: repairedHtml },
              { issueTitle: params.issueTitle },
            );
            structureIssues = findStructureIssues(working, {
              isReported: params.isReported,
              debateType: params.debateType,
              issueTitle: params.issueTitle,
              track: params.track,
            });
          }
        } catch {
          // mini修理失敗は握りつぶし、従来の差し戻しへ
        }
      }
    }
    // 両側の論点が設問と同じ軸を向いているか（軸のすり替え検出）。
    // Newsトラックは両側を書かないのでスキップ。
    if (structureIssues.length === 0 && params.track !== "news") {
      const sides = sideSectionsPlain(working.articleHtml);
      if (sides.length >= 2) {
        const [sideA, sideB] = sides;
        const itemsA = sideA.items.length > 0 ? sideA.items : [sideA.text];
        const itemsB = sideB.items.length > 0 ? sideB.items : [sideB.text];
        if (itemsA.some(Boolean) && itemsB.some(Boolean)) {
          const axisCheck = await verifySidesAxisAlignment({
            question: params.issueTitle,
            sideA: { heading: sideA.heading, items: itemsA },
            sideB: { heading: sideB.heading, items: itemsB },
          });
          if (!axisCheck.aligned) {
            structureIssues = [
              ...structureIssues,
              {
                reason: "sides_axis_mismatch",
                message: `「${sideA.heading}」と「${sideB.heading}」が設問と同じ軸で対応していません（${axisCheck.reason || "論点がすり替わっています"}）。どちらか1つの論点に両側を揃えるか、設問側を両側を包含する広さに調整してください。`,
              },
            ];
          }
        }
      }
    }

    article = {
      ...article,
      lead: working.lead,
      bullets: working.bullets,
      articleHtml: working.articleHtml,
    };

    const structureFails: UngroundedClaim[] = structureIssues.map((issue) => ({
      text: issue.message,
      sourceUrl: "",
      reason: issue.reason,
    }));

    const failed = [
      ...missingSource,
      ...unsupported.filter((u) => !surgeryClearedSet.has(u.text)),
      ...ungroundedNumbers,
      ...unclaimedHighlights,
      ...structureFails,
    ];

    // ★★★ 事実整合性チェック（nano）: 事前事実抽出で取得した確認済み事実リストとの整合性を検証
    // extractKeyFactsが空だった（事前抽出未実施）場合はスキップされる
    //
    // 【絶対ルール】事実整合性チェックは常に警告のみ。リトライもHELDも絶対に発生させない。
    // 理由: チェック元のnanoはWriter（GPT-5.6 Luna）より性能が低く、偽陽性が多い。
    // 事実抽出（nano）→ Writer（Luna）→ 検証（nano）の循環でnanoがWriterを正しく評価できる保証はない。
    // よってnanoの検出は参考情報としてログに残すだけにする。
    if (preFacts.length > 0) {
      const consistency = await checkFactConsistency({
        articleHtml: article.articleHtml,
        factList: preFacts.map(f => ({ fact: f.text, sourceUrl: f.sourceUrl })),
      });
      if (!consistency.consistent) {
        console.log(`  🔍 事実整合性チェック: 不整合の可能性 (${consistency.reason}) → 警告のみ（ブロックなし）`);
      } else if (attempt === 1) {
        console.log(`  🔍 事実整合性チェック: OK`);
      }
    }

    if (failed.length === 0) {
      const synced = normalizeArticleSurfaces(article);
      return {
        article: { ...article, lead: synced.lead, bullets: synced.bullets },
        verified: true,
        unresolvedClaims: [],
        attempts: attempt,
        sideRepairUsed,
      };
    }
    if (attempt > retries) {
      const synced = normalizeArticleSurfaces(article);
      return {
        article: { ...article, lead: synced.lead, bullets: synced.bullets },
        verified: false,
        unresolvedClaims: failed,
        attempts: attempt,
        sideRepairUsed,
      };
    }
    feedback = failed.map((f) => {
      if (STRUCTURE_CLAIM_REASONS.has(f.reason)) {
        return f.text;
      }
      return f.sourceUrl
        ? `「${f.text}」（出典として提示されたURL: ${f.sourceUrl}）— 資料での裏付けが確認できません`
        : `「${f.text}」— 与えられた資料のどこにも見つからない記述です。事実確認できる表現に修正するか削除してください。`;
    });
  }
  return {
    article,
    verified: false,
    unresolvedClaims: [],
    attempts: retries + 1,
    sideRepairUsed,
  };
}

/** unclaimed_highlight 用: 該当テキストの <strong> だけ外す（本文は残す） */
export function stripStrongMarks(html: string, texts: string[]): string {
  let out = html;
  for (const raw of texts) {
    const t = raw.trim();
    if (t.length < 2) continue;
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`<strong>${escaped}<\\/strong>`, "gi"), t);
  }
  return out;
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
