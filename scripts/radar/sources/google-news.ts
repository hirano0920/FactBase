/**
 * Google News 検索RSS（無料・APIキー不要）。
 * https://news.google.com/rss/search?q=<キーワード>&hl=ja&gl=JP&ceid=JP:ja
 *
 * Radarの「能動調査」の一部。バズ検知したトピック語で関連報道を横断的に集める。
 * 90本の固定RSSを待ち受ける従来設計と違い、トピック起点で「どの媒体が何を報じているか」を
 * 能動的に集められるため、「情報が錯綜している」争点の各社報道を突き合わせる材料になる。
 *
 * 日本語ロケール(ja/JP)に加え、英語圏ロケール(en-US/US)でも同じ日本語トピック語のまま検索する。
 * 検証の結果、翻訳なしでもJapan Times・Reuters・Human Rights Watch等の海外/英字メディアの
 * 記事が拾えることを確認済み（Googleが言語横断でエンティティマッチしている）。
 * これにより「日本のメディアと海外のメディアの報道を突き合わせる」記事が書ける。
 *
 * 記事本文は取得しない（見出し・媒体名・URLのみ）。本文取得は report-text.ts が別途担う。
 */
import { XMLParser } from "fast-xml-parser";

const SEARCH_URL = "https://news.google.com/rss/search";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

export type NewsRegion = "domestic" | "international";

export interface NewsItem {
  title: string;
  source: string; // 媒体名（Yahoo!ニュース 等）
  url: string;
  pubDate: string;
  region: NewsRegion; // 国内メディアか海外メディアかの検索軸（同一媒体が両方に載ることもある）
}

const LOCALE_BY_REGION: Record<NewsRegion, { hl: string; gl: string; ceid: string }> = {
  domestic: { hl: "ja", gl: "JP", ceid: "JP:ja" },
  international: { hl: "en-US", gl: "US", ceid: "US:en" },
};

/** 中・韓・露ロケール（日本の対外関係トピックで一次情報が出やすい言語圏） */
const CJK_LOCALES: { hl: string; gl: string; ceid: string }[] = [
  { hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" },
  { hl: "ko", gl: "KR", ceid: "KR:ko" },
  { hl: "ru", gl: "RU", ceid: "RU:ru" },
];

/** Google Newsのタイトルは「見出し - 媒体名」形式。末尾の媒体名を除いた見出しを返す */
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = new XMLParser({ ignoreAttributes: false }).parse(await res.text());
    const rawItems = xml?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items
      .slice(0, limit)
      .map((item: Record<string, unknown>) => {
        // <source>要素はテキスト（媒体名）と url 属性を持つ。fast-xmlは #text / @_url で返す
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
  } catch (e) {
    console.warn(`  ⚠️ google-news[${region}] (${term}): 取得失敗 (${e})`);
    return [];
  }
}

/** 国内メディア報道を新しい順に最大 limit 件返す */
export async function searchNews(term: string, limit = 8): Promise<NewsItem[]> {
  return searchByRegion(term, limit, "domestic");
}

/** 海外/英字メディア報道を新しい順に最大 limit 件返す（翻訳なしで同じトピック語のまま検索） */
export async function searchInternationalNews(term: string, limit = 5): Promise<NewsItem[]> {
  return searchByRegion(term, limit, "international");
}

/**
 * 中国語・韓国語・ロシア語ロケールでGoogle Newsを検索し、international枠として返す。
 * 対中・対北朝鮮・対露の外交・安保トピックで、英字メディアが拾えない現地語の一次報道を補う。
 * 各ロケール独立で失敗しても他は続行（Promise.allSettled）。
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).filter((n) => {
    if (!n.url || seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
}
