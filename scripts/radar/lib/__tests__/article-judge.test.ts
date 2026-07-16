import { describe, expect, it } from "vitest";
import { parseJudgeResponse, averageScore, gateFromScore, JUDGE_AXES, parseGateJudgeResponse } from "../article-judge";

function score(n: number) {
  return { score: n, reason: "test" };
}

describe("parseJudgeResponse", () => {
  it("正しいJSONは7軸すべてパースする", () => {
    const raw = JSON.stringify({
      bothSidesQuality: score(4),
      factualGrounding: score(5),
      neutrality: score(4),
      relatability: score(3),
      depth: score(4),
      clarity: score(5),
      titleHook: score(3),
    });
    const result = parseJudgeResponse(raw);
    expect(result.bothSidesQuality.score).toBe(4);
    expect(result.titleHook.score).toBe(3);
  });

  it("範囲外の点数は1〜5にクランプする", () => {
    const raw = JSON.stringify({
      bothSidesQuality: score(9),
      factualGrounding: score(-2),
      neutrality: score(3),
      relatability: score(3),
      depth: score(3),
      clarity: score(3),
      titleHook: score(3),
    });
    const result = parseJudgeResponse(raw);
    expect(result.bothSidesQuality.score).toBe(5);
    expect(result.factualGrounding.score).toBe(1);
  });

  it("不正なJSONは全軸1点にフォールバックする（平均を壊さない最低点）", () => {
    const result = parseJudgeResponse("not json");
    for (const axis of JUDGE_AXES) {
      expect(result[axis].score).toBe(1);
      expect(result[axis].reason).toContain("採点失敗");
    }
  });

  it("スキーマ不一致（フィールド欠落）も全軸1点にフォールバックする", () => {
    const result = parseJudgeResponse(JSON.stringify({ bothSidesQuality: score(5) }));
    expect(result.factualGrounding.score).toBe(1);
  });
});

describe("averageScore", () => {
  it("7軸の単純平均を返す", () => {
    const s = parseJudgeResponse(
      JSON.stringify({
        bothSidesQuality: score(5),
        factualGrounding: score(5),
        neutrality: score(5),
        relatability: score(5),
        depth: score(5),
        clarity: score(5),
        titleHook: score(5),
      }),
    );
    expect(averageScore(s)).toBe(5);
  });

  it("バラつきがある場合も正しく平均する", () => {
    const s = parseJudgeResponse(
      JSON.stringify({
        bothSidesQuality: score(5),
        factualGrounding: score(1),
        neutrality: score(3),
        relatability: score(3),
        depth: score(3),
        clarity: score(3),
        titleHook: score(3),
      }),
    );
    expect(averageScore(s)).toBeCloseTo(3, 1);
  });
});

describe("gateFromScore", () => {
  it("bothSidesQuality/neutrality/depth/clarityが閾値以上ならok=true", () => {
    const s = parseJudgeResponse(
      JSON.stringify({
        bothSidesQuality: score(4),
        factualGrounding: score(5),
        neutrality: score(4),
        relatability: score(2),
        depth: score(3),
        clarity: score(3),
        titleHook: score(2),
      }),
    );
    const gate = gateFromScore(s);
    expect(gate.ok).toBe(true);
    expect(gate.reason).toBeNull();
  });

  it("bothSidesQualityが閾値未満ならok=falseで理由を返す（片側だけ書かれた記事を落とす）", () => {
    const s = parseJudgeResponse(
      JSON.stringify({
        bothSidesQuality: score(2),
        factualGrounding: score(5),
        neutrality: score(5),
        relatability: score(5),
        depth: score(5),
        clarity: score(5),
        titleHook: score(5),
      }),
    );
    const gate = gateFromScore(s);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("bothSidesQuality=2");
  });

  it("neutralityが閾値未満ならok=false（辞書定義混入・扇動的トーンを落とす）", () => {
    const s = parseJudgeResponse(
      JSON.stringify({
        bothSidesQuality: score(5),
        factualGrounding: score(5),
        neutrality: score(1),
        relatability: score(5),
        depth: score(5),
        clarity: score(5),
        titleHook: score(5),
      }),
    );
    const gate = gateFromScore(s);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("neutrality=1");
  });

  it("depthが閾値未満ならok=false（見出し言い換えの薄い記事を落とす）", () => {
    const s = parseJudgeResponse(
      JSON.stringify({
        bothSidesQuality: score(5),
        factualGrounding: score(5),
        neutrality: score(5),
        relatability: score(5),
        depth: score(2),
        clarity: score(5),
        titleHook: score(5),
      }),
    );
    const gate = gateFromScore(s);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("depth=2");
  });

  it("clarityが閾値未満ならok=false（事件内容が後段の読みにくい記事を落とす）", () => {
    const s = parseJudgeResponse(
      JSON.stringify({
        bothSidesQuality: score(5),
        factualGrounding: score(5),
        neutrality: score(5),
        relatability: score(5),
        depth: score(5),
        clarity: score(2),
        titleHook: score(5),
      }),
    );
    const gate = gateFromScore(s);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain("clarity=2");
  });

  it("ゲート外の軸（relatability/titleHook/factualGrounding）が低くてもゲートしない", () => {
    const s = parseJudgeResponse(
      JSON.stringify({
        bothSidesQuality: score(5),
        factualGrounding: score(1),
        neutrality: score(5),
        relatability: score(1),
        depth: score(3),
        clarity: score(3),
        titleHook: score(1),
      }),
    );
    expect(gateFromScore(s).ok).toBe(true);
  });
});

describe("parseGateJudgeResponse", () => {
  it("4軸だけでもゲート判定できる形に正規化する", () => {
    const s = parseGateJudgeResponse(
      JSON.stringify({
        bothSidesQuality: score(4),
        neutrality: score(4),
        depth: score(3),
        clarity: score(3),
      }),
    );
    expect(gateFromScore(s).ok).toBe(true);
    expect(s.factualGrounding.score).toBe(3);
    expect(s.relatability.reason).toContain("ゲート対象外");
  });
});
