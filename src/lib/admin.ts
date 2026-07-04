import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin-emails";
import { requireSession, errors } from "@/lib/api-helpers";
import type { Session } from "next-auth";

export { getAdminEmails, isAdminEmail } from "@/lib/admin-emails";

/** ログイン + ADMIN_EMAILS 一致。未設定時は全員403。 */
export async function requireAdmin(req?: NextRequest): Promise<Session | NextResponse> {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;
  if (!isAdminEmail(session.user.email)) {
    return errors.forbidden(
      process.env.ADMIN_EMAILS ? "管理者権限が必要です" : "ADMIN_EMAILS が未設定です",
    );
  }
  return session;
}

/** サーバーコンポーネント用 */
export async function getAdminSession(): Promise<Session | null> {
  const session = await auth();
  if (!session?.user?.id || !isAdminEmail(session.user.email)) return null;
  return session;
}
