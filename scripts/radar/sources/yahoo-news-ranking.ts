/**
 * Yahoo!ニュース アクセスランキング（政治・経済・国際圏に限定）。
 * 総合ランキング（スポーツ・芸能混在）は使わない。
 */
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

/** 記事リンクの直後、最初に現れるプレーンテキストのdivを見出しとみなす */
const TITLE_AFTER_LINK = /<a href="https:\/\/news\.yahoo\.co\.jp\/articles\/[a-f0-9]+"[^>]*>[\s\S]{0,2000}?<div class="[^"]+">([^<]{6,120})<\/div>/g;

/** FactBase の争点領域に対応するカテゴリのみ */
const POLITICS_ECONOMY_RANKING_PATHS = [
  "/ranking/access/news/domestic", // 国内（政治・社会）
  "/ranking/access/news/business", // 経済・金融
  "/ranking/access/news/world", // 国際
] as const;

async function fetchRankingPage(path: string): Promise<string[]> {
  const res = await fetch(`https://news.yahoo.co.jp${path}`, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  const html = await res.text();
  return Array.from(html.matchAll(TITLE_AFTER_LINK)).map((m) => m[1].trim());
}

export async function fetchYahooNewsRankingTitles(): Promise<string[]> {
  try {
    const batches = await Promise.all(
      POLITICS_ECONOMY_RANKING_PATHS.map(async (path) => {
        try {
          return await fetchRankingPage(path);
        } catch (e) {
          console.warn(`  ⚠️ yahoo-news-ranking: ${path} 取得失敗 (${e})`);
          return [];
        }
      }),
    );
    return Array.from(new Set(batches.flat()));
  } catch (e) {
    console.warn(`  ⚠️ yahoo-news-ranking: 取得失敗 (${e})`);
    return [];
  }
}
