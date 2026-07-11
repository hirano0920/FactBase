import { NextResponse, type NextRequest } from "next/server";
import { searchIssues } from "@/lib/data";

export const runtime = "nodejs";

const MAX_QUERY_LEN = 100;

/** 左カラムの記事検索用。ログイン不要。 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, MAX_QUERY_LEN);
  if (q.trim().length === 0) return NextResponse.json({ issues: [] });

  const issues = await searchIssues(q, 8);
  return NextResponse.json({ issues });
}
