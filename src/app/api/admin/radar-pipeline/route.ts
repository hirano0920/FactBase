import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { buildPipelineInspectReport } from "@/lib/radar-pipeline-inspect";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;

  const live = req.nextUrl.searchParams.get("live") === "1";

  try {
    const report = await buildPipelineInspectReport(prisma, { includeLiveBuzz: live });
    return NextResponse.json(report);
  } catch (e) {
    console.error("radar-pipeline inspect failed", e);
    return NextResponse.json(
      { error: { message: e instanceof Error ? e.message : "inspect failed" } },
      { status: 500 },
    );
  }
}
