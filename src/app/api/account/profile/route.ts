import { NextResponse, type NextRequest } from "next/server";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { validateProfileInput } from "@/lib/profile";
import { containsNgContent } from "@/lib/moderation";

export const runtime = "nodejs";

/** 軽量プロフィール（表示名・一言）の更新。 */
export async function PATCH(req: NextRequest) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const ok = await checkRateLimit("profile-update", session.user.id, 10, 60);
  if (!ok) return errors.rateLimited();

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return errors.validation("リクエスト形式が正しくありません");
  }

  const result = validateProfileInput(body as Record<string, unknown>);
  if (!result.ok) {
    return errors.validation(result.message);
  }

  // 表示名・一言も誹謗中傷対策の対象にする（コメントの文字数制約は適用しない）
  const nameCheck = containsNgContent(result.data.name);
  if (!nameCheck.allowed) {
    return errors.validation("表示名に不適切な表現が含まれています");
  }
  if (result.data.bio) {
    const bioCheck = containsNgContent(result.data.bio);
    if (!bioCheck.allowed) {
      return errors.validation("一言に不適切な表現が含まれています");
    }
  }

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      name: result.data.name,
      bio: result.data.bio || null,
    },
    select: { name: true, bio: true },
  });

  return NextResponse.json(updated);
}
