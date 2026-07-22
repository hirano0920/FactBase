import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { PageContainer, Section } from "@/components/layout/page-container";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "政治家・政党の評価と賛否記録一覧",
  description:
    "国会での記名投票など一次データに基づく政治家・政党の賛否記録と、行動・発言への評価投票。誰がどの争点でどちら側だったかを横断して確認できます。",
};

/**
 * 政治家/政党の一覧ページ（SEO入口）。
 * 争点タグ数が多い順 = データが充実しているページから見せる。
 * 政党エントリ（party === name）と個人を分けて表示する。
 */
export default async function PoliticiansPage() {
  const politicians = await prisma.politician.findMany({
    select: {
      slug: true,
      name: true,
      party: true,
      _count: { select: { issues: true, votes: true } },
    },
    orderBy: [{ issues: { _count: "desc" } }, { createdAt: "asc" }],
    take: 200,
  });

  const parties = politicians.filter((p) => p.party === p.name);
  const individuals = politicians.filter((p) => p.party !== p.name);

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-6 border-b border-border pb-6">
            <h1 className="text-2xl font-bold text-ink">政治家・政党</h1>
            <p className="mt-2 text-sm text-ink-secondary">
              国会での記名投票などの一次データに基づく賛否記録と、行動・発言への評価。
              人柄の人気投票ではなく「何をしてきたか」で見る一覧です。
            </p>
          </header>

          {politicians.length === 0 ? (
            <p className="text-sm text-ink-muted">まだ登録がありません。</p>
          ) : (
            <>
              {parties.length > 0 && (
                <Section>
                  <h2 className="mb-3 text-base font-bold text-ink">政党</h2>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {parties.map((p) => (
                      <li key={p.slug}>
                        <Link
                          href={`/politicians/${encodeURIComponent(p.slug)}`}
                          className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-ink no-underline transition-colors hover:border-accent"
                        >
                          <span className="font-semibold">{p.name}</span>
                          <span className="text-xs text-ink-faint">争点 {p._count.issues}件</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {individuals.length > 0 && (
                <Section className="mt-6">
                  <h2 className="mb-3 text-base font-bold text-ink">政治家</h2>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {individuals.map((p) => (
                      <li key={p.slug}>
                        <Link
                          href={`/politicians/${encodeURIComponent(p.slug)}`}
                          className="flex items-center justify-between rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-ink no-underline transition-colors hover:border-accent"
                        >
                          <span className="min-w-0">
                            <span className="font-semibold">{p.name}</span>
                            {p.party && <span className="ml-2 text-xs text-ink-faint">{p.party}</span>}
                          </span>
                          <span className="shrink-0 text-xs text-ink-faint">争点 {p._count.issues}件</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
        </div>

        <div className="hidden lg:block">
          <AppSidebarStatic />
        </div>
      </div>
    </PageContainer>
  );
}
