import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { kv, rateKey } from "@/lib/redis";
import { getClientIpFromHeaders, isDomesticAccess } from "@/lib/geo";
import type { Session } from "next-auth";

/**
 * CSRF多層防御: 状態変更APIはOriginがサイト自身であることを検証。
 * （1層目はAuth.jsのSameSite=Laxクッキー。これはブラウザ差異への保険）
 */
export function verifyOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetchやサーバー間はOrigin無しがある
  try {
    return new URL(origin).host === req.nextUrl.host;
  } catch {
    return false;
  }
}

/** Vercel/Cloudflare経由のクライアントIP取得（rate limit用） */
export function getClientIp(req: NextRequest): string {
  return getClientIpFromHeaders(req.headers);
}

/** 国内アクセス必須ガード（投票・コメント等） */
export function requireDomesticAccess(req: NextRequest): NextResponse | null {
  if (!isDomesticAccess(req.headers)) {
    return apiError(
      451,
      "FactBaseは日本国内からのアクセスのみご利用いただけます",
      "GEO_BLOCKED",
    );
  }
  return null;
}

export function apiError(status: number, message: string, code?: string) {
  return NextResponse.json({ error: { message, code } }, { status });
}

export const errors = {
  unauthorized: () => apiError(401, "ログインが必要です", "UNAUTHORIZED"),
  forbidden: (message = "この操作にはプランのアップグレードが必要です") =>
    apiError(403, message, "FORBIDDEN"),
  notFound: (message = "見つかりませんでした") => apiError(404, message, "NOT_FOUND"),
  validation: (message: string) => apiError(422, message, "VALIDATION"),
  rateLimited: () =>
    apiError(429, "リクエストが多すぎます。しばらく待ってからお試しください", "RATE_LIMITED"),
  internal: () =>
    apiError(500, "サーバーで問題が発生しました。時間をおいてお試しください", "INTERNAL"),
};

/** ログイン必須ガード。未ログインなら401、Origin不一致なら403を返す。 */
export async function requireSession(req?: NextRequest): Promise<Session | NextResponse> {
  if (req) {
    if (!verifyOrigin(req)) {
      return apiError(403, "不正なリクエスト元です", "BAD_ORIGIN");
    }
    const geoBlock = requireDomesticAccess(req);
    if (geoBlock) return geoBlock;
  }
  const session = await auth();
  if (!session?.user?.id) return errors.unauthorized();
  return session;
}

/**
 * 固定ウィンドウのrate limit。windowSec内にlimit回まで。
 * KV障害時はリクエストを通す（可用性優先）。
 */
export async function checkRateLimit(
  scope: string,
  id: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  try {
    const key = rateKey(scope, id, windowSec);
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, windowSec);
    return count <= limit;
  } catch {
    return true;
  }
}
