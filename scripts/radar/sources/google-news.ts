/**
 * Google News 検索RSS（無料・APIキー不要）。
 * https://news.google.com/rss/search?q=<キーワード>&hl=ja&gl=JP
 *
 * Radarの「能動調査」の一部。バズ検知したトピック語で関連報道を横断的に集める。
 * 90本の固定RSSを待ち受ける従来設計と違い、トピック起点で「どの媒体が何を報じているか」を
 * 能動的に集められるため、「情報が錯綜している」争点の各社報道を突き合わせる材料になる。
 *
 * 日本語ロケール(ja/JP)に加え、英語圏ロケール(en-US/US)でも同じ日本語トピック語のまま検索する。
 * 検証の結果、翻訳なしでもJapan Times・Reuters・Human Rights Watch等の海外/英字メディアの
 * 記事が拾えることを確認済み（Googleが言語横断でエンティティマッチしている）。
 *
 * 記事本文は取得しない（見出し・媒体名・URLのみ）。本文取得は report-text.ts が別途担う。
 *
 * 耐障害性:
 * - RSS障害（通信エラー・非200応答）に備えてJSONファイルキャッシュを保持（.cache/news-cache/）
 * - RSSリクエスト自体が失敗した場合はキャッシュがあればそれを返す
 *   （200 OKで正当に0件が返った場合はキャッシュにフォールバックしない。
 *   「本当に新着が無い」ケースを古いキャッシュで覆い隠さないため）
 * - 新着データが正常に取れたらキャッシュを更新
 */
import { XMLParser } from "fast-xml-parser";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const SEARCH_URL = "https://news.google.com/rss/search";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

export type NewsRegion = "domestic" | "international";

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  pubDate: string;
  region: NewsRegion;
}

const LOCALE_BY_REGION: Record<NewsRegion, { hl: string; gl: string; ceid: string }> = {
  domestic: { hl: "ja", gl: "JP", ceid: "JP:ja" },
  international: { hl: "en-US", gl: "US", ceid: "US:en" },
};

const CJK_LOCALES: { hl: string; gl: string; ceid: string }[] = [
  { hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" },
  { hl: "ko", gl: "KR", ceid: "KR:ko" },
  { hl: "ru", gl: "RU", ceid: "RU:ru" },
];

/** キャッシュファイルの保存先 */
const CACHE_DIR = path.join(process.cwd(), ".cache", "news-cache");

function cacheKey(term: string, region: string): string {
  return crypto.createHash("md5").update(`${term}:${region}`).digest("hex").slice(0, 12);
}

function cachePath(term: string, region: string): string {
  return path.join(CACHE_DIR, `${cacheKey(term, region)}.json`);
}

function readCache(term: string, region: string): NewsItem[] | null {
  // テスト環境ではキャッシュを読まない（テスト間の干渉を防ぐ）
  if (process.env.VITEST) return null;
  try {
    const file = cachePath(term, region);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw);
    // 1時間以内のキャッシュのみ有効
    if (Date.now() - data.ts > 3_600_000) return null;
    return data.items as NewsItem[];
  } catch {
    return null;
  }
}

function writeCache(term: string, region: string, items: NewsItem[]): void {
  // テスト環境ではキャッシュに書き込まない
  if (process.env.VITEST) return;
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(term, region), JSON.stringify({ ts: Date.now(), items }), "utf-8");
  } catch {
    // キャッシュ失敗は無視（機能低下しない）
  }
}

function stripSourceSuffix(title: string, source: string): string {
  if (source && title.endsWith(` - ${source}`)) return title.slice(0, -(source.length + 3)).trim();
  return title.trim();
}

