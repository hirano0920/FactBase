import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { reputationProgress, likeTitleProgress, REPUTATION_LADDERS, LIKE_TITLES } from "@/lib/reputation";
import { getUserPublicStats } from "@/lib/user-stats";
import { getUserInfluenceStats } from "@/lib/influence";
import { getUserTrustScore } from "@/lib/trust-score";
import { InfluenceStatsPanel } from "@/components/user/influence-stats-panel";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section } from "@/components/layout/page-container";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { ProfileEditForm } from "@/components/account/profile-edit-form";
import { UserDisplayName } from "@/components/user/display-name";
import { PLAN_PRICES, PLANS, SITE } from "@/lib/constants";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "アカウント設定" };

const PLAN_DISPLAY = {
  FREE: "無料（Newbie）",
  COMMENT: `Plus（¥${PLAN_PRICES[PLANS.COMMENT]}/月）`,
  FACTCHECK: `Pro（¥${PLAN_PRICES[PLANS.FACTCHECK]}/月）`,
} as const;

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const profile = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { bio: true },
  });

  const { visibleCommentCount: commentCount, totalLikes } = await getUserPublicStats(
    session.user.id,
  );
  const [influence, trust] = await Promise.all([
    getUserInfluenceStats(session.user.id),
    getUserTrustScore(session.user.id),
  ]);
  const progress = reputationProgress(session.user.plan, commentCount);
  const likeProgress = likeTitleProgress(totalLikes);

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-8">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">アカウント設定</h1>
          </header>

          <div className="space-y-6">
            <Section>
              <h2 className="mb-4 text-base font-bold text-ink">公開プロフィール</h2>
              <div className="mb-4 rounded-md border border-border bg-surface-muted/50 px-4 py-3">
                <UserDisplayName
                  userId={session.user.id}
                  name={session.user.name ?? "名無し"}
                  plan={session.user.plan}
                  commentCount={commentCount}
                  totalLikes={totalLikes}
                  variant="profile"
                  nameClassName="text-base"
                />
                {profile?.bio && (
                  <p className="mt-1 text-sm text-ink-muted">{profile.bio}</p>
                )}
                <p className="mt-2 text-xs text-ink-faint">
                  有効コメント {commentCount} 件 · 累計 like {totalLikes}
                  {progress.next && progress.commentsToNext !== null
                    ? ` · 次の tier（${progress.next.label}）まであと ${progress.commentsToNext} 件`
                    : " · tier 最高到達"}
                  {likeProgress.next && likeProgress.likesToNext !== null
                    ? ` · 次の称号（${likeProgress.next.label}）まであと ${likeProgress.likesToNext} like`
                    : likeProgress.current
                      ? " · like 称号最高到達"
                      : ""}
                </p>
              </div>
              <ProfileEditForm
                initialName={session.user.name ?? ""}
                initialBio={profile?.bio ?? ""}
              />
              <InfluenceStatsPanel influence={influence} trust={trust} />
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
                  <dt className="shrink-0 text-ink-faint">{SITE.name} ID</dt>
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

            {session.user.isAdmin && (
              <Section>
                <h2 className="mb-2 text-base font-bold text-ink">運営ツール</h2>
                <p className="mb-4 text-sm text-ink-muted">
                  争点の非公開・通報・異議申立の確認はこちらから。
                </p>
                <Link
                  href="/admin"
                  className="inline-flex items-center rounded-md border border-border bg-surface-raised px-4 py-2.5 text-sm font-semibold text-ink no-underline transition hover:bg-surface-muted"
                >
                  管理ダッシュボードを開く →
                </Link>
              </Section>
            )}

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
