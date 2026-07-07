/**
 * RSS経路（summarize/followup）の ensureEvidence 検索語。
 * discover が正規化した topicTerm を優先し、ヒット率を discover 経路と揃える。
 */
export function resolveEnrichSearchTerm(
  candidate: { topicTerm?: string | null; title?: string } | null,
  fallbackTitle: string,
): string {
  const topicTerm = candidate?.topicTerm?.trim();
  if (topicTerm && topicTerm.length >= 2) return topicTerm;
  const title = candidate?.title?.trim() || fallbackTitle.trim();
  return title.length >= 2 ? title : fallbackTitle.trim();
}
