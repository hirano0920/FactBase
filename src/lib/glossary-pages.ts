import { prisma } from "@/lib/prisma";
import { isDbEnabled } from "@/lib/data";
import type { GlossaryTerm } from "@/types";

/**
 * 用語ページ（/glossary/{term}）のデータ層。
 * 記事生成時に作られるIssue.glossaryJson（各記事最大5語）を、独立したSEOページとして再利用する。
 * 1記事3〜5語 × 30本/日 → 数ヶ月で数千ページの検索面積になる（戦略: SEO巨大資産）。
 * 専用テーブルは作らず、jsonb containment（@>）でglossaryJsonを直接引く
 * （用語の追加・修正が記事側の再生成に自動追従する。二重管理をしない）。
 */

export interface GlossaryPageEntry {
  term: string;
  def: string;
  source: "wikipedia" | "ai";
  wikipediaUrl?: string;
  /** この用語が出てくる争点（新しい順） */
  issues: { slug: string; title: string; track: "debate" | "news" }[];
}

interface IssueRow {
  slug: string;
  title: string;
  track: "DEBATE" | "NEWS";
  glossaryJson: unknown;
}

/** 全用語の一覧（重複排除・出現記事数降順）。一覧ページとsitemap用 */
export async function listGlossaryTerms(limit = 2000): Promise<{ term: string; issueCount: number }[]> {
  if (!isDbEnabled()) return [];
  // jsonb_array_elementsでglossaryJsonを展開して用語ごとに集計する
  const rows = await prisma.$queryRaw<{ term: string; count: bigint }[]>`
    SELECT g->>'term' AS term, COUNT(*) AS count
    FROM "Issue", jsonb_array_elements("glossaryJson") AS g
    WHERE "glossaryJson" IS NOT NULL
      AND "underReview" = false
      AND status != 'ARCHIVED'
    GROUP BY g->>'term'
    ORDER BY count DESC
    LIMIT ${limit}
  `;
  return rows
    .filter((r) => !!r.term)
    .map((r) => ({ term: r.term, issueCount: Number(r.count) }));
}

/** 1用語の定義＋その用語が出てくる争点一覧。定義は最新記事のものを採用する */
export async function getGlossaryPage(term: string): Promise<GlossaryPageEntry | null> {
  if (!isDbEnabled()) return null;
  const containment = JSON.stringify([{ term }]);
  const rows = await prisma.$queryRaw<IssueRow[]>`
    SELECT slug, title, track, "glossaryJson"
    FROM "Issue"
    WHERE "glossaryJson" @> ${containment}::jsonb
      AND "underReview" = false
      AND status != 'ARCHIVED'
    ORDER BY "createdAt" DESC
    LIMIT 30
  `;
  if (rows.length === 0) return null;

  const entry = (rows[0].glossaryJson as GlossaryTerm[]).find((g) => g.term === term);
  if (!entry) return null;

  return {
    term,
    def: entry.def,
    source: entry.source,
    wikipediaUrl: entry.wikipediaUrl,
    issues: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      track: r.track === "NEWS" ? "news" : "debate",
    })),
  };
}
