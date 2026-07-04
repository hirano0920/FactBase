/**
 * RAG検索層。コメント本文をembeddingし、pgvectorコサイン類似で根拠チャンクを取得。
 * 優先順位:
 *   1. 争点にpinされたチャンク（人間/自動が明示的に選んだ優先候補）
 *   2. グローバル検索: isActiveな全EvidenceChunkから、対象Issueのcategoryと重なるものを
 *      優先しつつコサイン類似度順（争点ごとの手動リンクが無くても根拠が引ける設計）
 *   3. 類似検索が失敗（embedding未生成・API障害等）した場合のフォールバック
 */
import OpenAI from "openai";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { AI_MODELS, BURST } from "@/lib/constants";
import type { FcChunk } from "@/lib/ai";
import { createOpenAIClient } from "@/lib/openai-client";
import { fcEmbedKey, kv } from "@/lib/redis";

const globalForRag = globalThis as unknown as { ragOpenai?: OpenAI };

function getClient(): OpenAI {
  if (!globalForRag.ragOpenai) {
    globalForRag.ragOpenai = createOpenAIClient({ timeout: 10_000, maxRetries: 1 });
  }
  return globalForRag.ragOpenai;
}

async function embedQuery(text: string): Promise<number[]> {
  const input = text.slice(0, 2000);
  const hash = createHash("sha256").update(input).digest("hex");
  const cacheKey = fcEmbedKey(hash);

  try {
    const cached = await kv.get(cacheKey);
    if (cached) return JSON.parse(cached) as number[];
  } catch {
    // fall through
  }

  const res = await getClient().embeddings.create({
    model: AI_MODELS.embedding,
    input,
  });
  const embedding = res.data[0].embedding;

  try {
    await kv.set(cacheKey, JSON.stringify(embedding), { ex: BURST.fcEmbedCacheSec });
  } catch {
    // ignore
  }
  return embedding;
}

interface RawChunkRow {
  id: string;
  sourceName: string;
  articleRef: string | null;
  text: string;
  sourceUrl: string;
  updatedAt: Date;
}

export async function retrieveChunks(
  issueId: string,
  query: string,
  limit = 3,
): Promise<FcChunk[]> {
  const issue = await prisma.issue.findUnique({ where: { id: issueId }, select: { category: true } });
  const category = issue?.category ?? null;

  // 類似検索を試み、失敗（embedding未生成・API障害等）ならグローバルfindManyフォールバック
  try {
    const embedding = await embedQuery(query);
    const vector = `[${embedding.join(",")}]`;

    const rows = await prisma.$queryRaw<RawChunkRow[]>`
      SELECT ec.id, ec."sourceName", ec."articleRef", ec.text, ec."sourceUrl", ec."updatedAt"
      FROM "EvidenceChunk" ec
      LEFT JOIN "IssueEvidenceLink" iel
        ON iel."chunkId" = ec.id AND iel."issueId" = ${issueId} AND iel.pinned = true
      WHERE ec."isActive" = true
        AND ec.embedding IS NOT NULL
      ORDER BY
        (iel.id IS NOT NULL) DESC,
        (${category}::"IssueCategory" = ANY(ec.category)) DESC,
        ec.embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
    if (rows.length > 0) {
      return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
    }
    console.warn(`[rag] fallback=global_findMany reason=no_embedded_rows issueId=${issueId}`);
  } catch (e) {
    console.warn(`[rag] fallback=global_findMany reason=similarity_search_error issueId=${issueId}`, e);
  }

  const pinned = await prisma.evidenceChunk.findMany({
    where: { isActive: true, issueLinks: { some: { issueId, pinned: true } } },
    select: { id: true, sourceName: true, articleRef: true, text: true, sourceUrl: true, updatedAt: true },
    take: limit,
  });
  if (pinned.length >= limit) {
    return pinned.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  }

  const rest = await prisma.evidenceChunk.findMany({
    where: {
      isActive: true,
      ...(category ? { category: { has: category } } : {}),
      id: { notIn: pinned.map((p) => p.id) },
    },
    select: { id: true, sourceName: true, articleRef: true, text: true, sourceUrl: true, updatedAt: true },
    take: limit - pinned.length,
  });
  return [...pinned, ...rest].map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}
