import { describe, expect, it } from "vitest";
import { isWithinPeakWindow } from "../schedule";

const WINDOWS = [
  { hour: 7, minute: 30 },
  { hour: 12, minute: 0 },
  { hour: 19, minute: 30 },
];

function jstDate(hour: number, minute: number): Date {
  // JST = UTC+9 なので UTC側は9時間引いて作る
  return new Date(Date.UTC(2026, 6, 6, hour - 9, minute));
}

describe("isWithinPeakWindow", () => {
  it("ピーク時刻ちょうどはtrue", () => {
    expect(isWithinPeakWindow(jstDate(12, 0), WINDOWS, 10)).toBe(true);
  });

  it("許容幅内（数分前後）はtrue", () => {
    expect(isWithinPeakWindow(jstDate(7, 35), WINDOWS, 10)).toBe(true);
    expect(isWithinPeakWindow(jstDate(19, 22), WINDOWS, 10)).toBe(true);
  });

  it("許容幅外はfalse", () => {
    expect(isWithinPeakWindow(jstDate(9, 0), WINDOWS, 10)).toBe(false);
    expect(isWithinPeakWindow(jstDate(3, 0), WINDOWS, 10)).toBe(false);
  });

  it("深夜はどのウィンドウにも該当しない", () => {
    expect(isWithinPeakWindow(jstDate(2, 0), WINDOWS, 10)).toBe(false);
  });

  it("discover.tsの調査起動時間帯（1日7回）にも同じ関数が使える", () => {
    const discoverWindows = [
      { hour: 6, minute: 0 },
      { hour: 10, minute: 0 },
      { hour: 13, minute: 30 },
      { hour: 16, minute: 0 },
      { hour: 18, minute: 0 },
      { hour: 21, minute: 0 },
      { hour: 0, minute: 0 },
    ];
    expect(isWithinPeakWindow(jstDate(6, 5), discoverWindows, 10)).toBe(true);
    expect(isWithinPeakWindow(jstDate(13, 35), discoverWindows, 10)).toBe(true);
    expect(isWithinPeakWindow(jstDate(0, 5), discoverWindows, 10)).toBe(true);
    expect(isWithinPeakWindow(jstDate(7, 30), discoverWindows, 10)).toBe(false);
    expect(isWithinPeakWindow(jstDate(15, 0), discoverWindows, 10)).toBe(false);
  });
});
