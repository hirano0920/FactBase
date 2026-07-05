import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { errors } from "@/lib/api-helpers";
import { getLatestWorkflowRun, triggerWorkflowRun } from "@/lib/github-actions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;
  return NextResponse.json(await getLatestWorkflowRun());
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;
  try {
    await triggerWorkflowRun();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "実行に失敗しました";
    return errors.validation(message);
  }
}
