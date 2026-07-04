import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { canReportQuality, evaluateQualityReports } from "@/lib/issue-quality";

export const runtime = "nodejs";

const schema = z.object({ reason: z.string().max(300).optional() });

/**
 * 「この要約はおかしい」報告。Radar自動生成争点（confirmation != MANUAL）専用。
 * sybil攻撃対策は src/lib/issue-quality.ts のパイプラインを参照。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { slug } = await params;
  const userId = session.user.id;

  const ok = await checkRateLimit("quality-report", userId, 10, 3600);
  if (!ok) return errors.rateLimited();

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errors.validation("報告理由は300字以内で入力してください");

  const issue = await prisma.issue.findUnique({
    where: { slug },
    select: { id: true, confirmation: true },
  });
  if (!issue) return errors.notFound("争点が見つかりません");
  if (issue.confirmation === "MANUAL") {
    return errors.validation("手動作成の争点は品質報告の対象外です");
  }

  const eligibility = await canReportQuality(userId, new Date(session.user.createdAt), issue.id);
  if (!eligibility.allowed) {
    return errors.forbidden(eligibility.message);
  }

  const existing = await prisma.issueQualityReport.findFirst({
    where: { issueId: issue.id, reporterId: userId },
  });
  if (!existing) {
    await prisma.issueQualityReport.create({
      data: { issueId: issue.id, reporterId: userId, reason: parsed.data.reason },
    });
  }

  await evaluateQualityReports(issue.id);

  return NextResponse.json({ received: true });
}
