import type { Account, Profile } from "next-auth";
import type { AdapterAccount } from "next-auth/adapters";
import type { Plan } from "@prisma/client";
import { getSql } from "@/lib/neon";
import { kv, rateKey } from "@/lib/redis";
import { registrationIpKey } from "@/lib/geo";
import {
  REGISTRATION_IP_WINDOW_SEC,
  REGISTRATIONS_PER_IP_PER_DAY,
  type RegistrationIpCheck,
} from "@/lib/registration-guard";

export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  plan: Plan;
  createdAt: Date;
};

function newUserId(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export async function findUserByOAuth(
  provider: string,
  providerAccountId: string,
): Promise<AuthUser | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT u.id, u.email, u.name, u.image, u.plan, u."createdAt"
    FROM "Account" a
    JOIN "User" u ON u.id = a."userId"
    WHERE a.provider = ${provider} AND a."providerAccountId" = ${providerAccountId}
    LIMIT 1
  `) as Array<{
    id: string;
    email: string | null;
    name: string | null;
    image: string | null;
    plan: Plan;
    createdAt: string;
  }>;
  const row = rows[0];
  if (!row) return null;
  return { ...row, createdAt: new Date(row.createdAt) };
}

export async function checkRegistrationIpNeon(ip: string): Promise<RegistrationIpCheck> {
  try {
    if (ip === "unknown") return checkRegistrationIpDailyFallback(ip);

    const locked = await kv.get(registrationIpKey(ip));
    if (locked) return "ip_limit";

    const since = new Date(Date.now() - REGISTRATION_IP_WINDOW_SEC * 1000).toISOString();
    const sql = getSql();
    const rows = (await sql`
      SELECT id FROM "User"
      WHERE "registrationIp" = ${ip} AND "createdAt" >= ${since}
      LIMIT 1
    `) as Array<{ id: string }>;
    if (rows.length > 0) return "ip_limit";
    return "allowed";
  } catch (e) {
    console.warn("[auth-store] registration IP check failed, using daily fallback", e);
    return checkRegistrationIpDailyFallback(ip);
  }
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

export async function ensureOAuthUser(
  account: Account,
  profile: Profile,
  registration?: { ip: string; country: string | null },
): Promise<AuthUser> {
  const existing = await findUserByOAuth(account.provider, account.providerAccountId);
  if (existing) return existing;

  const userId = newUserId();
  const accountId = newUserId();
  const email = profile.email ?? null;
  const name = profile.name ?? null;
  const image = profile.picture ?? profile.image ?? null;
  const now = new Date().toISOString();
  const sql = getSql();

  await sql`
    INSERT INTO "User" (id, email, name, image, plan, "registrationIp", "registrationCountry", "createdAt", "updatedAt")
    VALUES (
      ${userId},
      ${email},
      ${name},
      ${image},
      'FREE',
      ${registration?.ip ?? null},
      ${registration?.country ?? null},
      ${now},
      ${now}
    )
  `;

  const adapterAccount = account as AdapterAccount;
  await sql`
    INSERT INTO "Account" (
      id, "userId", type, provider, "providerAccountId",
      refresh_token, access_token, expires_at, token_type, scope, id_token, session_state
    )
    VALUES (
      ${accountId},
      ${userId},
      ${adapterAccount.type},
      ${adapterAccount.provider},
      ${adapterAccount.providerAccountId},
      ${adapterAccount.refresh_token ?? null},
      ${adapterAccount.access_token ?? null},
      ${adapterAccount.expires_at ?? null},
      ${adapterAccount.token_type ?? null},
      ${adapterAccount.scope ?? null},
      ${adapterAccount.id_token ?? null},
      ${adapterAccount.session_state ?? null}
    )
  `;

  if (registration?.ip && registration.ip !== "unknown") {
    try {
      await kv.set(registrationIpKey(registration.ip), userId, {
        ex: REGISTRATION_IP_WINDOW_SEC,
      });
    } catch (e) {
      console.warn("[auth-store] registration IP lock save failed", e);
    }
  }

  return {
    id: userId,
    email,
    name,
    image,
    plan: "FREE",
    createdAt: new Date(now),
  };
}
