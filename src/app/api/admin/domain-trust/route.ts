import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { errors, verifyOrigin } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * ドメイン信頼度フィルタ（DomainTrustRule）のCRUD。
 * scripts/radar/lib/domain-trust.ts のコード内denylistを補完する運用管理リスト。
 * Radar cron（GitHub Actions・別プロセス）は実行のたびにキャッシュ無しの状態から起動するため、
 * ここでの追加・削除は次回のRadar実行から自動的に反映される（明示的なキャッシュ無効化は不要）。
 */
export async function GET(req: NextRequest) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;

  const rules = await prisma.domainTrustRule.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ rules });
}

function normalizeHostname(raw: string): string {
  let h = raw.trim().toLowerCase();
  // URLをそのまま貼り付けても使えるように、スキーム・パス・ポートを許容する
  try {
    if (h.includes("://")) h = new URL(h).hostname;
    else if (h.includes("/")) h = new URL(`https://${h}`).hostname;
  } catch {
    // パース失敗時は入力をそのままホスト名として扱う（下のバリデーションで弾かれる）
  }
  return h.replace(/^www\./, "").split(":")[0];
}

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export async function POST(req: NextRequest) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;
  if (!verifyOrigin(req)) return errors.forbidden("不正なリクエストです");

  const body = await req.json().catch(() => null);
  const hostname = normalizeHostname(String(body?.hostname ?? ""));
  const note = typeof body?.note === "string" ? body.note.slice(0, 200) : null;
  if (!HOSTNAME_PATTERN.test(hostname)) {
    return errors.validation("有効なドメイン名を入力してください（例: example.com）");
  }

  const rule = await prisma.domainTrustRule.upsert({
    where: { hostname },
    create: { hostname, action: "DENY", note },
    update: { note },
  });
  return NextResponse.json({ rule });
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin(req);
  if (session instanceof NextResponse) return session;
  if (!verifyOrigin(req)) return errors.forbidden("不正なリクエストです");

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return errors.validation("idが必要です");

  await prisma.domainTrustRule.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
