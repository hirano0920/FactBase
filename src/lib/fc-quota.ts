import { kv } from "@/lib/redis";
import { FC_DAILY_LIMITS } from "@/lib/constants";
import type { Plan } from "@prisma/client";

export interface QuotaResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
}

const JST_OFFSET_MS = 9 * 3600_000;

/** JST基準の日付キー（UTCのままだと深夜0時ではなく朝9時にリセットされてしまう） */
function todayKey(userId: string): string {
  const jstNow = new Date(Date.now() + JST_OFFSET_MS);
  return `fcq:${userId}:${jstNow.toISOString().slice(0, 10)}`;
}

/**
 * 1回分を消費。キャッシュヒット時も含め、FCボタンが押されたら必ず呼ぶ。
 * 上限超過ならallowed=false。incrはatomicなので同時押しでも二重消費しない。
 */
export async function consumeFcQuota(userId: string, plan: Plan): Promise<QuotaResult> {
  const limit = FC_DAILY_LIMITS[plan];
  if (limit === 0) return { allowed: false, limit, used: 0, remaining: 0 };

  const key = todayKey(userId);
  const used = await kv.incr(key);
  if (used === 1) await kv.expire(key, 86400 + 3600); // 日付跨ぎの余裕を持って失効

  if (used > limit) {
    return { allowed: false, limit, used: limit, remaining: 0 };
  }
  return { allowed: true, limit, used, remaining: limit - used };
}
