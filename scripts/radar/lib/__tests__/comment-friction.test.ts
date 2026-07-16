import { describe, expect, it } from "vitest";
import { computeCommentFrictionScore, MIN_FRICTION_ENGAGEMENT } from "../comment-friction";

function comment(empathyCount: number, negativeCount: number, insightCount = 0, text = "本文が10字以上のコメント") {
  return { text, empathyCount, insightCount, negativeCount };
}

describe("computeCommentFrictionScore", () => {
  it("コメントが無ければundefined（判断不能）", () => {
    expect(computeCommentFrictionScore([])).toBeUndefined();
  });

  it("反応が1件も無ければundefined", () => {
    expect(computeCommentFrictionScore([comment(0, 0), comment(0, 0)])).toBeUndefined();
  });

  it("反応総数がMIN_FRICTION_ENGAGEMENT未満ならundefined（速報直後のノイズ対策）", () => {
    // 合計エンゲージメント20 < 50（閾値）。真っ二つの比率でも判断を保留する
    expect(computeCommentFrictionScore([comment(10, 10)])).toBeUndefined();
    expect(MIN_FRICTION_ENGAGEMENT).toBeGreaterThan(20);
  });

  it("全コメントが共感のみ（うーんゼロ）で反応総数が十分なら0（一方的と判断確定）", () => {
    expect(computeCommentFrictionScore([comment(500, 0), comment(300, 0)])).toBe(0);
  });

  it("共感とうーんが完全に拮抗していれば1（真っ二つ）", () => {
    expect(computeCommentFrictionScore([comment(500, 500)])).toBeCloseTo(1);
  });

  it("一部拮抗・一部一方的なら中間値になる", () => {
    const score = computeCommentFrictionScore([comment(500, 500), comment(500, 0)]);
    expect(score).toBeGreaterThan(0);
    expect(score as number).toBeLessThan(1);
  });

  it("反応数が多いコメントほど重みが大きい（加重平均）", () => {
    // 大量エンゲージメントの拮抗コメント1件 vs 少量エンゲージメントの一方的コメント多数
    const contested = comment(1000, 1000);
    const lopsided = comment(5, 0);
    const score = computeCommentFrictionScore([contested, lopsided, lopsided, lopsided]);
    expect(score as number).toBeGreaterThan(0.8);
  });
});
