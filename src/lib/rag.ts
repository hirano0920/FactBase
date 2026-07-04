/**
 * RAG検索層。コメント本文をembeddingし、pgvectorコサイン類似で根拠チャンクを取得。
 * 優先順位:
 *   1. 争点に紐づくチャンク内で類似検索（最も精度が高い）
 *   2. 紐づきが無い/embedding未生成 → 争点リンクの先頭3件（フォールバック）
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
  lawName: string;
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
  // 類似検索を試み、失敗（embedding未生成・API障害等）ならリンク順フォールバック
  try {
    const embedding = await embedQuery(query);
    const vector = `[${embedding.join(",")}]`;

    const rows = await prisma.$queryRaw<RawChunkRow[]>`
      SELECT lc.id, lc."lawName", lc."articleRef", lc.text, lc."sourceUrl", lc."updatedAt"
      FROM "LawChunk" lc
      JOIN "IssueLawLink" ill ON ill."lawChunkId" = lc.id
      WHERE ill."issueId" = ${issueId}
        AND lc."isActive" = true
        AND lc.embedding IS NOT NULL
      ORDER BY lc.embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;
    if (rows.length > 0) {
      return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
    }
    console.warn(
      `[rag] fallback=link_order reason=no_embedded_rows issueId=${issueId}`,
    );
  } catch (e) {
    console.warn(`[rag] fallback=link_order reason=similarity_search_error issueId=${issueId}`, e);
  }

  const fallback = await prisma.lawChunk.findMany({
    where: { isActive: true, issueLinks: { some: { issueId } } },
    select: { id: true, lawName: true, articleRef: true, text: true, sourceUrl: true, updatedAt: true },
    take: limit,
  });
  return fallback.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}
