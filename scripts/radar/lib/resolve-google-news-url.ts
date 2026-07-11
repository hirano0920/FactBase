/**
 * Google News RSS の articles/CBMi… URL を出版社の実URLに解決する。
 *
 * 2024年以降、RSSの link は news.google.com のエンコードURLになり、
 * そのまま fetch しても本文が取れない（Googleのランディングページだけ返る）。
 * 記事ページから signature/timestamp を取り、batchexecute(Fbv4je) で実URLを得る。
 *
 * 参考: https://gist.github.com/scott2b/25c6ecd45caf960c137d86e05e166f3c
 */
import { UA } from "./primary-text";

const BATCH_EXECUTE_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute";

export function isGoogleNewsArticleUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "news.google.com" &&
      (u.pathname.includes("/articles/") || u.pathname.includes("/rss/articles/"))
    );
  } catch {
    return false;
  }
}

function articleIdFromUrl(url: string): string {
  return url.replace(/\/$/, "").split("/").pop()?.split("?")[0] ?? "";
}

/** 旧形式（base64にURLが埋め込まれている）をオフラインで試す。失敗したら null */
function tryOfflineDecode(articleId: string): string | null {
  try {
    let str = Buffer.from(articleId, "base64").toString("binary");
    const prefix = Buffer.from([0x08, 0x13, 0x22]).toString("binary");
    if (str.startsWith(prefix)) str = str.slice(prefix.length);
    const suffix = Buffer.from([0xd2, 0x01, 0x00]).toString("binary");
    if (str.endsWith(suffix)) str = str.slice(0, -suffix.length);

    const bytes = Uint8Array.from(str, (c) => c.charCodeAt(0));
    const len = bytes[0] ?? 0;
    if (len >= 0x80) str = str.slice(2, len + 2);
    else str = str.slice(1, len + 1);

    if (str.startsWith("AU_yqL")) return null; // 新形式はオンライン解決が必要
    if (str.startsWith("http://") || str.startsWith("https://")) return str;
    return null;
  } catch {
    return null;
  }
}

async function resolveViaBatchexecute(articleUrl: string, articleId: string): Promise<string | null> {
  const pageRes = await fetch(articleUrl, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ja,en;q=0.9",
    },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!pageRes.ok) return null;
  const pageText = await pageRes.text();

  // まれに Location / canonical で実URLが載る
  const canonical = pageText.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1];
  if (canonical && !canonical.includes("news.google.com")) return canonical;

  const signature = pageText.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = pageText.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!signature || !timestamp) return null;

  const rpcInner = JSON.stringify([
    "garturlreq",
    [
      ["X", "X", ["X", "X"], null, null, 1, 1, "JP:ja", null, 1, null, null, null, null, null, 0, 1],
      "X",
      "X",
      1,
      [1, 1, 1],
      1,
      1,
      null,
      0,
      0,
      null,
      0,
    ],
    articleId,
    Number(timestamp),
    signature,
  ]);
  const fReq = JSON.stringify([[["Fbv4je", rpcInner, null, "generic"]]]);

  const postRes = await fetch(BATCH_EXECUTE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Referer: "https://news.google.com/",
      "User-Agent": UA,
    },
    body: `f.req=${encodeURIComponent(fReq)}`,
    signal: AbortSignal.timeout(20_000),
  });
  if (!postRes.ok) return null;

  let body = await postRes.text();
  if (body.startsWith(")]}'")) body = body.split("\n").slice(1).join("\n");
  body = body.trimStart();
  const firstNl = body.indexOf("\n");
  if (firstNl > 0 && /^\d+$/.test(body.slice(0, firstNl).trim())) {
    body = body.slice(firstNl + 1);
  }

  const envelopes = JSON.parse(body) as unknown;
  if (!Array.isArray(envelopes)) return null;
  for (const env of envelopes) {
    if (
      Array.isArray(env) &&
      env.length >= 3 &&
      env[0] === "wrb.fr" &&
      env[1] === "Fbv4je" &&
      typeof env[2] === "string"
    ) {
      const payload = JSON.parse(env[2]) as unknown;
      if (Array.isArray(payload) && payload[0] === "garturlres" && typeof payload[1] === "string") {
        return payload[1];
      }
    }
  }
  return null;
}

/**
 * Google News URLなら出版社URLに解決。それ以外はそのまま返す。
 * 解決失敗時は null（呼び出し側はスキップ or 別手段へ）。
 */
export async function resolvePublisherUrl(url: string): Promise<string | null> {
  if (!isGoogleNewsArticleUrl(url)) return url;

  const articleId = articleIdFromUrl(url);
  if (!articleId) return null;

  const offline = tryOfflineDecode(articleId);
  if (offline) return offline;

  try {
    return await resolveViaBatchexecute(url, articleId);
  } catch (e) {
    console.warn(`  ⚠️ google-news-resolve (${articleId.slice(0, 24)}…): ${e}`);
    return null;
  }
}
