import { describe, expect, it, vi, afterEach } from "vitest";
import { BURST } from "@/lib/constants";
import { acquireFcInflightSlot, releaseFcInflightSlot } from "@/lib/fc-inflight";

afterEach(async () => {
  for (let i = 0; i < BURST.fcMaxInflight + 5; i++) {
    await releaseFcInflightSlot();
  }
});

describe("fc-inflight", () => {
  it("同時実行上限まで確保できる", async () => {
    const slots: boolean[] = [];
    for (let i = 0; i < BURST.fcMaxInflight; i++) {
      slots.push(await acquireFcInflightSlot());
    }
    expect(slots.every(Boolean)).toBe(true);
    expect(await acquireFcInflightSlot()).toBe(false);
  });

  it("release後は再度確保できる", async () => {
    for (let i = 0; i < BURST.fcMaxInflight; i++) await acquireFcInflightSlot();
    expect(await acquireFcInflightSlot()).toBe(false);
    await releaseFcInflightSlot();
    expect(await acquireFcInflightSlot()).toBe(true);
  });
});
