/**
 * 伝説級バズり動画の収集（discover-legendary.ts用）。
 * 討論系チャンネル（ABEMA Prime / ReHacQ / NewsPicks）の歴代トップ再生動画から、
 * 再生数・コメント数のしきい値（RADAR.legendaryMinViews/MinComments）を超えるものを返す。
 * 「数百万再生＝流入が既に証明されている」動画だけを常設Debate候補にする趣旨のため、
 * しきい値は日次のABEMA Prime枠（25,000再生）より2桁高い。
 * 討論として成立するか（debate/news/exclude）の判定はここでは行わない — discover側のGeminiが担当。
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
    console.warn(`  ⚠️ legendary-videos: ${label} 取得失敗 (${e})`);
    return null;
  }
}

export interface LegendaryVideo {
  videoId: string;
  title: string;
  channelName: string;
  publishedAt: string;
  viewCount: number;
  commentCount: number;
}

interface ChannelListResponse {
  items?: { id?: string }[];
}

interface PlaylistItemsResponse {
  items?: { contentDetails?: { videoId?: string } }[];
  nextPageToken?: string;
}

interface VideoListResponse {
  items?: {
    id?: string;
    snippet?: { title?: string; publishedAt?: string };
    statistics?: { viewCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
  }[];
}

/** ISO 8601 duration（PT1H23M45S）を秒に変換。パース不能は0 */
export function durationToSeconds(iso: string | undefined): number {
  if (!iso) return 0;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** 討論として成立する最低の動画長。Shorts・切り抜きの数十秒動画を弾く */
const MIN_DURATION_SECONDS = 10 * 60;

function toNumber(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ハンドル（@rehacq等）からチャンネルIDを実行時に解決する。
 * IDをハードコードすると打ち間違いが「候補0件」として静かに失敗するため、
 * 人間が確認しやすいハンドルを設定に置き、IDはAPIに聞く。
 */
async function resolveChannelId(channel: { name: string; channelId?: string; handle?: string }): Promise<string | null> {
  if (channel.channelId) return channel.channelId;
  if (!channel.handle) return null;
  const res = await fetchYouTubeApi<ChannelListResponse>(`forHandle:${channel.handle}`, "channels", {
    part: "id",
    forHandle: channel.handle,
  });
  const id = res?.items?.[0]?.id ?? null;
  if (!id) console.warn(`  ⚠️ legendary-videos: ハンドル @${channel.handle} のチャンネルIDを解決できず`);
  return id;
}

/**
 * チャンネルの全アップロード動画IDを取得（uploads playlistをページネーション）。
 * search.list order=viewCount は大規模チャンネルだと直近アップロードしか対象にしない
 * 既知の制限があり（実測: ABEMA Primeで直近2週間分の24本しか返らなかった）、
 * 「歴代トップ」の用途に使えない。playlistItemsは1呼び出し1クォータ×50本なので、
 * 数千本の全件走査でも search 1回（100クォータ）より安い。
 */
async function fetchAllUploadVideoIds(channelId: string, maxVideos: number): Promise<string[]> {
  const uploadsPlaylistId = `UU${channelId.slice(2)}`;
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < maxVideos) {
    const res = await fetchYouTubeApi<PlaylistItemsResponse>("uploadsPlaylist", "playlistItems", {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: "50",
      ...(pageToken ? { pageToken } : {}),
    });
    if (!res) break;
    for (const item of res.items ?? []) {
      if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
    }
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return ids.slice(0, maxVideos);
}

/** 動画IDリストの統計をバッチ取得（videos.listは50件/呼び出し・1クォータ） */
async function fetchVideoStats(videoIds: string[]): Promise<NonNullable<VideoListResponse["items"]>> {
  const all: NonNullable<VideoListResponse["items"]> = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const res = await fetchYouTubeApi<VideoListResponse>("videos", "videos", {
      part: "snippet,statistics,contentDetails",
      id: videoIds.slice(i, i + 50).join(","),
    });
    all.push(...(res?.items ?? []));
  }
  return all;
}

/**
 * 全対象チャンネルの歴代トップ動画のうち、伝説級しきい値を超えるものを再生数降順で返す。
 * 呼び出し側はdedupKey（legendary:{videoId}）で処理済みを除外してからGemini解析にかけること。
 */
export async function fetchLegendaryCandidates(maxVideosPerChannel = 2_000): Promise<LegendaryVideo[]> {
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key) {
    console.warn("  ⚠️ legendary-videos: YOUTUBE_DATA_API_KEY 未設定のためスキップ");
    return [];
  }

  const all: LegendaryVideo[] = [];
  for (const channel of RADAR.legendaryChannels) {
    const channelId = await resolveChannelId(channel);
    if (!channelId) continue;

    const videoIds = await fetchAllUploadVideoIds(channelId, maxVideosPerChannel);
    if (videoIds.length === 0) continue;
    const items = await fetchVideoStats(videoIds);

    const passed = items
      .filter((item) => !!item.id && !!item.snippet?.title)
      // Shorts・切り抜き（数十秒でバズっただけの動画）は討論の埋め込み素材にならないため、
      // 動画の長さで弾く（討論回はどのチャンネルも通常20分〜1時間超）
      .filter((item) => durationToSeconds(item.contentDetails?.duration) >= MIN_DURATION_SECONDS)
      .map((item) => ({
        videoId: item.id!,
        title: item.snippet!.title!.trim(),
        channelName: channel.name,
        publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
        viewCount: toNumber(item.statistics?.viewCount),
        commentCount: toNumber(item.statistics?.commentCount),
      }))
      // Shorts的な切り抜き（数十秒動画がバズっただけ）も混ざるが、討論として成立するかは
      // Gemini解析（track判定）に委ね、ここでは量的しきい値だけで絞る
      .filter((v) => v.viewCount >= RADAR.legendaryMinViews && v.commentCount >= RADAR.legendaryMinComments);

    console.log(
      `  🏆 legendary-videos: ${channel.name} 全${videoIds.length}本走査 → しきい値(再生${RADAR.legendaryMinViews.toLocaleString()}・コメント${RADAR.legendaryMinComments.toLocaleString()})通過${passed.length}本`,
    );
    all.push(...passed);
  }

  return all.sort((a, b) => b.viewCount - a.viewCount);
}
