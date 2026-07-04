import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Twitter from "next-auth/providers/twitter";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { kv } from "@/lib/redis";
import {
  getClientCountryFromHeaders,
  getClientIpFromHeaders,
  isDomesticAccessForRegistration,
  registrationCtxKey,
  registrationIpKey,
} from "@/lib/geo";
import {
  checkRegistrationIp,
  isRegistrationIpGuardEnabled,
  registrationIpLockTtlSec,
} from "@/lib/registration-guard";
import type { Plan } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
      plan: Plan;
      createdAt: Date;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    Google({
      allowDangerousEmailAccountLinking: false,
    }),
    Twitter({
      allowDangerousEmailAccountLinking: false,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ account }) {
      if (!account) return false;

      const existing = await prisma.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        },
        select: { id: true },
      });
      if (existing) return true;

      const h = await headers();

      if (!isDomesticAccessForRegistration(h)) {
        console.warn("[auth] registration blocked: non-domestic or unknown country");
        return "/login?error=GeoBlocked";
      }

      if (isRegistrationIpGuardEnabled()) {
        const ip = getClientIpFromHeaders(h);
        const ipCheck = await checkRegistrationIp(ip);
        if (ipCheck === "ip_limit") {
          console.warn(`[auth] registration blocked for ip=${ip}`);
          return "/login?error=IpLimit";
        }

        const country = getClientCountryFromHeaders(h);
        const ctxKey = registrationCtxKey(account.provider, account.providerAccountId);
        try {
          await kv.set(ctxKey, JSON.stringify({ ip, country }), { ex: 600 });
        } catch (e) {
          console.warn("[auth] registration ctx save failed (続行)", e);
        }
      }

      return true;
    },
    session({ session, user }) {
      session.user.id = user.id;
      const dbUser = user as typeof user & { plan: Plan; createdAt: Date };
      session.user.plan = dbUser.plan;
      session.user.createdAt = dbUser.createdAt;
      return session;
    },
  },
  events: {
    async linkAccount({ user, account }) {
      const ctxKey = registrationCtxKey(account.provider, account.providerAccountId);
      const raw = await kv.get(ctxKey);
      if (!raw) return;

      let ip: string;
      let country: string | null;
      try {
        ({ ip, country } = JSON.parse(raw) as { ip: string; country: string | null });
      } catch {
        await kv.set(ctxKey, "", { ex: 1 });
        return;
      }

      try {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            registrationIp: ip,
            registrationCountry: country,
          },
        });
        if (ip !== "unknown") {
          await kv.set(registrationIpKey(ip), user.id!, { ex: registrationIpLockTtlSec() });
        }
      } catch (e) {
        console.error("[auth] registrationIp persist failed", e);
      } finally {
        await kv.set(ctxKey, "", { ex: 1 });
      }
    },
  },
});
