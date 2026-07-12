import { describe, expect, it } from "vitest";
import { parseBullet, splitClaimAndPoints } from "@/lib/summary-display";

describe("summary-display", () => {
  it("ラベルと本文を分ける", () => {
    expect(parseBullet("イラン革命防衛隊側: 封鎖を続けると主張")).toEqual({
      label: "イラン革命防衛隊側",
      text: "封鎖を続けると主張",
    });
  });

  it("対立文を芯＋根拠に分ける", () => {
    const r = splitClaimAndPoints(
      "米国などへの反撃として封鎖すると主張しています。安全保障上の不安が解消されるまで通航を認めないとしています。",
    );
    expect(r.claim).toContain("封鎖する");
    expect(r.points.length).toBe(1);
    expect(r.points[0]).toContain("安全保障");
  });
});
