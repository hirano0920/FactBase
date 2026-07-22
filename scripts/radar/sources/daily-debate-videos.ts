/**
 * 討論系チャンネルの日次新着動画の取り込み（ABEMA Prime/ReHacQ/NewsPicks/PIVOT）。
 * scripts/radar/sources/abema-prime.tsを一般化したもの（旧ファイル名・dedupKey命名は
 * discover-abema.ts側で"abema:"のまま維持し、既存の解析済みレコードとの互換性を保つ）。
 *
 * 2026-07-22、オーナー指摘で発見した設計欠陥を修正:
 * 旧実装は「再生数25,000以上・コメント200以上」という絶対しきい値のみで判定していたため、
 * 公開から数時間しか経っていない動画（本当は急速にバズっている最中）が、まだ絶対数に
 * 達していないという理由で毎回スキップされ続けていた（見送るたびに古い動画に順位を
 * 譲り、結局二度と拾われないまま既読扱いになる）。
 * 「公開からの経過時間に対して再生数が伸びている速度」（views/hour）も判定基準に加え、
 * 絶対数はまだ小さくても伸びが早い動画を早期に拾えるようにする。
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
    console.warn(`  ⚠️ daily-debate-videos: ${label} 取得失敗 (${e})`);
    return null;
  }
}

export interface DailyDebateVideo {
  videoId: string;
  title: string;
  description: string;
  channelName: string;
  publishedAt: string;
  viewCount: number;
  commentCount: number;
  /** 判定に使った実際の再生速度（回/時）。ログ・監査用 */
  viewsPerHour: number;
  /** 公開から経過した時間 */
  hoursSincePublish: number;
  /**
   * 「数字が安定した」窓（18〜96時間）に入っているか。
   * オーナー提案（2026-07-22）: 「当日の動画より前日の動画の方が再生数・コメント数が
   * 読みやすい」— 公開直後は再生数がまだ伸び切っておらず、伸び速度だけで判定すると
   * 本来の実力を過小評価しやすい。この窓に入っている動画は絶対数の比較が最も信頼できるため、
   * 選定時に優先する（ただし窓の外でも絶対/速度いずれかのしきい値を満たせば対象に含める）。
   */
  isSettled: boolean;
}

const SETTLED_WINDOW_MIN_HOURS = 18;
// 2026-07-22: 72時間だと実測で「安定窓に該当する動画がほぼ無い日」が頻発したため96時間に拡大
// （動画は公開から数日かけて再生数を伸ばすため、72時間はまだ伸び切っていないことが多い）
const SETTLED_WINDOW_MAX_HOURS = 96;

interface PlaylistItemsResponse {
  items?: { contentDetails?: { videoId?: string } }[];
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

async function fetchRecentVideoIds(channelId: string, limit: number): Promise<string[]> {
  const uploadsPlaylistId = `UU${channelId.slice(2)}`;
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
 * 対象チャンネル群の直近アップロードのうち、以下いずれかを満たすものだけを返す:
 * A) 絶対数: 再生数minViews以上・コメント数minComments以上
 * B) 伸び速度: views/hour が minViewsPerHour 以上（公開直後の急上昇を早期検知）
 *    ただしコメントが少なすぎる（minCommentsForVelocity未満）と、再生数だけ
 *    多い低関与動画（再生されただけ・議論が起きていない）を拾ってしまうため、速度判定側にも
 *    コメント数の最低ラインを設ける。
 * しきい値はチャンネルごとに個別（RADAR.dailyDebateChannels各エントリのmin*フィールド）。
 * チャンネルによってコメント文化の濃さが大きく違う（ABEMA Primeは討論、NewsPicksは
 * インタビュー企画寄りでコメントが伸びにくい）ため、一律の数値では機能しない。
 */
export async function fetchDailyDebateCandidates(): Promise<DailyDebateVideo[]> {
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key) {
    console.warn("  ⚠️ daily-debate-videos: YOUTUBE_DATA_API_KEY 未設定のためスキップ");
    return [];
  }

  const all: DailyDebateVideo[] = [];
  for (const channel of RADAR.dailyDebateChannels) {
    const videoIds = await fetchRecentVideoIds(channel.channelId, RADAR.dailyDebatePerChannelPerRun * 4);
    if (videoIds.length === 0) continue;

    const res = await fetchYouTubeApi<VideoListResponse>("videos", "videos", {
      part: "snippet,statistics",
      id: videoIds.join(","),
    });

    const now = Date.now();
    const passed = (res?.items ?? [])
      .filter((item) => !!item.id && !!item.snippet?.title)
      .map((item) => {
        const viewCount = toNumber(item.statistics?.viewCount);
        const commentCount = toNumber(item.statistics?.commentCount);
        const publishedAt = item.snippet?.publishedAt ?? new Date().toISOString();
        const hoursSincePublish = Math.max(1, (now - new Date(publishedAt).getTime()) / 3_600_000);
        return {
          videoId: item.id!,
          title: item.snippet!.title!.trim(),
          description: item.snippet?.description?.trim() ?? "",
          channelName: channel.name,
          publishedAt,
          viewCount,
          commentCount,
          viewsPerHour: Math.round(viewCount / hoursSincePublish),
          hoursSincePublish,
          isSettled: hoursSincePublish >= SETTLED_WINDOW_MIN_HOURS && hoursSincePublish <= SETTLED_WINDOW_MAX_HOURS,
        };
      })
      .filter((v) => {
        const meetsAbsolute =
          v.viewCount >= channel.minViews && v.commentCount >= channel.minComments;
        const meetsVelocity =
          v.viewsPerHour >= channel.minViewsPerHour &&
          v.commentCount >= channel.minCommentsForVelocity;
        return meetsAbsolute || meetsVelocity;
      });

    console.log(
      `  📺 daily-debate-videos: ${channel.name} 直近${videoIds.length}本 → 通過${passed.length}本`,
    );
    all.push(...passed);
  }

  // 安定窓（18〜96時間）に入っている動画を優先し、その中では再生速度順。
  // 窓の外（公開直後の急上昇 or 古すぎ）は速度順で後ろに回す。
  // 「viewsPerHourだけで並べると、当日アップの一過性の初速だけが強い動画が
  // 前日以前の"実際に議論が続いている"動画より不当に上位に来る」ことへの対策。
  return all
    .sort((a, b) => {
      if (a.isSettled !== b.isSettled) return a.isSettled ? -1 : 1;
      return b.viewsPerHour - a.viewsPerHour;
    })
    .slice(0, RADAR.dailyDebateChannels.length * RADAR.dailyDebatePerChannelPerRun);
}
