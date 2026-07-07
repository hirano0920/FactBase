import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { headers } from "next/headers";
import { isAdminEmail } from "@/lib/admin-emails";
import {
  checkRegistrationIpNeon,
  ensureOAuthUser,
  findUserByOAuth,
} from "@/lib/auth-store";
import { kv } from "@/lib/redis";
import {
  getClientCountryFromHeaders,
  getClientIpFromHeaders,
  isDomesticAccessForRegistration,
  registrationCtxKey,
} from "@/lib/geo";
import { isRegistrationIpGuardEnabled } from "@/lib/registration-guard";
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
      isAdmin: boolean;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  basePath: "/auth",
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  providers: [
    Google({
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

      const existing = await findUserByOAuth(account.provider, account.providerAccountId);
      if (existing) return true;

      const h = await headers();

      if (!isDomesticAccessForRegistration(h)) {
        console.warn("[auth] registration blocked: non-domestic or unknown country");
        return "/login?error=GeoBlocked";
      }

      if (isRegistrationIpGuardEnabled()) {
        const ip = getClientIpFromHeaders(h);
        const ipCheck = await checkRegistrationIpNeon(ip);
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
    async jwt({ token, account, profile }) {
      if (account && profile) {
        let registration: { ip: string; country: string | null } | undefined;
        const ctxKey = registrationCtxKey(account.provider, account.providerAccountId);
        const raw = await kv.get(ctxKey);
        if (raw) {
          try {
            registration = JSON.parse(raw) as { ip: string; country: string | null };
          } catch {
            /* ignore */
          } finally {
            await kv.set(ctxKey, "", { ex: 1 });
          }
        }

        const dbUser = await ensureOAuthUser(account, profile, registration);
        token.sub = dbUser.id;
        token.plan = dbUser.plan;
        token.createdAt = dbUser.createdAt.toISOString();
        token.isAdmin = isAdminEmail(dbUser.email);
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        const createdAt =
          typeof token.createdAt === "string" ? new Date(token.createdAt) : new Date();
        session.user.id = token.sub;
        session.user.plan =
          typeof token.plan === "string" ? (token.plan as Plan) : "FREE";
        session.user.createdAt = createdAt;
        session.user.isAdmin = token.isAdmin === true;
      }
      return session;
    },
  },
});
