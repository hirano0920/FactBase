import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { errors } from "@/lib/api-helpers";
import { rejectRadarCandidate } from "@/lib/moderation-actions";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  try {
    const result = await rejectRadarCandidate(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "処理に失敗しました";
    return errors.validation(message);
  }
}
