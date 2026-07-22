import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp, verifyOrigin, errors } from "@/lib/api-helpers";
import { auth } from "@/auth";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

/** プッシュ購読の登録（ログイン不要。ゲストの朝ダイジェスト購読も許可する） */
export async function POST(req: NextRequest) {
  // ログイン必須ではないためrequireSession()は使えないが、他サイトからのCSRF POSTで
  // 無関係なendpoint/keysを登録されるのは防ぐ（他の状態変更APIと同じOrigin検証）
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "不正なリクエスト元です" }, { status: 403 });
  }
  const ip = getClientIp(req);
  const allowed = await checkRateLimit("push-subscribe", ip, 10, 60);
  if (!allowed) return errors.rateLimited();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errors.validation("リクエスト形式が正しくありません");
  }
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) return errors.validation("購読情報が正しくありません");

  const session = await auth();
  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: {
      keysJson: parsed.data.keys as unknown as Prisma.InputJsonValue,
      userId: session?.user?.id ?? undefined,
    },
    create: {
      endpoint: parsed.data.endpoint,
      keysJson: parsed.data.keys as unknown as Prisma.InputJsonValue,
      userId: session?.user?.id ?? null,
    },
  });
  return NextResponse.json({ ok: true });
}

/** 購読解除 */
export async function DELETE(req: NextRequest) {
  if (!verifyOrigin(req)) {
    return NextResponse.json({ error: "不正なリクエスト元です" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errors.validation("リクエスト形式が正しくありません");
  }
  const endpoint = (body as { endpoint?: string })?.endpoint;
  if (!endpoint) return errors.validation("endpointが必要です");
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return NextResponse.json({ ok: true });
}
