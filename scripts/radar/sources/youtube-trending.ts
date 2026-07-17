/**
 * YouTube Data API v3 — 日本向けトレンド動画取得（バズ検知用）。
 * 環境変数 YOUTUBE_DATA_API_KEY が必要（未設定時は空配列でスキップ）。
 *
 * 取得軸（TwoSides: News & Politics に閉じない）:
 *   1. chart=mostPopular + regionCode=JP（総合トレンド）
 *   2. chart=mostPopular + videoCategoryId=25（News & Politics）
 *   3. 直近6h・order=date の広域検索（社会・時事含む）
 *   4. Yahoo!ニュースランキング見出しをシードにした鮮度優先検索
 *
 * 統計情報（view/like/commentCount）も合わせて取得する。videos.list は part を
 * 増やしてもクォータ消費が変わらない（mostPopular系は無料で取得可）。search.list は
 * statistics を返さないため、ヒットした動画IDだけ videos.list へ後続バッチ取得する
 * （1リクエストあたり1ユニットの追加コストのみ・50件まで一括）。
 *
 * 動画本文・文字起こしは取らない（タイトルをバズ検知の入口に使い、
 * 記事生成は報道本文・一次情報の調査に委ねる）。スポーツ等のノイズは prefilter で落とす。
 */
import { RADAR } from "../../../src/lib/constants";
import { extractBuzzMatchTokens } from "../../../src/lib/buzz-cross-match";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

/**
 * TwoSidesサイトに合うYouTubeカテゴリ一覧。
 * News & Politics(25) はもちろん、社会議論が起きうる全カテゴリをカバー:
 *   - 24: Entertainment（エンタメ炎上・声明対立）
 *   - 27: Education（教育政策・社会問題解説）
 *   - 28: Science & Technology（テクノロジー規制・AI倫理）
 *   - 22: People & Blogs（個人の政治的発信・暴露）
 *   - 35: Documentary（ドキュメンタリー・調査報道）
 * 除外: Music(10), Sports(17), Gaming(20), Pets(15) 等は政治論争と無関係
 */
const BUZZ_CATEGORY_IDS = [
  "25", // News & Politics
  "24", // Entertainment
  "27", // Education
  "28", // Science & Technology
  "22", // People & Blogs
  "35", // Documentary
] as const;

/** videos.list の id パラメータに一括で渡せる上限（YouTube Data API仕様） */
const VIDEO_STATS_BATCH_SIZE = 50;

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

interface VideoStatistics {
  viewCount?: string;
  likeCount?: string;
  commentCount?: string;
}

interface VideoListItem {
  id?: string;
  snippet?: { title?: string; channelTitle?: string };
  statistics?: VideoStatistics;
}

interface SearchListItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string };
}

/** バズ検知・DVS実測で使う動画1件分。統計はAPIが返さない/動画側で無効化されていれば0扱い */
export interface YouTubeVideoEntry {
  /** commentThreads.list で返信数を取りにいくためのID（search結果はid.videoId、videos.listはid） */
  videoId: string;
  title: string;
  channelTitle: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

function toNumber(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function collectEntriesFromVideoList(items: VideoListItem[] | undefined): YouTubeVideoEntry[] {
  return (items ?? [])
    .filter((item) => !!item.id && (item.snippet?.title?.trim().length ?? 0) >= 4)
    .map((item) => ({
      videoId: item.id!,
      title: item.snippet!.title!.trim(),
      channelTitle: item.snippet?.channelTitle?.trim() ?? "",
      viewCount: toNumber(item.statistics?.viewCount),
      likeCount: toNumber(item.statistics?.likeCount),
      commentCount: toNumber(item.statistics?.commentCount),
    }));
}

/**
 * search.list はstatisticsを返さないため、ヒットした動画IDだけ videos.list(part=statistics) で
 * 後続バッチ取得して合流する。50件ごとに1リクエスト（追加コストは1ユニット/バッチのみ）。
 */
async function fetchStatsForVideoIds(ids: string[]): Promise<Map<string, VideoStatistics>> {
  const map = new Map<string, VideoStatistics>();
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  for (let i = 0; i < uniqueIds.length; i += VIDEO_STATS_BATCH_SIZE) {
    const chunk = uniqueIds.slice(i, i + VIDEO_STATS_BATCH_SIZE);
    const res = await fetchYouTubeApi<{ items?: VideoListItem[] }>(`videoStats`, "videos", {
      part: "statistics",
      id: chunk.join(","),
    });
    for (const item of res?.items ?? []) {
      if (item.id) map.set(item.id, item.statistics ?? {});
    }
  }
  return map;
}

function collectEntriesFromSearchList(
  items: SearchListItem[] | undefined,
  statsById: Map<string, VideoStatistics>,
): YouTubeVideoEntry[] {
  return (items ?? [])
    .filter((item) => !!item.id?.videoId && (item.snippet?.title?.trim().length ?? 0) >= 4)
    .map((item) => {
      const stats = statsById.get(item.id!.videoId!) || {};
      return {
        videoId: item.id!.videoId!,
        title: item.snippet!.title!.trim(),
        channelTitle: item.snippet?.channelTitle?.trim() ?? "",
        viewCount: toNumber(stats.viewCount),
        likeCount: toNumber(stats.likeCount),
        commentCount: toNumber(stats.commentCount),
      };
    });
}

function dedupeByTitle(entries: YouTubeVideoEntry[]): YouTubeVideoEntry[] {
  const seen = new Set<string>();
  const out: YouTubeVideoEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.title)) continue;
    seen.add(e.title);
    out.push(e);
  }
  return out;
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

