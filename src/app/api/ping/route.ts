import { NextResponse } from "next/server";
import { isDbEnabled } from "@/lib/data";
import { kv, rankingCacheKey } from "@/lib/redis";

export const runtime = "nodejs";

const PING_KV_KEY = "health:ping";

/** 本番診断: Worker・Upstash・ランキングキャッシュの状態 */
export async function GET() {
  const t0 = Date.now();
  let kvRoundtripMs: number | null = null;
  let kvOk = false;
  let rankingCached = false;

  try {
    const tKv = Date.now();
    await kv.set(PING_KV_KEY, "1", { ex: 60 });
    const pong = await Promise.race([
      kv.get(PING_KV_KEY),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    kvRoundtripMs = Date.now() - tKv;
    kvOk = pong === "1";
  } catch {
    kvRoundtripMs = -1;
  }

  try {
    const raw = await kv.get(rankingCacheKey());
    rankingCached = Boolean(raw);
  } catch {
    // ignore
  }

  return NextResponse.json({
    ok: true,
    ts: Date.now(),
    totalMs: Date.now() - t0,
    dbConfigured: isDbEnabled(),
    /** Upstash への set+get が通ったか（これが true なら KV は正常） */
    kvOk,
    kvRoundtripMs,
    /** ランキングデータが KV に載っているか（ISR 配信時は false のまま普通） */
    rankingCached,
    upstashConfigured: Boolean(
      process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
    ),
  });
}
