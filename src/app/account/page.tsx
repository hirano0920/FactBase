import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section } from "@/components/layout/page-container";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { ProfileEditForm } from "@/components/account/profile-edit-form";
import { PLAN_PRICES, PLANS } from "@/lib/constants";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "アカウント設定" };

const PLAN_DISPLAY = {
  FREE: "無料",
  COMMENT: `Plusプラン（¥${PLAN_PRICES[PLANS.COMMENT]}/月）`,
  FACTCHECK: `Proプラン（¥${PLAN_PRICES[PLANS.FACTCHECK]}/月）`,
} as const;

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const profile = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { bio: true, avatarEmoji: true },
  });

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-8">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">アカウント設定</h1>
          </header>

          <div className="space-y-6">
            <Section>
              <h2 className="mb-4 text-base font-bold text-ink">プロフィール</h2>
              <ProfileEditForm
                initialName={session.user.name ?? ""}
                initialBio={profile?.bio ?? ""}
                initialAvatarEmoji={profile?.avatarEmoji ?? null}
              />
              <Link
                href={`/u/${session.user.id}`}
                className="mt-4 inline-block text-sm font-medium text-link"
              >
                公開プロフィールを見る →
              </Link>
            </Section>

            <Section>
              <h2 className="mb-3 text-base font-bold text-ink">基本情報</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-ink-faint">FactBase ID</dt>
                  <dd className="truncate font-mono text-xs text-ink-secondary">{session.user.id}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-faint">メール</dt>
                  <dd className="text-ink-secondary">{session.user.email ?? "未設定"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-faint">現在のプラン</dt>
                  <dd className="text-ink-secondary">{PLAN_DISPLAY[session.user.plan]}</dd>
                </div>
              </dl>
              <Link href="/pricing" className="mt-4 inline-block text-sm font-medium text-link">
                プランを変更する →
              </Link>
            </Section>

            <Section className="border-against/20">
              <h2 className="mb-3 text-base font-bold text-ink">退会</h2>
              <DeleteAccountButton />
            </Section>
          </div>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
