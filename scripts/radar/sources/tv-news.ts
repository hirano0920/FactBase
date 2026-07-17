/**
 * 日本の主要地上波テレビ局のニュースRSSフィード。
 * NHK・TBS・フジ・日テレ・テレ朝・テレ東の最新ニュース見出しを無料で取得する。
 *
 * BuzzScore の第5ソースとして機能:
 * - テレビ各社が実際に報じている＝「全国的に注目されている」の確度が高いシグナル
 * - Yahooニュースと違い「読まれたランキング」ではなく「放送/配信された事実」を捉える
 * - YouTube + テレビ = テレビ各社が動画配信 + ニュース記事の両方で報じている
 *
 * 各局RSSの構造は区々だが、いずれもXML(RSS/Atom)を返す。fast-xml-parserで統一パースする。
 * 個別フィードの失敗は静かにスキップ（空配列にフォールバック）。
 */
import { XMLParser } from "fast-xml-parser";

const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

interface FeedConfig {
  label: string;
  url: string;
  /** RSS itemのtitleフィールド名（ほとんどのRSSは rss.channel.item だが Atomは entry.title 等） */
  type: "rss" | "atom";
}

/**
 * 日本の主要地上波テレビ局フィード一覧。
 * NHKは全カテゴリ(0)＋政治(3)＋社会(4)＋国際(5)＋経済(6)を個別取得し重複除去する。
 * 各局フィードはXMLの構造が微妙に異なるため、個別のフォールバック処理を入れる。
 */
const FEEDS: FeedConfig[] = [
  // NHK（RSS, 5カテゴリ）
  { label: "NHK", url: "https://www3.nhk.or.jp/rss/news/cat0.xml", type: "rss" },
  { label: "NHK政治", url: "https://www3.nhk.or.jp/rss/news/cat3.xml", type: "rss" },
  { label: "NHK社会", url: "https://www3.nhk.or.jp/rss/news/cat4.xml", type: "rss" },
  { label: "NHK国際", url: "https://www3.nhk.or.jp/rss/news/cat5.xml", type: "rss" },
  { label: "NHK経済", url: "https://www3.nhk.or.jp/rss/news/cat6.xml", type: "rss" },
  // TBS NewsDig
  { label: "TBS", url: "https://newsdig.tbs.co.jp/rss/news.xml", type: "rss" },
  // FNN（フジテレビ系列）
  { label: "FNN", url: "https://www.fnn.jp/rss/news.xml", type: "rss" },
  // 日テレ
  { label: "日テレ", url: "https://news.ntv.co.jp/rss/news.xml", type: "rss" },
  // テレビ朝日
  { label: "テレ朝", url: "https://news.tv-asahi.co.jp/rss/news.xml", type: "rss" },
  // テレビ東京
  { label: "テレ東", url: "https://www.tv-tokyo.co.jp/rss/news.xml", type: "rss" },
];

export interface TVNewsItem {
  title: string;
  source: string; // "NHK" | "TBS" | "FNN" | "日テレ" | "テレ朝" | "テレ東"
  url: string;
  pubDate?: string;
}

/** RSS item → TVNewsItem */
function parseRssItem(item: Record<string, unknown>, source: string): TVNewsItem | null {
  const title = String(item.title ?? "").trim();
  if (title.length < 6) return null;
  const link = String(item.link ?? "").trim();
  return {
    title,
    source,
    url: link,
    pubDate: String(item.pubDate ?? "").trim() || undefined,
  };
}

/** Atom entry → TVNewsItem（Atomはtitle/linkがオブジェクト形式の場合がある） */
function parseAtomEntry(entry: Record<string, unknown>, source: string): TVNewsItem | null {
  const rawTitle =
    typeof entry.title === "object" ? String((entry.title as Record<string, unknown>)["#text"] ?? entry.title ?? "") : String(entry.title ?? "");
  const title = rawTitle.trim();
  if (title.length < 6) return null;
  const links = entry.link;
  const linkUrl = Array.isArray(links) ? String(links[0]?.["@_href"] ?? "") : String((links as Record<string, unknown>)?.["@_href"] ?? "");
  return {
    title,
    source,
    url: linkUrl,
    pubDate: String(entry.published ?? entry.updated ?? "").trim() || undefined,
  };
}

async function fetchSingleFeed(cfg: FeedConfig): Promise<TVNewsItem[]> {
  try {
    const res = await fetch(cfg.url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const xml = new XMLParser({ ignoreAttributes: false }).parse(await res.text());

    if (cfg.type === "rss") {
      const rawItems = xml?.rss?.channel?.item ?? [];
      const items = Array.isArray(rawItems) ? rawItems : [rawItems];
      return items.map((i: Record<string, unknown>) => parseRssItem(i, cfg.label)).filter((i): i is TVNewsItem => i !== null);
    }
    // Atom
    const rawEntries = xml?.feed?.entry ?? [];
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    return entries.map((e: Record<string, unknown>) => parseAtomEntry(e, cfg.label)).filter((i): i is TVNewsItem => i !== null);
  } catch (e) {
    console.warn(`  ⚠️ tv-news: ${cfg.label} 取得失敗 (${e})`);
    return [];
  }
}

/**
 * 全テレビ局のニュースフィードを並列取得し、重複除去した見出し一覧を返す。
 * 各局独立に失敗しても全体は止まらない（Promise.allSettled）。
 */
export async function fetchTVNewsFeed(): Promise<TVNewsItem[]> {
  const results = await Promise.allSettled(FEEDS.map((cfg) => fetchSingleFeed(cfg)));
  const allItems = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // titleで重複除去
  const seen = new Set<string>();
  const out: TVNewsItem[] = [];
  for (const item of allItems) {
    const key = item.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * BuzzScore用: テレビニュースタイトル一覧だけ返す（assembleBuzzScoreの inputs.tvNewsTitles に渡す）。
 */
export async function fetchTVNewsTitles(): Promise<string[]> {
  const items = await fetchTVNewsFeed();
  return items.map((i) => i.title);
}
