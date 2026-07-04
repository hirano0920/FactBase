import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  listFlaggedIssues,
  listHeldRadarCandidates,
  listPendingModerationCases,
  listRecentRadarIssues,
  listUnresolvedReports,
} from "@/lib/moderation-actions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;

  const [cases, flaggedIssues, recentRadar, heldRadar, openReports] = await Promise.all([
    listPendingModerationCases(),
    listFlaggedIssues(),
    listRecentRadarIssues(),
    listHeldRadarCandidates(),
    listUnresolvedReports(),
  ]);

  return NextResponse.json({
    counts: {
      pendingCases: cases.length,
      underReviewIssues: flaggedIssues.length,
      heldRadar: heldRadar.length,
      openReports: openReports.length,
    },
    cases: cases.map((c) => ({
      id: c.id,
      source: c.source,
      createdAt: c.createdAt.toISOString(),
      aiVerdict: c.aiVerdict,
      comment: {
        id: c.comment.id,
        body: c.comment.body,
        moderationStatus: c.comment.moderationStatus,
        createdAt: c.comment.createdAt.toISOString(),
        issue: c.comment.issue,
        user: c.comment.user,
        appeal: c.comment.appeal
          ? { ...c.comment.appeal, createdAt: c.comment.appeal.createdAt.toISOString() }
          : null,
        reports: c.comment.reports.map((r) => ({
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
          reporter: r.reporter,
        })),
      },
    })),
    flaggedIssues: flaggedIssues.map((issue) => ({
      id: issue.id,
      slug: issue.slug,
      title: issue.title,
      confirmation: issue.confirmation,
      createdAt: issue.createdAt.toISOString(),
      lead: (issue.summaryJson as { lead?: string })?.lead ?? "",
      qualityReports: issue.qualityReports.map((r) => ({
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        reporter: r.reporter,
      })),
    })),
    recentRadar: recentRadar.map((issue) => ({
      ...issue,
      createdAt: issue.createdAt.toISOString(),
      lead: (issue.summaryJson as { lead?: string })?.lead ?? "",
    })),
    heldRadar: heldRadar.map((c) => ({
      id: c.id,
      title: c.title,
      category: c.category,
      classification: c.classification,
      decision: c.decision,
      riskFlags: c.riskFlags,
      createdAt: c.createdAt.toISOString(),
      sourceUrls: c.sourceUrls,
    })),
    openReports: openReports.map((r) => ({
      id: r.id,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      reporter: r.reporter,
      comment: r.comment,
    })),
  });
}
