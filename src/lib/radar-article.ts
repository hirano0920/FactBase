/**
 * FactBase Radar — GPT-5記事生成の共有ロジック。
 * scripts/radar/summarize.ts（初回生成）と scripts/radar/followup.ts（続報反映）の両方から使う。
 *
 * 名誉毀損・出鱈目要約を構造的に防ぐ設計:
 *   - 入力は「確認済みの見出しとURL」のみ。AIに記事本文もWeb検索も与えない
 *     → 知らないことは書けない。書けるのは「何がどの媒体で報じられているか」の整理だけ
 *   - 報道ベースの争点は全文「〜と報じられています」形式を強制
 *   - 出力後に断定表現の機械チェック → 引っかかったら公開せずHELDに落とす
 */
import { AI_MODELS } from "@/lib/constants";
import { createOpenAIClient } from "@/lib/openai-client";

const SYSTEM = `あなたはFactBaseの編集デスクです。速報段階の争点について「現時点で確認できる情報の整理」を書きます。

# 絶対ルール（法的リスク回避・厳守）
- 与えられた見出しリストに書かれていること以外を書かない。憶測・背景知識・記憶による補完は禁止
- 報道内容を事実として書かない。必ず「〜と○○が報じています」「〜と伝えられています」形式
- 「違法」「有罪」「汚職」「犯罪」を事実として断定しない。疑惑は「〜との報道がある」とだけ書く
- 個人への評価・推測（「悪質」「怪しい」等）を書かない
- 確認できないことは「確認できないこと」セクションに正直に列挙する。これがFactBaseの価値
- 見出しにない固有名詞・数値・日付を書かない

# 文体
です・ます調。1文60字以内。冷静・中立。感嘆符なし。`;

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

export interface GenerateArticleParams {
  issueTitle: string;
  isReported: boolean;
  sources: { title: string; url: string; feed: string }[];
  /** 続報再生成時のみ渡す。前回のまとめとの継続性を保たせる */
  previousArticle?: { lead: string; articleHtml: string };
}

export async function generateArticle(params: GenerateArticleParams): Promise<ArticleJson> {
  const { issueTitle, isReported, sources, previousArticle } = params;
  const openai = createOpenAIClient({ timeout: 60_000, maxRetries: 1 });
  const sourceList = sources
    .map((s, i) => `${i + 1}. [${s.feed}] ${s.title}\n   ${s.url}`)
    .join("\n");

  const previousBlock = previousArticle
    ? `\n\n# 前回までのまとめ（この続きとして更新する。矛盾させず、新情報を反映する）
${previousArticle.lead}
${previousArticle.articleHtml}`
    : "";

  const followUpFieldBlock = previousArticle
    ? `,\n  "followUpNote": "前回からの変化点を1文で（例: 与党幹部が会見でコメントを追加、等）。60字以内"`
    : "";

  const res = await openai.chat.completions.create({
    model: AI_MODELS.article,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `争点: ${issueTitle}
種別: ${isReported ? "報道ベース（真偽未確認ラベル必須）" : "公式発表ベース"}
${previousBlock}

# 確認済みの報道見出し（この情報だけで書く。前回分含む最新の全件）
${sourceList}

# 出力形式（JSONのみ）
{
  "lead": "3行要約。①何が報じられているか ②現時点で確認できること/できないこと ③今の段階。150字以内",
  "bullets": ["確認できること: …", "確認できないこと: …", "今後見るべき一次情報: …"],
  "articleHtml": "HTML。構成厳守:
    <h2>何が報じられているか</h2>（どの媒体が何を報じたかの整理のみ）
    <h2>現時点で確認できること</h2>（報道の存在・公式発表の有無）
    <h2>現時点で確認できないこと</h2>（正直に列挙）
    <h2>論点</h2>（この争点で意見が分かれるポイントを中立に2〜3個）
    <h2>今後見るべき一次情報</h2>（本人声明・政府発表・資料など種類を挙げる。URLは捏造しない）
    <h2>出典</h2>（与えられたURLのみ<a href>で列挙）"${followUpFieldBlock}
}`,
      },
    ],
  });

  const text = res.choices[0]?.message?.content ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON抽出失敗");
  return JSON.parse(match[0]) as ArticleJson;
}
