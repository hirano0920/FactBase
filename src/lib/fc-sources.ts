import type { FcChunk } from "@/lib/ai";

export interface FcSourceLink {
  label: string;
  url: string;
}

/** factCheck()が使った根拠チャンクIDから、表示用の出典リンク一覧を組み立てる（重複URLは除外） */
export function buildSourceLinks(usedIds: string[], chunks: FcChunk[]): FcSourceLink[] {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const links: FcSourceLink[] = [];
  for (const id of usedIds) {
    const chunk = byId.get(id);
    if (!chunk?.sourceUrl) continue;
    const label = `${chunk.sourceName}${chunk.articleRef ? ` ${chunk.articleRef}` : ""}`;
    if (!links.some((l) => l.url === chunk.sourceUrl)) {
      links.push({ label, url: chunk.sourceUrl });
    }
  }
  return links;
}
