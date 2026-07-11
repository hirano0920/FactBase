/**
 * 媒体別主張の構造化抽出とdiff（④）。
 *
 * 従来はreportExcerpts（各社本文の生テキスト）をそのままWriter（GPT系）のプロンプトに詰め、
 * 「一致点・食い違いを比較して書け」という指示だけに頼っていた。これだと
 *   - 関連度の低い主張（例: 国内争点なのに海外の別事例）が紛れ込んでも気づけない
 *   - 実際は1媒体しか言っていない主張を「各社共通」であるかのように書いてしまう
 * といった失敗が実例（eval-articles.tsの記録）で確認されている。
 *
 * ここでは書き手とは別の安価なモデル（gpt-5-nano）に「媒体ごとの主張を抽出→
 * 一致点/食い違い/単独媒体のみの主張」に機械的に整理させ、Writerには
 * 生テキストに加えてこの構造化サマリも渡す。診断的な中間層を1つ挟むことで、
 * 比較をWriterの一発推論だけに任せない。
 */
import { z } from "zod";
import { createOpenAIClient } from "../../../src/lib/openai-client";
import { AI_MODELS } from "../../../src/lib/constants";

export interface OutletExcerptInput {
  feed: string;
  title: string;
  text: string;
}

const CLAIM_DIFF_SCHEMA = z.object({
  agreements: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
  outletOnly: z
    .array(z.object({ outlet: z.string(), claim: z.string() }))
    .default([]),
});

export type ClaimDiffResult = z.infer<typeof CLAIM_DIFF_SCHEMA>;

export const EMPTY_CLAIM_DIFF: ClaimDiffResult = { agreements: [], conflicts: [], outletOnly: [] };

const CLAIM_DIFF_SYSTEM = `あなたはファクトチェック担当のリサーチアシスタントです。
複数媒体の報道抜粋が与えられます。媒体をまたいで、以下3種類に主張を機械的に仕分けてください。

- agreements: 複数媒体が共通して伝えている事実（媒体名は付けず、内容だけを簡潔に）
- conflicts: 媒体間で内容が食い違っている点（両方の言い分を1項目にまとめて書く。例:「A社は〜と報じる一方、B社は〜と報じる」）
- outletOnly: 1媒体だけが伝えていて他媒体に無い主張（outletに媒体名、claimに内容。他の争点や無関係な事例が混入している可能性がある記述は必ずここに分類する）

一般論・見出しの言い換えは無視し、具体的な事実主張だけを対象にしてください。
該当が無いカテゴリは空配列で返してください。必ずJSONのみで回答してください。`;

/** JSON解析・スキーマ不一致時は空のdiffにフォールバック（Writerには生テキストのみで従来通り渡る） */
function parseClaimDiffResponse(raw: string): ClaimDiffResult {
  try {
    const json = JSON.parse(raw) as unknown;
    const parsed = CLAIM_DIFF_SCHEMA.safeParse(json);
    if (parsed.success) return parsed.data;
  } catch {
    // フォールスルー
  }
  return EMPTY_CLAIM_DIFF;
}

/**
 * 媒体横断で2件以上の抜粋があるときだけ比較する意味があるため、それ未満は空diffを即返す
 * （nano呼び出し自体をスキップしてコストを避ける）。
 */
export async function buildClaimDiff(excerpts: OutletExcerptInput[]): Promise<ClaimDiffResult> {
  const distinctOutlets = new Set(excerpts.map((e) => e.feed)).size;
  if (excerpts.length < 2 || distinctOutlets < 2) return EMPTY_CLAIM_DIFF;

  const openai = createOpenAIClient({ timeout: 60_000, maxRetries: 2 });
  const body = excerpts
    .map((e, i) => `【${i + 1}: ${e.feed}】${e.title}\n${e.text}`)
    .join("\n---\n");
  const res = await openai.chat.completions.create({
    model: AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CLAIM_DIFF_SYSTEM },
      { role: "user", content: body },
    ],
  });
  return parseClaimDiffResponse(res.choices[0]?.message?.content ?? "{}");
}

/** Writerプロンプトに埋め込む用のテキストブロック。3カテゴリとも空ならnullを返す */
export function formatClaimDiffBlock(diff: ClaimDiffResult): string {
  if (diff.agreements.length === 0 && diff.conflicts.length === 0 && diff.outletOnly.length === 0) {
    return "";
  }
  const agreementsBlock =
    diff.agreements.length > 0 ? `各社共通:\n${diff.agreements.map((a) => `- ${a}`).join("\n")}` : "";
  const conflictsBlock =
    diff.conflicts.length > 0 ? `\n媒体間で食い違い:\n${diff.conflicts.map((c) => `- ${c}`).join("\n")}` : "";
  const outletOnlyBlock =
    diff.outletOnly.length > 0
      ? `\n特定媒体限定の主張（他媒体の裏付けなし。安易に「共通見解」として書かない。無関係な事例の混入に注意）:\n${diff.outletOnly
          .map((o) => `- [${o.outlet}] ${o.claim}`)
          .join("\n")}`
      : "";
  return `\n\n# 媒体横断diff（機械的な事前比較。生の報道抜粋と併せて使うこと）
${agreementsBlock}${conflictsBlock}${outletOnlyBlock}`;
}
