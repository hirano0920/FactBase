import { describe, expect, it, vi, afterEach } from "vitest";
import { kv, voteKey, rateKey } from "@/lib/redis";

afterEach(() => {
  vi.useRealTimers();
});

describe("MemoryKv (Upstash未設定時のフォールバック)", () => {
  it("hincrbyで投票カウントを増減できる", async () => {
    const key = voteKey("test-issue-1");
    expect(await kv.hincrby(key, "for", 1)).toBe(1);
    expect(await kv.hincrby(key, "for", 1)).toBe(2);
    expect(await kv.hincrby(key, "against", 1)).toBe(1);
    expect(await kv.hincrby(key, "for", -1)).toBe(1);

    const all = await kv.hgetall(key);
    expect(all).toEqual({ for: 1, against: 1 });
  });

  it("存在しないキーのhgetallは空オブジェクト", async () => {
    expect(await kv.hgetall("vote:nonexistent")).toEqual({});
  });

  it("incr + expireでrate limitウィンドウが機能する", async () => {
    const key = "rate:test:user1:0";
    expect(await kv.incr(key)).toBe(1);
    expect(await kv.incr(key)).toBe(2);
    await kv.expire(key, 60);
    expect(await kv.incr(key)).toBe(3);
  });

  it("decrでカウンタを減らせる", async () => {
    const key = "counter:test";
    expect(await kv.incr(key)).toBe(1);
    expect(await kv.incr(key)).toBe(2);
    expect(await kv.decr(key)).toBe(1);
    expect(await kv.decr(key)).toBe(0);
    expect(await kv.decr(key)).toBe(0);
  });

  it("expire経過後はキーが消える", async () => {
    vi.useFakeTimers();
    await kv.set("temp-key", "value", { ex: 10 });
    expect(await kv.get("temp-key")).toBe("value");
    vi.advanceTimersByTime(11_000);
    expect(await kv.get("temp-key")).toBeNull();
  });

  it("delでキーを削除できる", async () => {
    await kv.set("del-test", "value");
    expect(await kv.get("del-test")).toBe("value");
    await kv.del("del-test");
    expect(await kv.get("del-test")).toBeNull();
  });

  it("rateKeyは同一ウィンドウ内で同じキーを返す", () => {
    const a = rateKey("vote", "user1", 60);
    const b = rateKey("vote", "user1", 60);
    expect(a).toBe(b);
  });
});
