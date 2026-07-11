import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, checkRateLimit, errors, apiError } from "@/lib/api-helpers";
import { checkDraftFactCheck } from "@/lib/fc-draft";
import { COMMENT_LIMITS, REPLY_LIMITS } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 30;

const draftSchema = z.object({
  issueId: z.string().min(1),
  body: z.string().min(REPLY_LIMITS.minLength).max(COMMENT_LIMITS.maxLength),
});

/**
 * 投稿前ファクトチェック（案B）。まだ保存されていない下書き本文を判定するだけで、
 * ブロックはしない・FcCacheにも保存しない（本文が確定していないため）。
 */
export async function POST(req: NextRequest) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errors.validation("リクエスト形式が正しくありません");
  }

  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) return errors.validation("本文が正しくありません");

  const burst = await checkRateLimit("factcheck-draft", session.user.id, 10, 60);
  if (!burst) return errors.rateLimited();

  const result = await checkDraftFactCheck(
    session.user.id,
    session.user.plan,
    parsed.data.issueId,
    parsed.data.body,
  );

  if (!result.ok) return apiError(result.status, result.message, result.code);

  const { ok: _ok, ...payload } = result;
  return NextResponse.json(payload);
}
