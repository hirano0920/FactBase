/**
 * YouTube Data API v3 — 日本向けトレンド動画タイトル取得（バズ検知用）。
 * 環境変数 YOUTUBE_DATA_API_KEY が必要（未設定時は空配列でスキップ）。
 *
 * 取得軸（TwoSides: News & Politics に閉じない）:
 *   1. chart=mostPopular + regionCode=JP（総合トレンド）
 *   2. chart=mostPopular + videoCategoryId=25（News & Politics）
 *   3. 直近6h・order=date の広域検索（社会・時事含む）
 *   4. Yahoo!ニュースランキング見出しをシードにした鮮度優先検索
 *
 * 動画本文・文字起こしは取らない（タイトルをバズ検知の入口に使い、
 * 記事生成は報道本文・一次情報の調査に委ねる）。スポーツ等のノイズは prefilter で落とす。
 */
import { RADAR } from "../../../src/lib/constants";
import { extractBuzzMatchTokens } from "../../../src/lib/buzz-cross-match";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

/** News & Politics（YouTube Data API の categoryId） */
const NEWS_POLITICS_CATEGORY = "25";

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

async function fetchYouTubeApi<T>(label: string, path: string, params: Record<string, string>): Promise<T | null> {
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key) return null;

  const qs = new URLSearchParams({ ...params, key });
  try {
    const res = await fetch(`${API_BASE}/${path}?${qs}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    console.warn(`  ⚠️ youtube-trending: ${label} 取得失敗 (${e})`);
    return null;
  }
}

function collectTitles(items: Array<{ snippet?: { title?: string } } | undefined> | undefined): string[] {
  return (items ?? [])
    .map((item) => item?.snippet?.title?.trim() ?? "")
    .filter((title) => title.length >= 4);
}

/** ニュース見出しから YouTube 検索クエリを生成（鮮度優先検索用） */
export function buildYouTubeNewsSeedQueries(newsTitles: string[], maxQueries: number): string[] {
  const queries = new Set<string>();

  for (const raw of newsTitles) {
    const title = raw.replace(/[「」『』【】]/g, "").trim();
    if (title.length >= 8) {
      queries.add(title.slice(0, 40).trim());
    }

    const tokens = extractBuzzMatchTokens(title).filter((t) => t.length >= 4);
    for (const tok of tokens.slice(0, 2)) {
      queries.add(tok);
    }

    if (queries.size >= maxQueries) break;
  }

  return [...queries].slice(0, maxQueries);
}

export async function fetchYouTubeTrendingTitles(newsSeedTitles: string[] = []): Promise<string[]> {
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key) {
    console.warn("  ⚠️ youtube-trending: YOUTUBE_DATA_API_KEY 未設定のためスキップ");
    return [];
  }

  const seedQueries = buildYouTubeNewsSeedQueries(newsSeedTitles, RADAR.youtubeNewsSeedQueries);
  const freshAfter = hoursAgoIso(6);

  /** カテゴリ縛りなし（社会炎上・総合バズも拾う）。ノイズは prefilter 側 */
  const searchParams = (q: string) => ({
    part: "snippet",
    type: "video",
    order: "date",
    publishedAfter: freshAfter,
    regionCode: "JP",
    relevanceLanguage: "ja",
    q,
    maxResults: "8",
  });

  const [popularGeneral, popularNews, dateBroad, ...seedResults] = await Promise.all([
    fetchYouTubeApi<{ items?: Array<{ snippet?: { title?: string } }> }>("mostPopularGeneral", "videos", {
      part: "snippet",
      chart: "mostPopular",
      regionCode: "JP",
      maxResults: "25",
    }),
    fetchYouTubeApi<{ items?: Array<{ snippet?: { title?: string } }> }>("mostPopularNews", "videos", {
      part: "snippet",
      chart: "mostPopular",
      regionCode: "JP",
      videoCategoryId: NEWS_POLITICS_CATEGORY,
      maxResults: "25",
    }),
    fetchYouTubeApi<{ items?: Array<{ snippet?: { title?: string } }> }>(
      "searchDateBroad",
      "search",
      searchParams("社会 OR 炎上 OR 時事 OR 政治 OR 経済 OR 企業"),
    ),
    ...seedQueries.map((q, i) =>
      fetchYouTubeApi<{ items?: Array<{ snippet?: { title?: string } }> }>(`searchSeed${i}`, "search", searchParams(q)),
    ),
  ]);

  const titles = Array.from(
    new Set([
      ...collectTitles(popularGeneral?.items),
      ...collectTitles(popularNews?.items),
      ...collectTitles(dateBroad?.items),
      ...seedResults.flatMap((r) => collectTitles(r?.items)),
    ]),
  );

  return titles.slice(0, RADAR.youtubeTrendingMaxTitles);
}
