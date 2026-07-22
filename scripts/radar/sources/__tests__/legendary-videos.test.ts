import { describe, expect, it } from "vitest";
import { durationToSeconds } from "../legendary-videos";

describe("durationToSeconds", () => {
  it("時・分・秒を含むISO 8601 durationを秒に変換する", () => {
    expect(durationToSeconds("PT1H23M45S")).toBe(1 * 3600 + 23 * 60 + 45);
  });

  it("分のみのdurationを変換する", () => {
    expect(durationToSeconds("PT15M")).toBe(15 * 60);
  });

  it("秒のみのdurationを変換する（Shorts等）", () => {
    expect(durationToSeconds("PT45S")).toBe(45);
  });

  it("未定義・パース不能な値は0を返す（討論の長さフィルタで確実に除外されるように）", () => {
    expect(durationToSeconds(undefined)).toBe(0);
    expect(durationToSeconds("garbage")).toBe(0);
    expect(durationToSeconds("")).toBe(0);
  });
});
