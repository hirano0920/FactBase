import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { requireSession, checkRateLimit, errors, getClientIp } from "@/lib/api-helpers";
import { createComment } from "@/lib/comments";
import { invalidateOnCommentCreated } from "@/lib/cache-invalidate";
import { getComments } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { BURST, COMMENT_LIMITS, GUEST_COMMENT_LIMIT } from "@/lib/constants";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const allowed = await checkRateLimit(
    "comments-get",
    ip,
    BURST.commentsGetPerIpPerMin,
    60,
  );
  if (!allowed) return errors.rateLimited();

  const issueId = req.nextUrl.searchParams.get("issueId");
  if (!issueId) return errors.validation("issueIdが必要です");
  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;

  try {
    // 未ログインはAPI経由での取得も含めて常にGUEST_COMMENT_LIMIT件まで
    // （クライアント側の制限だけだと直接APIを叩けば回避できてしまうため）
    const session = await auth();
    if (!session?.user) {
      const page = await getComments(issueId, undefined, GUEST_COMMENT_LIMIT);
      return NextResponse.json({ ...page, nextCursor: null, guestLimited: page.comments.length >= GUEST_COMMENT_LIMIT });
    }

    const page = await getComments(issueId, cursor);
    return NextResponse.json(page);
  } catch (e) {
    console.error("[comments] list failed", e);
    return errors.internal();
  }
}

const createSchema = z.object({
  issueId: z.string().min(1),
  stance: z.enum(["for", "against", "undecided"]),
  body: z.string().min(COMMENT_LIMITS.minLength).max(COMMENT_LIMITS.maxLength),
});

export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const plan = session.user.plan;
  if (plan !== "COMMENT" && plan !== "FACTCHECK") {
    return errors.forbidden("コメントには500円プランへの登録が必要です");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errors.validation("リクエスト形式が正しくありません");
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validation(
      `コメントは${COMMENT_LIMITS.minLength}字以上${COMMENT_LIMITS.maxLength}字以内で投稿してください`,
    );
  }

  const ok = await checkRateLimit("comment", session.user.id, 5, 60);
  if (!ok) return errors.rateLimited();

  const issue = await prisma.issue.findUnique({
    where: { id: parsed.data.issueId },
    select: { id: true, status: true, slug: true },
  });
  if (!issue) return errors.notFound("この争点は存在しません");
  if (issue.status === "ARCHIVED") {
    return errors.validation("この争点の議論は終了しています");
  }

  try {
    const result = await createComment({
      userId: session.user.id,
      userCreatedAt: new Date(session.user.createdAt),
      issueId: issue.id,
      stance: parsed.data.stance,
      body: parsed.data.body,
    });

    if (!result.ok) {
      return result.status === 403
        ? errors.forbidden(result.message)
        : errors.validation(result.message);
    }

    void invalidateOnCommentCreated(issue.id, issue.slug);

    return NextResponse.json({ commentId: result.commentId }, { status: 201 });
  } catch (e) {
    console.error("[comments] create failed", e);
    return errors.internal();
  }
}
