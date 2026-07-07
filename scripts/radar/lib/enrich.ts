/**
 * FactBase Radar — detect.ts系（RSSクラスタ経由）の記事生成に、discover.ts系と同じ調査基盤
 * （国会会議録・関連法令・Wikipedia背景・国内外報道）を後付けで揃えるための共有ヘルパー。
 *
 * 検索語は TopicCandidate.topicTerm（discover が mini で正規化した語）を優先する。
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { RADAR } from "../../../src/lib/constants";
import { researchTopic, type EvidenceBundle, type ResearchLimits } from "./research";
import type { SavedEvidence } from "./promote-logic";
import { resolveEnrichSearchTerm } from "./enrich-search-term";

export { resolveEnrichSearchTerm } from "./enrich-search-term";

const RESEARCH_LIMITS: ResearchLimits = {
  kokkaiRecords: RADAR.kokkaiRecords,
  lawRecords: RADAR.lawRecords,
  newsRecords: RADAR.newsRecords,
  internationalNewsRecords: RADAR.internationalNewsRecords,
};

export interface CandidateEvidenceState {
  id: string;
  evidenceJson: unknown;
  updatedAt: Date;
  topicTerm?: string | null;
  title?: string;
}

/**
 * TopicCandidateに紐づく証拠バンドルを用意する。
 * 検索語は topicTerm を優先（discover 経路と揃える）。
 */
export async function ensureEvidence(
  prisma: PrismaClient,
  searchTerm: string,
  candidate: CandidateEvidenceState | null,
): Promise<EvidenceBundle | null> {
  const term = resolveEnrichSearchTerm(candidate, searchTerm);
  const freshMs = RADAR.enrichRefreshHours * 60 * 60_000;
  if (candidate?.evidenceJson && Date.now() - candidate.updatedAt.getTime() < freshMs) {
    return candidate.evidenceJson as unknown as EvidenceBundle;
  }
  if (term.trim().length < 2) return null;

  try {
    const bundle = await researchTopic(term, RESEARCH_LIMITS, prisma);
    if (candidate) {
      const prev = (candidate.evidenceJson as SavedEvidence | null) ?? undefined;
      const merged: SavedEvidence = { ...prev, ...bundle };
      await prisma.topicCandidate.update({
        where: { id: candidate.id },
        data: { evidenceJson: merged as unknown as Prisma.InputJsonValue },
      });
    }
    return bundle;
  } catch (e) {
    console.warn(`  ⚠️ enrich (${term}): 調査取得に失敗、エンリッチ無しで続行 (${e})`);
    return null;
  }
}

/** 証拠バンドルから記事生成にそのまま渡せる事実情報（国会・背景・法令・政府統計）を取り出す */
export function evidenceToArticleFacts(evidence: EvidenceBundle | null) {
  return {
    dietSpeeches: evidence?.dietSpeeches ?? [],
    background: evidence?.background ?? null,
    laws: evidence?.laws ?? [],
    estatStats: evidence?.estatStats ?? [],
  };
}

/** 海外/英字メディア報道を report-text.ts（fetchReportExcerpts）が読める{title,url,feed}形式に変換 */
export function internationalNewsSources(
  evidence: EvidenceBundle | null,
): { title: string; url: string; feed: string }[] {
  if (!evidence) return [];
  return evidence.internationalNews.map((n) => ({
    title: n.title,
    url: n.url,
    feed: n.source || "international",
  }));
}

/** 世論調査を報じたニュースを report-text.ts（fetchReportExcerpts）が読める{title,url,feed}形式に変換 */
export function pollingNewsSources(
  evidence: EvidenceBundle | null,
): { title: string; url: string; feed: string }[] {
  if (!evidence?.pollingNews) return [];
  return evidence.pollingNews.map((n) => ({
    title: n.title,
    url: n.url,
    feed: n.source || "polling",
  }));
}
