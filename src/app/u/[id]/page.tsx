import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { tierLabel } from "@/lib/badges";
import { CATEGORIES } from "@/lib/constants";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section } from "@/components/layout/page-container";
import type { Metadata } from "next";

interface ProfilePageProps {
  params: Promise<{ id: string }>;
}

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id.toUpperCase(), c.label]),
);

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
      image: true,
      bio: true,
      avatarEmoji: true,
      createdAt: true,
      badges: { select: { category: true, tier: true, helpfulCount: true } },
    },
  });
  if (!user) notFound();

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-8 flex items-center gap-4">
            {user.avatarEmoji ? (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-3xl">
                {user.avatarEmoji}
              </span>
            ) : user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-16 w-16 shrink-0 rounded-full" />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-ink text-xl font-extrabold text-surface">
                {(user.name ?? "?").slice(0, 1)}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-ink">
                {user.name ?? "名無しの議論者"}
              </h1>
              {user.bio && (
                <p className="mt-0.5 truncate text-sm text-ink-secondary">{user.bio}</p>
              )}
              <p className="mt-0.5 text-sm text-ink-faint">
                {user.createdAt.toLocaleDateString("ja-JP")}から参加
              </p>
            </div>
          </header>

          <Section>
            <h2 className="mb-4 text-base font-bold text-ink">称号</h2>
            {user.badges.length === 0 ? (
              <p className="text-sm text-ink-faint">
                まだ称号はありません。役に立つコメントを投稿すると、カテゴリ別に称号が付与されます。
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {user.badges.map((badge) => (
                  <li
                    key={badge.category}
                    className="flex items-center justify-between rounded-md border border-border bg-surface-raised px-4 py-3"
                  >
                    <span className="text-sm text-ink-secondary">
                      {CATEGORY_LABELS[badge.category] ?? badge.category}
                    </span>
                    <span className="rounded-full border border-accent/25 bg-accent/5 px-2.5 py-0.5 text-xs font-medium text-accent">
                      {tierLabel(badge.tier)} · {badge.helpfulCount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
