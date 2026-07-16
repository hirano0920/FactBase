import { describe, expect, it } from "vitest";
import { computePromoteRunBudget, countRemainingPeaks } from "../daily-quota";

const BASE = {
  baseLimit: 4,
  minTarget: 0,
  softTarget: 6,
  hardCap: 9,
};

describe("countRemainingPeaks", () => {
  const windows = [
    { hour: 6, minute: 33 },
    { hour: 11, minute: 3 },
    { hour: 16, minute: 3 },
  ];

  function jst(hour: number, minute: number): Date {
    return new Date(Date.UTC(2026, 6, 15, hour - 9, minute));
  }

  it("朝ピーク前は3", () => {
    expect(countRemainingPeaks(jst(5, 0), windows, 60)).toBe(3);
  });

  it("昼ピーク直後は夕方ピークのみ残る", () => {
    expect(countRemainingPeaks(jst(12, 30), windows, 60)).toBe(1);
  });

  it("最終ピーク後は0", () => {
    expect(countRemainingPeaks(jst(18, 0), windows, 60)).toBe(0);
  });
});

describe("computePromoteRunBudget (Selection V2)", () => {
  it("硬上限到達なら走らない", () => {
    const b = computePromoteRunBudget({
      ...BASE,
      todayCount: 9,
      inPeakWindow: true,
      remainingPeaks: 2,
    });
    expect(b.shouldRun).toBe(false);
    expect(b.reason).toBe("daily_hard_cap");
  });

  it("1日の最初のピーク（残り3回）はsoftTargetを均等按分する", () => {
    const b = computePromoteRunBudget({
      ...BASE,
      todayCount: 0,
      inPeakWindow: true,
      remainingPeaks: 3,
    });
    expect(b.shouldRun).toBe(true);
    // softTarget6 ÷ 残り3ピーク = 2本/回（baseLimit4より小さいのでこちらが効く）
    expect(b.targetCount).toBe(2);
    expect(b.reason).toBe("peak");
  });

  it("均等按分により、最初のピークで消費しても最後のピークが空枠にならない", () => {
    // 1回目: 2本公開 → todayCount=2
    const first = computePromoteRunBudget({ ...BASE, todayCount: 0, inPeakWindow: true, remainingPeaks: 3 });
    expect(first.targetCount).toBe(2);
    // 2回目: softの残り(6-2=4) ÷ 残り2ピーク = 2本
    const second = computePromoteRunBudget({ ...BASE, todayCount: 2, inPeakWindow: true, remainingPeaks: 2 });
    expect(second.targetCount).toBe(2);
    // 3回目: softの残り(6-4=2) ÷ 残り1ピーク = 2本。最後まで均等に配分される
    const third = computePromoteRunBudget({ ...BASE, todayCount: 4, inPeakWindow: true, remainingPeaks: 1 });
    expect(third.targetCount).toBe(2);
  });

  it("最低未達でもキャッチアップで増やさない", () => {
    const b = computePromoteRunBudget({
      ...BASE,
      todayCount: 2,
      inPeakWindow: true,
      remainingPeaks: 1,
    });
    expect(b.shouldRun).toBe(true);
    // softの残り(6-2=4) ÷ 残り1ピーク = 4本。baseLimitで頭打ち
    expect(b.targetCount).toBe(4);
    expect(b.reason).toBe("peak");
  });

  it("softTarget到達後はhardCapまで上振れを許容し、残りピークで均等按分する", () => {
    const b = computePromoteRunBudget({
      ...BASE,
      todayCount: 6, // 既にsoftTarget到達
      inPeakWindow: true,
      remainingPeaks: 2,
    });
    // hardの残り(9-6=3) ÷ 残り2ピーク = 2本（切り上げ）
    expect(b.targetCount).toBe(2);
  });

  it("ピーク外は走らない（日次補充なし）", () => {
    const b = computePromoteRunBudget({
      ...BASE,
      todayCount: 0,
      inPeakWindow: false,
      remainingPeaks: 0,
    });
    expect(b.shouldRun).toBe(false);
    expect(b.reason).toBe("outside_peak");
  });

  it("forceならピーク外でも走る", () => {
    const b = computePromoteRunBudget({
      ...BASE,
      todayCount: 0,
      inPeakWindow: false,
      remainingPeaks: 0,
      force: true,
    });
    expect(b.shouldRun).toBe(true);
    expect(b.reason).toBe("force");
    expect(b.targetCount).toBe(4);
  });

  it("hardの残りが少ないときはそれを超えない", () => {
    const b = computePromoteRunBudget({
      ...BASE,
      todayCount: 8,
      inPeakWindow: true,
      remainingPeaks: 1,
    });
    expect(b.targetCount).toBe(1);
  });
});
