import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { errors } from "@/lib/api-helpers";
import { approveRadarCandidate, rejectRadarCandidate } from "@/lib/moderation-actions";

export const runtime = "nodejs";

/** HELD候補の処理。body: {"action": "approve" | "reject"}（省略時はreject=従来互換） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    const result =
      body.action === "approve"
        ? await approveRadarCandidate(id)
        : await rejectRadarCandidate(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "処理に失敗しました";
    return errors.validation(message);
  }
}
