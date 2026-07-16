/**
 * Yahoo!コメントの反応数（共感/なるほど/うーん）から、AIの解釈を介さず
 * 純粋な算術だけで「実際に読者の意見が割れているか」を推定する。
 *
 * 発想: 1件のコメントに「共感した」と「うーん」が両方多く付いている＝
 * そのコメントの立場に賛成する読者と反対する読者が両方一定数いる、という実測の摩擦。
 * 全コメントが共感のみ（うーんがほぼ0）なら、読者の意見はほぼ一致している。
 * assessCommentStanceSpread（コメント文面のLLM分類）と違い、この関数はAIを一切使わない。
 */
import type { YahooCommentEntry } from "../sources/yahoo-news-ranking";

/**
 * Yahoo!投票のMIN_POLL_VOTES（300票未満はノイズとしてデータ不足扱い）と同じ思想。
 * 反応総数がこれ未満のときは「まだ反応が少なすぎて判断できない」として undefined を返し、
 * コメント数件のたまたまの反応だけで0〜1の値を確定させない（速報直後の記事で起きがち）。
 */
export const MIN_FRICTION_ENGAGEMENT = 50;

/**
 * 0（読者の反応がほぼ一方的）〜1（反応が真っ二つに割れている）。
 * 反応数が少ない（ノイズになりやすい）コメントほど重みを下げ、反応の絶対量で加重平均する。
 * 反応の総量がMIN_FRICTION_ENGAGEMENT未満ならundefined（判断保留。呼び出し側は
 * 実測投票同様、次点のシグナル（commentStanceSpread等）にフォールバックできる）。
 */
export function computeCommentFrictionScore(
  comments: readonly YahooCommentEntry[],
): number | undefined {
  let weightedFriction = 0;
  let totalWeight = 0;

  for (const c of comments) {
    const engagement = c.empathyCount + c.negativeCount + c.insightCount;
    if (engagement <= 0) continue;
    const binaryEngagement = c.empathyCount + c.negativeCount;
    if (binaryEngagement <= 0) continue;
    // min/max: 0(片方だけ)〜0.5(真っ二つ)
    const friction = Math.min(c.empathyCount, c.negativeCount) / binaryEngagement;
    weightedFriction += friction * engagement;
    totalWeight += engagement;
  }

  if (totalWeight < MIN_FRICTION_ENGAGEMENT) return undefined;
  // 0〜0.5 のfrictionを 0〜1 にスケールし、Yahoo投票のdivisionScoreと同じレンジに揃える
  return Math.min(1, (weightedFriction / totalWeight) * 2);
}
