/**
 * Google Trends/Yahoo!リアルタイム検索は毎回その場限りのスナップショットしか返さない
 * （公式Trends APIには「継続的に人気」を表すtop系エンドポイントが無い）。
 * ここでは自前でTrendSightingテーブルに出現を積み上げ、
 * 「1回だけ出た瞬間バズ」と「何時間も出続けている継続的な話題」を区別する。
 * cronの実行間隔（15〜30分）に依存するため、閾値は分単位ではなく回数×経過時間で判定する。
 */
import type { PrismaClient } from "@prisma/client";

export const SUSTAINED_MIN_SIGHTINGS = 6;
export const SUSTAINED_MIN_SPAN_HOURS = 3;
/** これより古い出現は「終わった話題」とみなし記録から間引く（テーブル肥大化防止） */
const STALE_AFTER_HOURS = 72;

/** 今回の取得結果を出現履歴に反映する（新規は作成、既存は最終出現時刻と回数を更新） */
export async function recordSightings(
  prisma: PrismaClient,
  source: "google_trends" | "yahoo_realtime",
  terms: string[],
): Promise<void> {
  const now = new Date();
  for (const term of Array.from(new Set(terms))) {
    await prisma.trendSighting.upsert({
      where: { term_source: { term, source } },
      create: { term, source, firstSeenAt: now, lastSeenAt: now, sightingCount: 1 },
      update: { lastSeenAt: now, sightingCount: { increment: 1 } },
    });
  }
}

/** sightingCount・出現期間の両方が閾値を超えた「継続的に話題」な語だけを返す */
export async function getSustainedTerms(
  prisma: PrismaClient,
  source: "google_trends" | "yahoo_realtime",
): Promise<string[]> {
  const rows = await prisma.trendSighting.findMany({
    where: { source, sightingCount: { gte: SUSTAINED_MIN_SIGHTINGS } },
    select: { term: true, firstSeenAt: true, lastSeenAt: true },
  });
  const minSpanMs = SUSTAINED_MIN_SPAN_HOURS * 60 * 60_000;
  return rows
    .filter((r) => r.lastSeenAt.getTime() - r.firstSeenAt.getTime() >= minSpanMs)
    .map((r) => r.term);
}

/** 出現しなくなって久しい語を間引く（毎回全件保持し続けるとテーブルが肥大化するため） */
export async function pruneStaleSightings(prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60_000);
  await prisma.trendSighting.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
}
