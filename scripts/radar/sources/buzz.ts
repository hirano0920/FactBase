/**
 * はてなブックマーク人気エントリRSS（無料・APIキー不要）。
 * Google Trends（検索の瞬間風速）を補完する「国内SNSでの継続的な関心」シグナル。
 * 世の中(social)・政治と経済(economics)カテゴリの人気エントリタイトルを取得し、
 * SourceEventとしては保存せず、クラスタとのタイトル類似判定（buzzTitleMatch）にのみ使う。
 */
import { XMLParser } from "fast-xml-parser";

const HOTENTRY_URLS = [
  "https://b.hatena.ne.jp/hotentry/social.rss",
  "https://b.hatena.ne.jp/hotentry/economics.rss",
];
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

/**
 * はてブRSSのタイトルはXML内でHTML実体参照が二重エンコードされており
 * (`&amp;#x76D7;` → パーサ後も `&#x76D7;` のまま)、そのままでは日本語見出しとの
 * 類似照合が一切マッチしない。数値文字参照と主要な名前付き実体をここで解決する。
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function fetchHotentry(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/xml, text/xml, */*;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = new XMLParser({ ignoreAttributes: false }).parse(await res.text());
    // はてブhotentryはRDF形式
    const rawItems = xml?.["rdf:RDF"]?.item ?? xml?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    return items
      .map((item: Record<string, unknown>) => decodeHtmlEntities(String(item.title ?? "")).trim())
      .filter((title) => title.length >= 4);
  } catch (e) {
    console.warn(`  ⚠️ hatena-buzz (${url}): 取得失敗 (${e})`);
    return [];
  }
}

export async function fetchHotentryTitles(): Promise<string[]> {
  const results = await Promise.all(HOTENTRY_URLS.map(fetchHotentry));
  return Array.from(new Set(results.flat()));
}