async function searchByRegion(term: string, limit: number, region: NewsRegion): Promise<NewsItem[]> {
  if (term.trim().length < 2) return [];
  try {
    const params = new URLSearchParams({ q: term, ...LOCALE_BY_REGION[region] });
    const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*;q=0.8" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
    const xml = new XMLParser({ ignoreAttributes: false }).parse(await res.text());
    const rawItems = xml?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    const parsed = items
      .slice(0, limit)
      .map((item: Record<string, unknown>) => {
        const src = item.source as { "#text"?: string } | string | undefined;
        const source = (typeof src === "object" ? src?.["#text"] : src) ?? "";
        const rawTitle = String(item.title ?? "").trim();
        return {
          title: stripSourceSuffix(rawTitle, String(source)),
          source: String(source).trim(),
          url: String(item.link ?? "").trim(),
          pubDate: String(item.pubDate ?? "").trim(),
          region,
        };
      })
      .filter((n: NewsItem) => n.title && n.url);

    // 正常に取れたのでキャッシュに保存
    if (parsed.length > 0) writeCache(term, region, parsed);
    return parsed;
  } catch (e) {
    // RSS障害: キャッシュがあればそれを返す
    const cached = readCache(term, region);
    if (cached) {
      console.warn(`  ⚠️ google-news[${region}] (${term}): RSS障害 (${e}) → キャッシュ${cached.length}件で代替`);
      return cached.slice(0, limit);
    }
    console.warn(`  ⚠️ google-news[${region}] (${term}): 取得失敗 (${e})`);
    return [];
  }
}

/** 国内メディア報道を新しい順に最大 limit 件返す */
export async function searchNews(term: string, limit = 8): Promise<NewsItem[]> {
  return searchByRegion(term, limit, "domestic");
}

/** 海外/英字メディア報道を新しい順に最大 limit 件返す */
export async function searchInternationalNews(term: string, limit = 5): Promise<NewsItem[]> {
  return searchByRegion(term, limit, "international");
}

/**
 * 中国語・韓国語・ロシア語ロケールでGoogle Newsを検索。
 * 各ロケール独立で失敗しても他は続行（Promise.allSettled）。
 * RSS障害時も同様にキャッシュがあればそれを返す。
 */
export async function searchCJKNews(term: string, limitPerLocale = 3): Promise<NewsItem[]> {
  if (term.trim().length < 2) return [];
  const results = await Promise.allSettled(
    CJK_LOCALES.map(async (locale) => {
      const params = new URLSearchParams({ q: term, ...locale });
      const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*;q=0.8" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
      const xml = new XMLParser({ ignoreAttributes: false }).parse(await res.text());
      const rawItems = xml?.rss?.channel?.item ?? [];
      const items = Array.isArray(rawItems) ? rawItems : [rawItems];
      return items.slice(0, limitPerLocale).map((item: Record<string, unknown>) => {
        const src = item.source as { "#text"?: string } | string | undefined;
        const source = (typeof src === "object" ? src?.["#text"] : src) ?? "";
        const rawTitle = String(item.title ?? "").trim();
        return {
          title: stripSourceSuffix(rawTitle, String(source)),
          source: String(source).trim(),
          url: String(item.link ?? "").trim(),
          pubDate: String(item.pubDate ?? "").trim(),
          region: "international" as NewsRegion,
        };
      }).filter((n: NewsItem) => n.title && n.url);
    }),
  );
  const seen = new Set<string>();
  const fresh: NewsItem[] = [];
  const cjkKey = "cjk";
  for (const r of results) {
    if (r.status === "fulfilled") {
      for (const n of r.value) {
        if (!n.url || seen.has(n.url)) continue;
        seen.add(n.url);
        fresh.push(n);
      }
    }
  }
  // 新着データがあればキャッシュ
  if (fresh.length > 0) writeCache(term, cjkKey, fresh);
  // 全ロケール失敗でキャッシュがあればそれを返す
  if (fresh.length === 0) {
    const cached = readCache(term, cjkKey);
    if (cached) {
      console.warn(`  ⚠️ google-news[CJK] (${term}): RSS全失敗 → キャッシュ${cached.length}件で代替`);
      return cached.slice(0, limitPerLocale * CJK_LOCALES.length);
    }
  }
  return fresh;
}
