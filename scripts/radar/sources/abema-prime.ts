/**
 * ABEMA Prime（アベプラ）公式YouTubeチャンネルからの討論回取り込み。
 * 実例に基づく基準（2026-07-19、オーナー承認）:
 *   - 再生数25,000以上・コメント数200以上
 *   - 賛否が分かれる討論形式のみ（人生ストーリー・単独ゲストの対談は除外。classifyAbemaVideoが判定）
 *   - 賛否構造は無いが情報価値のある専門家解説はNewsトラックに回す
 */
import { RADAR } from "../../../src/lib/constants";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

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
    console.warn(`  ⚠️ abema-prime: ${label} 取得失敗 (${e})`);
    return null;
  }
}

export interface AbemaPrimeVideo {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  viewCount: number;
  commentCount: number;
}

interface PlaylistItemsResponse {
  items?: { contentDetails?: { videoId?: string } }[];
  nextPageToken?: string;
}

interface VideoListResponse {
  items?: {
    id?: string;
    snippet?: { title?: string; description?: string; publishedAt?: string };
    statistics?: { viewCount?: string; commentCount?: string };
  }[];
}

function toNumber(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * アップロード済み動画IDを新着順に取得する（uploads playlist経由。channelId頭の"UC"を"UU"に
 * 置き換えるだけで確定的に導出できるため、channels.list呼び出しを省略しコストを抑える）。
 */
async function fetchRecentVideoIds(limit: number): Promise<string[]> {
  const uploadsPlaylistId = `UU${RADAR.abemaPrimeChannelId.slice(2)}`;
  const res = await fetchYouTubeApi<PlaylistItemsResponse>("uploadsPlaylist", "playlistItems", {
    part: "contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(Math.min(limit, 50)),
  });
  return (res?.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => !!id);
}

/**
 * 直近アップロードのうち、再生数・コメント数がしきい値以上のものだけを返す。
 * classifyAbemaVideo（debate/news/exclude判定）はここでは行わない — discover側で呼ぶ。
 */
export async function fetchAbemaPrimeCandidates(): Promise<AbemaPrimeVideo[]> {
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key) {
    console.warn("  ⚠️ abema-prime: YOUTUBE_DATA_API_KEY 未設定のためスキップ");
    return [];
  }

  const videoIds = await fetchRecentVideoIds(RADAR.abemaPrimePerRun * 4);
  if (videoIds.length === 0) return [];

  const res = await fetchYouTubeApi<VideoListResponse>("videos", "videos", {
    part: "snippet,statistics",
    id: videoIds.join(","),
  });

  const candidates = (res?.items ?? [])
    .filter((item) => !!item.id && !!item.snippet?.title)
    .map((item) => ({
      videoId: item.id!,
      title: item.snippet!.title!.trim(),
      description: item.snippet?.description?.trim() ?? "",
      publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
      viewCount: toNumber(item.statistics?.viewCount),
      commentCount: toNumber(item.statistics?.commentCount),
    }))
    .filter(
      (v) => v.viewCount >= RADAR.abemaPrimeMinViews && v.commentCount >= RADAR.abemaPrimeMinComments,
    );

  console.log(
    `  📺 abema-prime: 直近${videoIds.length}本 → しきい値(再生${RADAR.abemaPrimeMinViews}・コメント${RADAR.abemaPrimeMinComments})通過${candidates.length}本`,
  );
  return candidates.slice(0, RADAR.abemaPrimePerRun);
}
