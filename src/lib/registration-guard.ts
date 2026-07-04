import { prisma } from "@/lib/prisma";
import { kv, rateKey } from "@/lib/redis";
import { isGeoFenceEnabled, registrationIpKey } from "@/lib/geo";

/** 同一IPからの新規登録間隔（日） */
export const REGISTRATION_IP_WINDOW_DAYS = 90;
export const REGISTRATION_IP_WINDOW_SEC = REGISTRATION_IP_WINDOW_DAYS * 24 * 3600;

/** KV障害時のフォールバック: 1IPあたり1日5件まで */
export const REGISTRATIONS_PER_IP_PER_DAY = 5;

export type RegistrationIpCheck = "allowed" | "ip_limit";

/**
 * 新規登録のIP制限。
 * 通常: 90日以内に同一IPからの登録があれば拒否。
 * KV/DB障害時: 1日5件のレート制限にフォールバック（完全障害時は通す）。
 */
export async function checkRegistrationIp(ip: string): Promise<RegistrationIpCheck> {
  try {
    return await checkRegistrationIpStrict(ip);
  } catch (e) {
    console.warn("[registration] strict IP check failed, using daily fallback", e);
    return checkRegistrationIpDailyFallback(ip);
  }
}

async function checkRegistrationIpStrict(ip: string): Promise<RegistrationIpCheck> {
  if (ip === "unknown") {
    return checkRegistrationIpDailyFallback(ip);
  }

  const locked = await kv.get(registrationIpKey(ip));
  if (locked) return "ip_limit";

  const since = new Date(Date.now() - REGISTRATION_IP_WINDOW_SEC * 1000);
  const existing = await prisma.user.findFirst({
    where: { registrationIp: ip, createdAt: { gte: since } },
    select: { id: true },
  });
  if (existing) return "ip_limit";

  return "allowed";
}

async function checkRegistrationIpDailyFallback(ip: string): Promise<RegistrationIpCheck> {
  try {
    const windowSec = 24 * 3600;
    const key = rateKey("register", ip, windowSec);
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, windowSec);
    return count > REGISTRATIONS_PER_IP_PER_DAY ? "ip_limit" : "allowed";
  } catch {
    return "allowed";
  }
}

/** linkAccount / 退会時に Redis へ書き込むTTL */
export function registrationIpLockTtlSec(): number {
  return REGISTRATION_IP_WINDOW_SEC;
}

/** 開発・GEO_ALLOW_ALL 時は IP 制限を緩める */
export function isRegistrationIpGuardEnabled(): boolean {
  return isGeoFenceEnabled();
}
