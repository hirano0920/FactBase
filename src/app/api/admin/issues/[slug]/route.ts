import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { errors } from "@/lib/api-helpers";
import { resolveIssueAdmin, type IssueAdminAction } from "@/lib/moderation-actions";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["clear", "archive", "unpublish", "restore"]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;

  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errors.validation("action が不正です");

  try {
    const result = await resolveIssueAdmin(slug, parsed.data.action as IssueAdminAction);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "処理に失敗しました";
    return errors.validation(message);
  }
}
