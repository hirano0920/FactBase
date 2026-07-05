/**
 * Google Trends 日本版の急上昇ワードRSS（無料・APIキー不要）。
 * ニュース記事としては保存しない — SourceEventにはならず、
 * 「クラスタがSNS/検索で実際に話題になっているか」を判定するための
 * キーワード辞書としてのみ detect.ts のスコアリング（trending加点）に使う。
 */
import { XMLParser } from "fast-xml-parser";

// 旧 /trends/trendingsearches/daily/rss は2025年に廃止(404)。現行のTrending Now RSSを使う
const TRENDS_URL = "https://trends.google.com/trending/rss?geo=JP";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

export async function fetchTrendingKeywords(): Promise<string[]> {
  try {
    const res = await fetch(TRENDS_URL, {
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/xml, text/xml, */*;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = new XMLParser({ ignoreAttributes: false }).parse(await res.text());
    const rawItems = xml?.rss?.channel?.item ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    const keywords = items
      .map((item: Record<string, unknown>) => String(item.title ?? "").trim())
      .filter((title) => title.length >= 2);
    return Array.from(new Set(keywords));
  } catch (e) {
    console.warn(`  ⚠️ trends: 取得失敗 (${e})`);
    return [];
  }
}