export interface YouTubeTrendingTitles {
  /**
   * mostPopular（総合・News&Politics）とジャンル横断の広域検索のみ。ニュース見出しをシードにした
   * 検索は含まない＝「他ソースと無関係にYouTube側で独立して見えている」ことの証拠として使える。
   * バズ横断スコア（inYouTubeTrending判定）はこちらだけを使うこと。
   */
  organic: YouTubeVideoEntry[];
  /**
   * organicに加え、Yahoo!ニュースランキング見出しをシードにした検索結果も含む全件。
   * シード検索はクエリ自体がニュース見出しの単語なので、ヒットしても「YouTubeで独立に
   * バズっている」証拠にはならない（自己参照）。新規トピック発掘の材料としてのみ使うこと。
   */
  all: YouTubeVideoEntry[];
}

export async function fetchYouTubeTrendingTitles(newsSeedTitles: string[] = []): Promise<YouTubeTrendingTitles> {
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key) {
    console.warn("  ⚠️ youtube-trending: YOUTUBE_DATA_API_KEY 未設定のためスキップ");
    return { organic: [], all: [] };
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

  // BUZZ_CATEGORY_IDS の各カテゴリで mostPopular を取得（各カテゴリのトレンド動画を拾う）
  const categoryRequests = BUZZ_CATEGORY_IDS.map((catId, i) =>
    fetchYouTubeApi<{ items?: VideoListItem[] }>(`mostPopularCat${catId}`, "videos", {
      part: "snippet,statistics",
      chart: "mostPopular",
      regionCode: "JP",
      videoCategoryId: catId,
      maxResults: "15",
    }),
  );
  // 総合トレンド（カテゴリ無指定）は全カテゴリ混在＝最大枠を広げる
  const [popularGeneral, ...categoryResults] = await Promise.all([
    fetchYouTubeApi<{ items?: VideoListItem[] }>("mostPopularGeneral", "videos", {
      part: "snippet,statistics",
      chart: "mostPopular",
      regionCode: "JP",
      maxResults: "40",
    }),
    ...categoryRequests,
  ]);

  // 広域検索（時系列）+ ニュースシード検索は従来通り
  const [dateBroad, ...seedResults] = await Promise.all([
    fetchYouTubeApi<{ items?: SearchListItem[] }>(
      "searchDateBroad",
      "search",
      searchParams("社会 OR 炎上 OR 時事 OR 政治 OR 経済 OR 企業"),
    ),
    ...seedQueries.map((q, i) =>
      fetchYouTubeApi<{ items?: SearchListItem[] }>(`searchSeed${i}`, "search", searchParams(q)),
    ),
  ]);

  // search.list はstatisticsを返さないため、ヒットした動画IDへ後続バッチ取得する
  const searchItems = [...(dateBroad?.items ?? []), ...seedResults.flatMap((r) => r?.items ?? [])];
  const searchVideoIds = searchItems.map((item) => item.id?.videoId).filter((id): id is string => !!id);
  const statsById = await fetchStatsForVideoIds(searchVideoIds);

  const organicEntries = dedupeByTitle([
    ...collectEntriesFromVideoList(popularGeneral?.items),
    ...categoryResults.flatMap((r) => collectEntriesFromVideoList(r?.items)),
    ...collectEntriesFromSearchList(dateBroad?.items, statsById),
  ]).slice(0, RADAR.youtubeTrendingMaxTitles);

  const allEntries = dedupeByTitle([
    ...organicEntries,
    ...seedResults.flatMap((r) => collectEntriesFromSearchList(r?.items, statsById)),
  ]).slice(0, RADAR.youtubeTrendingMaxTitles);

  return { organic: organicEntries, all: allEntries };
}

/**
 * トピックに対応するYouTube動画を探す（あればview/comment数を「実際に見られている・
 * 議論になっている」の実測シグナルとしてevidenceへ合流する）。複数一致時は最も再生数が多いものを採用。
 */
export function matchYouTubeEntry(
  topic: string,
  entries: readonly YouTubeVideoEntry[],
  opts?: { matches?: (topic: string, title: string) => boolean },
): YouTubeVideoEntry | undefined {
  const matches = opts?.matches;
  const hits = entries.filter(
    (e) =>
      e.title === topic ||
      topic.includes(e.title) ||
      e.title.includes(topic) ||
      (matches?.(topic, e.title) ?? false),
  );
  if (hits.length === 0) return undefined;
  return hits.reduce((best, e) => (e.viewCount > best.viewCount ? e : best));
}

/** commentThreads.list で1回に取得する上位コメント数（returnParamの上限に合わせる） */
const REPLY_INTENSITY_SAMPLE_SIZE = 20;

interface CommentThreadItem {
  snippet?: {
    totalReplyCount?: number;
    topLevelComment?: { snippet?: { likeCount?: number } };
  };
}

/**
 * 動画の上位コメントへの返信数を合計する。いいね数と違い、返信は「賛同されて終わる」のではなく
 * 実際に応酬（賛成/反対のやり取り）が起きていることの実測シグナルになる
 * （2026-07-16、実データで`totalReplyCount`フィールドの存在を確認済み）。
 * コメント欄が無効化されている動画・APIキー未設定時は0（バズ検知自体は止めない）。
 */
export async function fetchYouTubeReplyIntensity(videoId: string): Promise<number> {
  const res = await fetchYouTubeApi<{ items?: CommentThreadItem[] }>("commentThreads", "commentThreads", {
    part: "snippet",
    videoId,
    maxResults: String(REPLY_INTENSITY_SAMPLE_SIZE),
    order: "relevance",
  });
  return (res?.items ?? []).reduce((sum, item) => sum + (item.snippet?.totalReplyCount ?? 0), 0);
}
