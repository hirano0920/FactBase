import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getIssueAnalytics } from "@/lib/analytics";
import { getIssueDebateIntel } from "@/lib/debate-intelligence";
import { canViewAnalytics, canViewDebateIntelligence } from "@/lib/plan-features";

export const runtime = "nodejs";

/**
 * 争点の「層の動き」分析 + 両陣営マップ。
 * Freeはn・shift%の概要のみ。Plus/Proはヒートマップ・両陣営マップ・MVPまで。
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const issue = await prisma.issue.findUnique({ where: { slug }, select: { id: true } });
  if (!issue) return NextResponse.json({ error: "争点が見つかりません" }, { status: 404 });

  const session = await auth();
  const plan = session?.user?.plan ?? null;
  const detailed = canViewAnalytics(plan);
  const intelAccess = canViewDebateIntelligence(plan);

  const [analytics, intel] = await Promise.all([
    getIssueAnalytics(issue.id),
    getIssueDebateIntel(issue.id),
  ]);

  const base = {
    shift: detailed
      ? analytics.shift
      : { n: analytics.shift.n, shiftPercent: analytics.shift.shiftPercent },
    afterReadN: analytics.afterReadN,
    detailed,
    acknowledged: {
      for: intel.acknowledged.for
        ? { body: intel.acknowledged.for.body.slice(0, 120), userName: intel.acknowledged.for.userName }
        : null,
      against: intel.acknowledged.against
        ? {
            body: intel.acknowledged.against.body.slice(0, 120),
            userName: intel.acknowledged.against.userName,
          }
        : null,
    },
    mvp: intel.mvp
      ? {
          stance: intel.mvp.stance,
          userName: intel.mvp.userName,
          body: intel.mvp.body.slice(0, 140),
          crossHelpful: intel.mvp.crossHelpful,
        }
      : null,
  };

  if (!detailed) {
    return NextResponse.json({ ...base, histogram: null, campMap: null });
  }

  return NextResponse.json({
    ...base,
    histogram: analytics.histogram,
    campMap: intelAccess
      ? intel.campMap
      : {
          for: intel.campMap.for ? { userName: intel.campMap.for.userName } : null,
          against: intel.campMap.against ? { userName: intel.campMap.against.userName } : null,
        },
  });
}
