import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeFcQuota } from "@/lib/fc-quota";

afterEach(() => {
  vi.useRealTimers();
});

describe("consumeFcQuota", () => {
  it("FREEプランは常に不許可", async () => {
    const result = await consumeFcQuota("u-free", "FREE");
    expect(result).toEqual({ allowed: false, limit: 0, used: 0, remaining: 0 });
  });

  it("COMMENTプラン(Plus/500円)はFC非対象で常に不許可", async () => {
    const userId = `u-comment-${crypto.randomUUID()}`;
    const result = await consumeFcQuota(userId, "COMMENT");
    expect(result).toEqual({ allowed: false, limit: 0, used: 0, remaining: 0 });
  });

  it("FACTCHECKプランは30回まで許可", async () => {
    const userId = `u-fc-${crypto.randomUUID()}`;
    let last;
    for (let i = 0; i < 30; i++) last = await consumeFcQuota(userId, "FACTCHECK");
    expect(last?.allowed).toBe(true);
    expect((await consumeFcQuota(userId, "FACTCHECK")).allowed).toBe(false);
  });

});

describe("JST日付境界（UTCそのままだと朝9時リセットになるバグの回帰テスト）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("UTC 2026-01-01T15:00:00Z（JSTでは01-02 00:00）は01-02のキーとして扱われ、UTC日付では別カウンタになる", async () => {
    const userId = `u-jst-${crypto.randomUUID()}`;

    // JST 2026-01-01 23:59 (UTC 2026-01-01T14:59:00Z) に1回消費
    vi.setSystemTime(new Date("2026-01-01T14:59:00Z"));
    const before = await consumeFcQuota(userId, "FACTCHECK");
    expect(before.used).toBe(1);

    // 1分後、UTC日付はまだ01-01だがJSTでは01-02 00:00（日付が変わっている）
    vi.setSystemTime(new Date("2026-01-01T15:00:00Z"));
    const after = await consumeFcQuota(userId, "FACTCHECK");

    // JST基準で日付が変わっていれば独立したカウンタ（used=1）になるはず
    expect(after.used).toBe(1);
  });
});
