import Link from "next/link";
import { notFound } from "next/navigation";
import { getGlossaryPage } from "@/lib/glossary-pages";
import { TrackBadge } from "@/components/issue/track-badge";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { PageContainer, Section } from "@/components/layout/page-container";
import type { Metadata } from "next";

export const revalidate = 3600;

interface GlossaryTermPageProps {
  params: Promise<{ term: string }>;
}

export async function generateMetadata({ params }: GlossaryTermPageProps): Promise<Metadata> {
  const { term: rawTerm } = await params;
  const term = decodeURIComponent(rawTerm);
  const page = await getGlossaryPage(term);
  if (!page) return { title: "用語が見つかりません" };
  return {
    title: `${page.term}とは？意味をやさしく解説`,
    description: `${page.def} — ${page.term}が実際に登場した争点・議論へのリンク付きで、文脈の中で理解できます。`,
  };
}

/**
 * 用語の個別ページ（「〇〇 とは」検索の受け皿）。
 * 定義だけの辞書ページにせず、「この用語が出てきた議論」への導線を主役にする
 * （調べものに来た人を争点・議論へ流す = SEO入口 → Debate本丸のファネル）
 */
export default async function GlossaryTermPage({ params }: GlossaryTermPageProps) {
  const { term: rawTerm } = await params;
  const term = decodeURIComponent(rawTerm);
  const page = await getGlossaryPage(term);
  if (!page) notFound();

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 max-w-content">
          <nav className="mb-4 text-xs text-ink-faint">
            <Link href="/glossary" className="no-underline hover:underline">
              用語集
            </Link>
            <span className="mx-1.5">/</span>
            <span>{page.term}</span>
          </nav>

          <header className="mb-6 border-b border-border pb-6">
            <h1 className="text-2xl font-bold text-ink">{page.term}とは</h1>
          </header>

          <Section>
            <p className="text-base leading-relaxed text-ink">{page.def}</p>
            {page.source === "wikipedia" && page.wikipediaUrl && (
              <p className="mt-3 text-xs text-ink-faint">
                出典:{" "}
                <a
                  href={page.wikipediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-border underline-offset-2 hover:text-ink"
                >
                  Wikipedia
                </a>
              </p>
            )}
            {page.source === "ai" && (
              <p className="mt-3 text-xs text-ink-faint">
                この説明はAIが生成したものです。誤りを見つけた場合は下記の争点ページから報告できます。
              </p>
            )}
          </Section>

          <Section className="mt-6">
            <h2 className="mb-3 text-base font-bold text-ink">
              「{page.term}」が出てくる議論
            </h2>
            <ul className="space-y-2">
              {page.issues.map((issue) => (
                <li key={issue.slug}>
                  <Link
                    href={`/issues/${issue.slug}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-ink no-underline transition-colors hover:border-accent"
                  >
                    <TrackBadge track={issue.track} />
                    <span className="min-w-0 flex-1">{issue.title}</span>
                    <span className="shrink-0 text-xs font-semibold text-accent">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <div className="hidden lg:block">
          <AppSidebarStatic />
        </div>
      </div>
    </PageContainer>
  );
}
