import { BURST } from "@/lib/constants";
import { FC_INFLIGHT_KEY, kv } from "@/lib/redis";

const INFLIGHT_TTL_SEC = 120;

/** 同時FC AI呼び出し枠を確保。超過時は false（503で返す） */
export async function acquireFcInflightSlot(): Promise<boolean> {
  try {
    const n = await kv.incr(FC_INFLIGHT_KEY);
    if (n === 1) await kv.expire(FC_INFLIGHT_KEY, INFLIGHT_TTL_SEC);
    if (n > BURST.fcMaxInflight) {
      await kv.decr(FC_INFLIGHT_KEY);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export async function releaseFcInflightSlot(): Promise<void> {
  try {
    await kv.decr(FC_INFLIGHT_KEY);
  } catch {
    // ignore
  }
}
