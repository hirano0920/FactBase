/**
 * Google Trends 日本版の急上昇ワードRSS（無料・APIキー不要）。
 * ニュース記事としては保存しない — SourceEventにはならず、
 * 「クラスタがSNS/検索で実際に話題になっているか」を判定するための
 * キーワード辞書としてのみ detect.ts のスコアリング（trending加点）に使う。
 *
 * RSSには `<ht:approx_traffic>` として検索ボリューム（200+, 1000+, 50000+ 等）も
 * 含まれているが、従来は title（キーワード）だけを抽出しボリュームを捨てていた。
 * 今は traffic も抽出し、BuzzScore で「ちょっとした話題(200+〜)」と
 * 「大バズリ(50000+〜)」を区別できるようにする。
 */
import { XMLParser } from "fast-xml-parser";

// 旧 /trends/trendingsearches/daily/rss は2025年に廃止(404)。現行のTrending Now RSSを使う
const TRENDS_URL = "https://trends.google.com/trending/rss?geo=JP";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

/** 抽出したトレンド1件 */
export interface GoogleTrendItem {
  keyword: string;
  /** "200+", "1000+", "50000+" 等の文字列。パースして数値比較可能 */
  approxTraffic: string;
}

/**
 * approx_traffic の文字列を数値に変換する。
 * "1000+" → 1000, "50000+" → 50000, パースできなければ 0
 */
export function parseApproxTraffic(raw: string): number {
  const m = raw.replace(/[,+]/g, "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

export async function fetchTrendingKeywords(): Promise<string[]> {
  // 従来互換（keywordsのみの配列を返す）
  const items = await fetchTrendingItems();
  return items.map((i) => i.keyword);
}

/** キーワード＋トラフィック量の構造化データを返す（新規使用者向け） */
export async function fetchTrendingItems(): Promise<GoogleTrendItem[]> {
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

    return items
      .map((item: Record<string, unknown>) => {
        const keyword = String(item.title ?? "").trim();
        if (keyword.length < 2) return null;
        // ht:approx_traffic は fast-xml で ht:approx_traffic キーになる
        const traffic = String((item as Record<string, unknown>)["ht:approx_traffic"] ?? "").trim();
        return { keyword, approxTraffic: traffic || "0" };
      })
      .filter((i): i is GoogleTrendItem => i !== null);
  } catch (e) {
    console.warn(`  ⚠️ trends: 取得失敗 (${e})`);
    return [];
  }
}
