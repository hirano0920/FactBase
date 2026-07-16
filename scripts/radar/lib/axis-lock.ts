/**
 * 軸ロック（Axis Lock）— ⑤.5: 現実の対立軸を証拠から確定し、Writerの芯ズレを防ぐ。
 *
 * # なぜ必要か
 * 従来はassessDebateLegitimacyやassessEvidenceWriteabilityのような「ゲート」はあっても、
 * Writer（記事生成）に「この軸で書け」と明示的に拘束する仕組みが無かった。
 * その結果、LLMが自身の学習データから「それらしい対立」をでっち上げる芯ズレが発生していた。
 *
 * # 軸の優先順位（信頼度順）
 * 1. Yahoo!投票の設問＋選択肢 — 編集部が作成した最も明確な軸
 * 2. 複数媒体間の主張の食い違い（claimDiff.conflicts）— 実際の報道の不一致
 * 3. 読者コメントの実際の対立 — SNSで実際に起きている議論
 * 4. 報道の見出し — 最も弱いが補助的に使える
 *
 * # 出力
 * lockedAxis: 記事全体を貫く「いま何が論点か」の一文
 * sideA/sideB: 両側の立場を端的に示すラベル
 * source: 軸の根拠とした最優先情報源
 */
import { z } from "zod";
import { createOpenAIClient } from "../../../src/lib/openai-client";
import { AI_MODELS } from "../../../src/lib/constants";
import type { ClaimDiffResult } from "./claim-diff";

export interface AxisLockInput {
  topic: string;
  /** Yahoo!投票の設問（最も信頼できる軸があれば） */
  voteQuestion?: string;
  /** Yahoo!投票の選択肢ラベル */
  pollChoices?: { choice: string; count: number; percent: number }[];
  /** 媒体間の主張の食い違い（claimDiff.conflicts） */
  claimDiffConflicts?: string[];
  /** 読者コメント本文（最大10件） */
  commentSamples?: { text: string; empathyCount: number; insightCount: number; negativeCount: number }[];
  /** 報道の見出し */
  newsTitles?: string[];
}

export interface AxisLockResult {
  /** 論争の軸を一文で（例: 「SNSでの発言を理由にした解職請求は表現の自由の範囲内か」） */
  axis: string;
  /** 片方の立場のラベル（例: 「処分は表現の自由の侵害」） */
  sideA: string;
  /** もう片方の立場のラベル（例: 「公務員としての品位保持義務違反」） */
  sideB: string;
}

const AXIS_LOCK_SCHEMA = z.object({
  axis: z.string().min(5),
  sideA: z.string().min(2),
  sideB: z.string().min(2),
});

const AXIS_LOCK_SYSTEM = `あなたはリサーチアシスタントです。与えられた論争について、実際に起きている対立の軸を特定してください。

# 重要: 絶対に創作しないこと
- 与えられた情報に基づいて軸を特定する。情報にない対立軸を想像してはいけない。
- 軸の根拠は「現実のデータ（投票設問・報道の食い違い・コメント）」でなければならない。

# 情報源の優先順位（上位が最も信頼できる）
1. 投票設問・選択肢: 編集部が作成した公式な軸。これが最も明確な根拠。
2. 報道の食い違い（claimDiff.conflicts）: 複数媒体間で実際に主張が食い違っている点。これが現実の論点。
3. 読者コメント: 実際の読者が議論しているテーマ。
4. 報道の見出し: 最も弱いが補助的な手がかり。

# 出力（JSONのみ）
- axis: 「～か」「～かどうか」で終わる、現実の対立を反映した問い（30〜80字）
- sideA: axisに対する一方の立場（10〜40字）
- sideB: axisに対するもう一方の立場（10〜40字）

必ずJSONのみで回答してください。`;

/**
 * 証拠から論争の軸を抽出・ロックする。
 * fail-soft: nano呼び出し失敗・スキーマ不一致は軸不明としてnullを返す（Writerは従来通り動作）。
 */
export async function buildLockedAxis(input: AxisLockInput): Promise<AxisLockResult | null> {
  // 情報源が少なすぎる → 軸ロック不能。fail-softでnull。
  if (
    !input.voteQuestion &&
    (!input.claimDiffConflicts || input.claimDiffConflicts.length === 0) &&
    (!input.commentSamples || input.commentSamples.length === 0) &&
    (!input.newsTitles || input.newsTitles.length === 0)
  ) {
    return null;
  }

  const parts: string[] = [];
  parts.push(`# トピック\n${input.topic}`);

  if (input.voteQuestion) {
    const choices = input.pollChoices
      ? input.pollChoices.map((c) => `  - ${c.choice}（${c.percent}%）`).join("\n")
      : "";
    parts.push(`# Yahoo!投票（最優先軸）\n設問: ${input.voteQuestion}\n選択肢:\n${choices}`);
  }

  if (input.claimDiffConflicts && input.claimDiffConflicts.length > 0) {
    parts.push(
      `# 媒体間の食い違い（優先軸）\n${input.claimDiffConflicts.map((c) => `  - ${c}`).join("\n")}`,
    );
  }

  if (input.commentSamples && input.commentSamples.length > 0) {
    parts.push(
      `# 読者コメントの意見\n${input.commentSamples
        .map((c) => `  - 「${c.text.slice(0, 100)}」(共感:${c.empathyCount} 批判:${c.negativeCount})`)
        .join("\n")}`,
    );
  }

  if (input.newsTitles && input.newsTitles.length > 0) {
    parts.push(
      `# 報道の見出し\n${input.newsTitles.map((t) => `  - ${t}`).join("\n")}`,
    );
  }

  try {
    const openai = createOpenAIClient({ timeout: 30_000, maxRetries: 1 });
    const res = await openai.chat.completions.create({
      model: AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: AXIS_LOCK_SYSTEM },
        { role: "user", content: parts.join("\n\n") },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = AXIS_LOCK_SCHEMA.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
