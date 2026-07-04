/** 日本国内アクセス判定・IP取得（Vercel / Cloudflare ヘッダー） */

export const DOMESTIC_COUNTRY = "JP";

/** 本番では国内のみ。開発は GEO_ALLOW_ALL=true または NODE_ENV≠production で緩和 */
export function isGeoFenceEnabled(): boolean {
  if (process.env.GEO_ALLOW_ALL === "true") return false;
  if (process.env.NODE_ENV !== "production") return false;
  return true;
}

export function getClientIpFromHeaders(headers: Headers): string {
  return (
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/** ISO 3166-1 alpha-2（例: JP）。取得不可なら null */
export function getClientCountryFromHeaders(headers: Headers): string | null {
  const raw =
    headers.get("x-vercel-ip-country") ??
    headers.get("cf-ipcountry") ??
    headers.get("x-country-code");
  if (!raw || raw === "XX" || raw === "T1") return null;
  return raw.toUpperCase();
}

/** Middleware用: 国不明(null)は通す。海外は拒否 */
export function isDomesticCountryForMiddleware(country: string | null): boolean {
  if (!isGeoFenceEnabled()) return true;
  if (country === null) return true;
  return country === DOMESTIC_COUNTRY;
}

/** 登録・投票API用: JP のみ。国不明は拒否 */
export function isDomesticCountryForRegistration(country: string | null): boolean {
  if (!isGeoFenceEnabled()) return true;
  return country === DOMESTIC_COUNTRY;
}

export function isDomesticAccessForMiddleware(headers: Headers): boolean {
  return isDomesticCountryForMiddleware(getClientCountryFromHeaders(headers));
}

export function isDomesticAccessForRegistration(headers: Headers): boolean {
  return isDomesticCountryForRegistration(getClientCountryFromHeaders(headers));
}

/** 投票・コメント等のAPI用（登録と同じ厳しさ） */
export function isDomesticAccess(headers: Headers): boolean {
  return isDomesticAccessForRegistration(headers);
}

/** @deprecated テスト互換。登録/API と同じ判定 */
export function isDomesticCountry(country: string | null): boolean {
  return isDomesticCountryForRegistration(country);
}

export function registrationIpKey(ip: string): string {
  return `register:ip:${ip}`;
}

export function registrationCtxKey(provider: string, providerAccountId: string): string {
  return `register:ctx:${provider}:${providerAccountId}`;
}
