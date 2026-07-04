import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession, checkRateLimit, errors } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";
import { kv } from "@/lib/redis";
import { registrationIpKey } from "@/lib/geo";
import { registrationIpLockTtlSec } from "@/lib/registration-guard";

export const runtime = "nodejs";

const schema = z.object({ confirm: z.literal(true) });

/**
 * 退会（アカウント削除）。
 * - Stripeサブスクリプションがあれば即時解約
 * - Helpful/IssueQualityReport/AppealはUser直接のFK制約が無いため明示的に削除してから
 *   Userを削除（Account/Session/Vote/Comment/UserBadge/ReportはschemaのonDelete:Cascadeで自動削除）
 * - 誤操作防止のためbody.confirm===trueを必須にする（ボタン誤クリック・CSRF対策の多重防御）
 */
export async function DELETE(req: NextRequest) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const userId = session.user.id;

  const ok = await checkRateLimit("account-delete", userId, 3, 3600);
  if (!ok) return errors.rateLimited();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errors.validation("確認のためconfirm: trueを送信してください");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeSubscriptionId: true, registrationIp: true },
  });

  if (user?.stripeSubscriptionId) {
    try {
      await getStripe().subscriptions.cancel(user.stripeSubscriptionId);
    } catch (e) {
      // Stripe側で既に解約済み等は無視して削除を続行（ユーザーの退会意思を優先）
      console.error("[account] stripe cancel failed (続行)", e);
    }
  }

  try {
    await prisma.$transaction([
      prisma.helpful.deleteMany({ where: { userId } }),
      prisma.issueQualityReport.deleteMany({ where: { reporterId: userId } }),
      prisma.appeal.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);
    // 退会後の再登録による票水増しを防ぐ（1IP1アカウントを維持）
    if (user?.registrationIp) {
      try {
        await kv.set(registrationIpKey(user.registrationIp), "blocked", {
          ex: registrationIpLockTtlSec(),
        });
      } catch (e) {
        console.error("[account] registration IP lock failed", e);
      }
    }
  } catch (e) {
    console.error("[account] delete failed", e);
    return errors.internal();
  }

  return NextResponse.json({ deleted: true });
}
