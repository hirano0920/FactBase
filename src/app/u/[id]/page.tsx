import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  reputationProgress,
  likeTitleProgress,
  REPUTATION_LADDERS,
  LIKE_TITLES,
} from "@/lib/reputation";
import { getUserPublicStats } from "@/lib/user-stats";
import { getUserInfluenceStats } from "@/lib/influence";
import { getUserTrustScore } from "@/lib/trust-score";
import { InfluenceStatsPanel } from "@/components/user/influence-stats-panel";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section } from "@/components/layout/page-container";
import { UserDisplayName } from "@/components/user/display-name";
import type { Metadata } from "next";

interface ProfilePageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return { title: user ? `${user.name ?? "ユーザー"}のプロフィール` : "ユーザーが見つかりません" };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      bio: true,
      plan: true,
      createdAt: true,
    },
  });
  if (!user) notFound();

  const { visibleCommentCount: commentCount, totalLikes } = await getUserPublicStats(user.id);
  const [influence, trust] = await Promise.all([
    getUserInfluenceStats(user.id),
    getUserTrustScore(user.id),
  ]);
  const progress = reputationProgress(user.plan, commentCount);
  const likeProgress = likeTitleProgress(totalLikes);
  const ladder = REPUTATION_LADDERS[user.plan];

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-6 border-b border-border pb-6">
            <UserDisplayName
              userId={user.id}
              name={user.name ?? "名無しの議論者"}
              plan={user.plan}
              commentCount={commentCount}
              totalLikes={totalLikes}
              variant="profile"
              nameClassName="text-2xl"
            />
            {user.bio && (
              <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{user.bio}</p>
            )}
            <p className="mt-2 text-sm text-ink-faint">
              {user.createdAt.toLocaleDateString("ja-JP")}から参加 · 有効コメント {commentCount} 件 ·
              累計 like {totalLikes}
            </p>
          </header>

          <Section>
            <h2 className="mb-3 text-base font-bold text-ink">議論インフルエンス</h2>
            <InfluenceStatsPanel influence={influence} trust={trust} />
          </Section>

          <Section>
            <h2 className="mb-3 text-base font-bold text-ink">tier（コメント数）</h2>
            <ul className="space-y-2">
              {ladder.map((tier) => {
                const reached = commentCount >= tier.minComments;
                return (
                  <li
                    key={tier.id}
                    className={`flex items-center justify-between rounded-md border px-4 py-2.5 text-sm ${
                      reached
                        ? "border-accent/30 bg-accent/5"
                        : "border-border bg-surface-raised text-ink-faint"
                    }`}
                  >
                    <span className={reached ? tier.colorClass : ""}>
                      {tier.emoji && <span className="mr-1">{tier.emoji}</span>}
                      {tier.label}
                    </span>
                    <span className="text-xs tabular-nums">
                      {tier.minComments === 0 ? "開始" : `${tier.minComments}件〜`}
                    </span>
                  </li>
                );
              })}
            </ul>
            {progress.next && progress.commentsToNext !== null && (
              <p className="mt-3 text-sm text-ink-muted">
                次の <span className={progress.next.colorClass}>{progress.next.label}</span> まであと{" "}
                <strong>{progress.commentsToNext}</strong> コメント
              </p>
            )}
          </Section>

          <Section className="mt-6">
            <h2 className="mb-3 text-base font-bold text-ink">like 称号</h2>
            <ul className="space-y-2">
              {[...LIKE_TITLES].reverse().map((title) => {
                const reached = totalLikes >= title.minLikes;
                return (
                  <li
                    key={title.id}
                    className={`flex items-center justify-between rounded-md border px-4 py-2.5 text-sm ${
                      reached
                        ? "border-accent/30 bg-accent/5"
                        : "border-border bg-surface-raised text-ink-faint"
                    }`}
                  >
                    <span className={reached ? title.colorClass : ""}>
                      <span className="mr-1">{title.emoji}</span>
                      {title.label}
                    </span>
                    <span className="text-xs tabular-nums">{title.minLikes} like〜</span>
                  </li>
                );
              })}
            </ul>
            {likeProgress.next && likeProgress.likesToNext !== null && (
              <p className="mt-3 text-sm text-ink-muted">
                次の <span className={likeProgress.next.colorClass}>{likeProgress.next.label}</span>{" "}
                まであと <strong>{likeProgress.likesToNext}</strong> like
              </p>
            )}
          </Section>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
