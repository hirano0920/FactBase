/**
 * FactBase Radar — GPT-5記事生成の共有ロジック。
 * scripts/radar/summarize.ts（初回生成）と scripts/radar/followup.ts（続報反映）の両方から使う。
 *
 * 名誉毀損・出鱈目要約を構造的に防ぐ設計:
 *   - 入力は「確認済みの見出しとURL」と、公式（官公庁・国会等）ページの本文抜粋のみ。
 *     報道記事の本文もWeb検索も与えない → 報道内容を事実として書く事故を構造的に防ぐ
 *   - 報道ベースの争点は全文「〜と報じられています」形式を強制
 *   - 公式発表ベースの争点は一次資料抜粋に書かれている内容のみ事実として書ける
 *   - 出力後に断定表現の機械チェック → 引っかかったら公開せずHELDに落とす
 *
 * 記事フォーマットは「一言でまとめ → ポイント（争点の性質に応じた3観点）→ 詳しく → 論点 → 出典」
 * の段階的構成（スマホで数秒のスキャン→関心があれば深掘り、の読まれ方に最適化）。
 */
import { AI_MODELS } from "@/lib/constants";
import { createOpenAIClient } from "@/lib/openai-client";

const SYSTEM = `あなたはFactBaseの編集デスクです。速報段階の争点について「現時点で確認できる情報の整理」を書きます。

# 絶対ルール（法的リスク回避・厳守）
- 与えられた見出しリスト・一次資料抜粋に書かれていること以外を書かない。憶測・背景知識・記憶による補完は禁止
- 報道内容を事実として書かない。必ず「〜と○○が報じています」「〜と伝えられています」形式
- 例外: 「一次資料抜粋」（政府・国会・裁判所等の公式ページ本文）に書かれている内容は
  「〜と発表されています」「法案は〜を定めています」と公式発表の内容として書いてよい
- 「違法」「有罪」「汚職」「犯罪」を事実として断定しない。疑惑は「〜との報道がある」とだけ書く
- 個人への評価・推測（「悪質」「怪しい」等）を書かない
- 確認できないことは「確認できないこと」として正直に列挙する。これがFactBaseの価値
- 見出し・一次資料抜粋にない固有名詞・数値・日付を書かない

# 文体
です・ます調。1文60字以内。冷静・中立。感嘆符なし。
箇条書き中心にし、各セクションはスマホで数秒で読み切れる分量にする。
各セクションの最も重要な事実・数字は<strong>で1箇所だけ強調してよい（多用しない）。
長い説明的な段落は書かない。`;

export interface ArticleJson {
  lead: string;
  bullets: string[];
  articleHtml: string;
  /** 続報反映時のみ: 前回からの変化点を1文で（タイムライン表示用）。初回生成時は空文字でよい */
  followUpNote?: string;
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

export interface GenerateArticleParams {
  issueTitle: string;
  isReported: boolean;
  sources: { title: string; url: string; feed: string }[];
  /** 公式ページ本文の抜粋（OFFICIAL争点のみ）。見出しだけでは書けない実質のある内容を書くための材料 */
  primaryExcerpts?: PrimaryExcerptInput[];
  /** 続報再生成時のみ渡す。前回のまとめとの継続性を保たせる */
  previousArticle?: { lead: string; articleHtml: string };
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
    <h2>詳しく（背景と経緯）</h2><ul><li>…</li></ul>（何がどう進んできたか。時系列がわかるように）
    <h2>論点</h2><ul><li>…</li></ul>（意見・評価が分かれうるポイントを中立に2〜3個。読者が自分の立場を考えられる問いの形で。事実が確定していて論点が特にない場合は無理に作らず1個でもよい）
    <h2>現時点で確認できないこと</h2><ul><li>…</li></ul>（正直に列挙）
    <h2>今後の見通し</h2><ul><li>…</li></ul>（次に何が起きるか・見るべき一次情報。国会審議中なら次の審議段階、係争中なら次の期日等）
    <h2>出典</h2><ul><li><a href>…</a></li></ul>（与えられたURLのみ）`;

/**
 * REPORTED（報道ベース・🔴LIVE）向け構成。
 * 「確認できること/できないこと」を分けて情報の錯綜を整理するのが役割。
 */
const REPORTED_FORMAT = `<h2>何が報じられているか</h2><p>1〜2文で要点のみ</p>（どの媒体が何を報じたかの整理のみ）
    <h2>現時点で確認できること</h2><ul><li>…</li></ul>（報道の存在・公式発表の有無。箇条書き）
    <h2>現時点で確認できないこと</h2><ul><li>…</li></ul>（正直に列挙。箇条書き）
    <h2>論点</h2><ul><li>…</li></ul>（この争点で意見が分かれるポイントを中立に2〜3個。読者が自分の立場を持てる問いの形にする）
    <h2>今後見るべき一次情報</h2><ul><li>…</li></ul>（本人声明・政府発表・資料など種類を挙げる。URLは捏造しない）
    <h2>出典</h2><ul><li><a href>…</a></li></ul>（与えられたURLのみ）`;

export async function generateArticle(params: GenerateArticleParams): Promise<ArticleJson> {
  const { issueTitle, isReported, sources, primaryExcerpts = [], previousArticle } = params;
  const openai = createOpenAIClient({ timeout: 60_000, maxRetries: 1 });
  const sourceList = sources
    .map((s, i) => `${i + 1}. [${s.feed}] ${s.title}\n   ${s.url}`)
    .join("\n");

  const excerptBlock =
    primaryExcerpts.length > 0
      ? `\n\n# 一次資料抜粋（公式ページ本文。この内容は公式発表として事実の形で書いてよい）
${primaryExcerpts.map((e, i) => `【資料${i + 1}】${e.title}\n${e.url}\n${e.text}`).join("\n---\n")}`
      : "";

  const previousBlock = previousArticle
    ? `\n\n# 前回までのまとめ（この続きとして更新する。矛盾させず、新情報を反映する）
${previousArticle.lead}
${previousArticle.articleHtml}`
    : "";

  const followUpFieldBlock = previousArticle
    ? `,\n  "followUpNote": "前回からの変化点を1文で（例: 与党幹部が会見でコメントを追加、等）。60字以内"`
    : "";

  const format = isReported ? REPORTED_FORMAT : OFFICIAL_FORMAT;
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
${excerptBlock}${previousBlock}

# 確認済みの報道見出し（前回分含む最新の全件）
${sourceList}

# 出力形式（JSONのみ）
{
  "lead": "${leadSpec}",
  "bullets": ${bulletsSpec},
  "articleHtml": "HTML。見出しの文言・順序は厳守。各セクション内は箇条書き中心で、長い段落にしない:
    ${format}"${followUpFieldBlock}
}`,
      },
    ],
  });

  const text = res.choices[0]?.message?.content ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON抽出失敗");
  return JSON.parse(match[0]) as ArticleJson;
}
