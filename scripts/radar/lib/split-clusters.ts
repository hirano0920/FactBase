/**
 * 一次情報フィード（官公庁・EU・米政府等）の誤結合を検出し、1声明＝1クラスタに分割する。
 *
 * nanoは「EU関連のプレスリリース」を1クラスタにまとめがち（Dombrovskisのエネルギー声明 +
 * Šuicaの別イベント声明など）。PRIMARY_SOURCE_FEED 由来だけで構成され、見出しの一貫性が
 * 低いクラスタは機械的にシングルトンへばらす。
 */
import type { RadarCluster } from "../../../src/lib/ai";
import { clusterCoherence, PRIMARY_SOURCE_FEED } from "../../../src/lib/radar";

export interface IndexedEvent {
  feedName: string;
  title: string;
  url?: string;
}

/** 一次情報クラスタは報道より厳しく見る（同一声明の重複除き） */
const PRIMARY_SPLIT_COHERENCE = 0.28;

function isPrimaryFeed(feedName: string): boolean {
  return PRIMARY_SOURCE_FEED.test(feedName);
}

/** クラスタを recent インデックスからメンバーイベント列に解決 */
export function clusterMembers<T extends IndexedEvent>(
  cluster: RadarCluster,
  recent: T[],
): { index: number; event: T }[] {
  return cluster.member_indices
    .filter((i) => i >= 0 && i < recent.length)
    .map((index) => ({ index, event: recent[index] }));
}

/**
 * 一次情報のみで構成され、見出し群の類似度が低いクラスタをメンバーごとに分割する。
 * 報道＋一次情報の混在クラスタは分割しない（複数媒体一致のシグナルを維持）。
 */
export function splitIncoherentPrimaryClusters<T extends IndexedEvent>(
  clusters: RadarCluster[],
  recent: T[],
): RadarCluster[] {
  const out: RadarCluster[] = [];

  for (const cluster of clusters) {
    const members = clusterMembers(cluster, recent);
    if (members.length <= 1) {
      out.push(cluster);
      continue;
    }

    const allPrimary = members.every((m) => isPrimaryFeed(m.event.feedName));
    if (!allPrimary) {
      out.push(cluster);
      continue;
    }

    const coherence = clusterCoherence(members.map((m) => m.event.title));
    const urls = members.map((m) => m.event.url).filter((u): u is string => Boolean(u));
    const distinctUrls =
      urls.length === members.length && new Set(urls).size === members.length;

    // URLが別＝別声明。見出し類似度も低ければ別出来事とみなして分割
    const shouldSplit =
      distinctUrls || coherence < PRIMARY_SPLIT_COHERENCE;

    if (!shouldSplit) {
      out.push(cluster);
      continue;
    }

    for (const { index, event } of members) {
      out.push({
        ...cluster,
        title: event.title.slice(0, 120),
        member_indices: [index],
        question: "",
        match_issue_id: null,
        match_candidate_id: null,
      });
    }
  }

  return out;
}
