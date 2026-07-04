import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { errors } from "@/lib/api-helpers";
import { resolveModerationCase, type ModerationResolution } from "@/lib/moderation-actions";

export const runtime = "nodejs";

const schema = z.object({
  action: z.enum(["remove", "restore", "accept-appeal", "reject-appeal"]),
});

const ACTION_MAP: Record<z.infer<typeof schema>["action"], ModerationResolution> = {
  remove: "removed",
  restore: "restored",
  "accept-appeal": "appeal_accepted",
  "reject-appeal": "appeal_rejected",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errors.validation("action が不正です");

  try {
    const result = await resolveModerationCase(id, ACTION_MAP[parsed.data.action]);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "処理に失敗しました";
    return errors.validation(message);
  }
}
