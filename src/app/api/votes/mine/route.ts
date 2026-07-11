import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isDbEnabled } from "@/lib/data";
import { getVotedIssueIds } from "@/lib/votes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IDS = 50;

/**
 * ランキング等の一覧画面用: 渡した争点IDのうち、自分が投票済みのものだけ返す。
 * 未投票の争点はパーセンテージを見せない設計（結果を見る前にまず読んでほしいため）を
 * 一覧表示でも維持するための補助エンドポイント。
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || !isDbEnabled()) {
    return NextResponse.json({ votedIssueIds: [] as string[] });
  }

  const issueIds = (req.nextUrl.searchParams.get("issueIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  const votedIssueIds = await getVotedIssueIds(session.user.id, issueIds);
  return NextResponse.json({ votedIssueIds });
}
