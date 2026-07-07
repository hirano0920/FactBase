import { NextResponse, type NextRequest } from "next/server";
import { getClientCountryFromHeaders, isDomesticAccessForMiddleware, isGeoFenceEnabled } from "@/lib/geo";

/** Webhook・認証コールバック・ヘルスチェック等は国判定の対象外 */
const GEO_EXEMPT_PREFIXES = [
  "/auth",
  "/api/stripe/webhook",
  "/api/health",
  "/access-denied",
];

export function middleware(req: NextRequest) {
  if (!isGeoFenceEnabled()) return NextResponse.next();

  const path = req.nextUrl.pathname;
  if (GEO_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }

  if (!isDomesticAccessForMiddleware(req.headers)) {
    const country = getClientCountryFromHeaders(req.headers);
    console.warn(`[geo] blocked path=${path} country=${country ?? "unknown"}`);

    if (path.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: {
            message: "FactBaseは日本国内からのアクセスのみご利用いただけます",
            code: "GEO_BLOCKED",
          },
        },
        { status: 451 },
      );
    }

    const url = req.nextUrl.clone();
    url.pathname = "/access-denied";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // API（OAuthコールバック等）はミドルウェア対象外 — 応答遅延・固まり防止
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
