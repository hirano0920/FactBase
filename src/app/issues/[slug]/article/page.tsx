import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CategoryBadge, StatusBadge } from "@/components/ui/badge";
import { PageContainer } from "@/components/layout/page-container";
import { AdSlotGated } from "@/components/layout/ad-slot-gated";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { SidebarSkeleton } from "@/components/layout/sidebar-skeleton";
import { LeftRail } from "@/components/layout/left-rail";
import { ArticleTimeline } from "@/components/issue/article-timeline";
import { GlossaryHtmlProvider } from "@/components/issue/glossary-html-provider";
import { getIssueBySlug, getRelatedIssues } from "@/lib/data";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { injectGlossarySpans } from "@/lib/glossary-html";
import { renderTextWithGlossary } from "@/lib/glossary-render";
import { extractListItems, isOpeningSectionHeading, splitArticleSections } from "@/lib/article-sections";
import { debateTypeHasPolarity, detectForSideIndex } from "@/lib/debate-type";
import { HOME_THREE_COL_GRID, SITE } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";

/** 論点の箇条書きをクリックすると、その論点を引用した状態でコメント欄まで飛べるようにする */
function quoteHref(slug: string, quote: string): string {
  const params = new URLSearchParams({ quote: quote.slice(0, 200) });
  return `/issues/${slug}?${params.toString()}#comment-form`;
}

const SECTION_ACCENT = [
  "border-accent/25 bg-accent/5",
  "border-warm/25 bg-warm-muted/40",
  "border-border-strong bg-surface-muted",
] as const;

const TIMELINE_HEADINGS = new Set(["これまでの流れ", "時系列"]);

export const revalidate = 3600;

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const issue = await getIssueBySlug(slug);
  if (!issue) return { title: "記事が見つかりません" };
  return {
    title: `${issue.title} — 解説`,
    description: issue.summary.lead,
    openGraph: {
      title: `${issue.title} — 解説`,
      description: issue.summary.lead,
      type: "article",
      images: [`/issues/${issue.slug}/opengraph-image`],
    },
  };
}

function VerificationBar({
  confirmation,
  sourceCount,
}: {
  confirmation: "official" | "reported" | null;
  sourceCount: number;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted px-4 py-3">
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
        主張の裏取り済み
      </span>

      {sourceCount > 0 && (
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
          {sourceCount}件のソースを参照
        </span>
      )}

      {confirmation === "official" && (
        <span className="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 ring-1 ring-purple-200">
          官公庁・国会等の一次情報あり
        </span>
      )}
      {confirmation === "reported" && (
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
          報道ベース・真偽は未確認
        </span>
      )}

      <span className="ml-auto text-xs text-ink-faint">Grok 4.3生成 + ChatGPT 5 nanoによる独立照合</span>
    </div>
  );
}

/** 関連争点は本文より後でよいので別チャンクで遅延（TTFB短縮） */
async function RelatedIssuesAside({ slug }: { slug: string }) {
  const relatedIssues = await getRelatedIssues(slug);
  if (relatedIssues.length === 0) return null;
  return (
    <aside className="mt-8">
      <h3 className="mb-3 text-sm font-semibold text-ink-faint">関連する争点</h3>
      <ul className="space-y-2">
        {relatedIssues.map((r) => (
          <li key={r.slug}>
            <Link
              href={`/issues/${r.slug}`}
              className="flex items-start gap-2 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-ink transition-colors hover:border-accent/40 hover:bg-accent/5"
            >
              <span className="mt-0.5 shrink-0 text-xs font-medium text-ink-faint capitalize">
                {r.category}
              </span>
              <span className="line-clamp-2 leading-snug">{r.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const issue = await getIssueBySlug(slug);
  if (!issue || !issue.articleHtml) notFound();

  const safeHtml = sanitizeArticleHtml(issue.articleHtml);
  const sourceCount = issue.summary.sourceCount ?? issue.summary.sources?.length ?? 0;

  const rawSections = splitArticleSections(safeHtml);
  const rawSplitAnchorIdx = rawSections.findIndex((s) => s.heading === "どこで意見が分かれるか");
  const rawSplitPairIdx =
    rawSplitAnchorIdx !== -1 && rawSections[rawSplitAnchorIdx + 1] && rawSections[rawSplitAnchorIdx + 2]
      ? [rawSplitAnchorIdx + 1, rawSplitAnchorIdx + 2]
      : [];

  function priorityOf(heading: string | null, idx: number): number {
    if (heading && TIMELINE_HEADINGS.has(heading)) return -1;
    if (idx === rawSplitAnchorIdx) return 0;
    if (rawSplitPairIdx.includes(idx)) return 0.5;
    if (heading === "各社は何を伝えているか") return 2;
    if (heading === "まだ分からないこと") return 4;
    if (heading === "出典") return 5;
    return 3;
  }

  const sections = rawSections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !isOpeningSectionHeading(s.heading))
    .sort((a, b) => {
      const pa = priorityOf(a.s.heading, a.i);
      const pb = priorityOf(b.s.heading, b.i);
      return pa !== pb ? pa - pb : a.i - b.i;
    })
    .map(({ s }) => s);

  const splitAnchorIdx = sections.findIndex((s) => s.heading === "どこで意見が分かれるか");
  const splitPair =
    splitAnchorIdx !== -1 && sections[splitAnchorIdx + 1] && sections[splitAnchorIdx + 2]
      ? ([splitAnchorIdx + 1, splitAnchorIdx + 2] as const)
      : null;
  const splitHasPolarity = debateTypeHasPolarity(issue.debateType);

  return (
    <PageContainer>
      <div className={`grid gap-6 lg:gap-8 ${HOME_THREE_COL_GRID}`}>
        <div className="hidden xl:block">
          <LeftRail />
        </div>

        <div className="min-w-0 max-w-[44rem]">
          {/* 広告は1枠に抑え、viewer二重取得を減らす */}
          <AdSlotGated slug={slug} className="mb-8" />

          <header className="mb-8">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <CategoryBadge category={issue.category} />
              <StatusBadge status={issue.status} />
            </div>
            <h1 className="font-serif text-3xl font-semibold leading-tight text-ink sm:text-4xl text-balance">
              {issue.title}
            </h1>

            <div className="mt-5 rounded-xl border border-accent/20 bg-accent/5 px-5 py-4">
              <p className="mb-1.5 text-xs font-extrabold tracking-wide text-accent">要約</p>
              <p className="text-base leading-relaxed text-ink-secondary">
                {renderTextWithGlossary(issue.summary.lead, issue.glossary)}
              </p>
            </div>

            <VerificationBar confirmation={issue.confirmation} sourceCount={sourceCount} />

            {issue.articleGeneratedAt && (
              <p className="mt-3 text-xs text-ink-faint">
                {new Date(issue.articleGeneratedAt).toLocaleDateString("ja-JP")}生成
              </p>
            )}
          </header>

          <GlossaryHtmlProvider glossary={issue.glossary}>
          <div className="space-y-5">
            {sections.map((section, i) => {
              if (splitPair && (i === splitPair[0] || i === splitPair[1])) {
                if (i === splitPair[1]) return null;
                const other = sections[splitPair[1]];
                const forIndex = detectForSideIndex(section.heading ?? "", other.heading ?? "") ?? 0;
                return (
                  <div key="split" className="grid gap-3 sm:grid-cols-2">
                    {[section, other].map((side, sideIdx) => {
                      const isForSide = sideIdx === forIndex;
                      const borderBg = splitHasPolarity
                        ? isForSide
                          ? "border-for/25 bg-for-muted/40"
                          : "border-against/25 bg-against-muted/40"
                        : sideIdx === 0
                          ? "border-accent/25 bg-accent-soft/60"
                          : "border-warm/25 bg-warm-muted/40";
                      const text = splitHasPolarity
                        ? isForSide
                          ? "text-for"
                          : "text-against"
                        : sideIdx === 0
                          ? "text-accent"
                          : "text-warm";
                      return (
                        <section key={sideIdx} className={cn("rounded-xl border p-5 sm:p-6", borderBg)}>
                          {side.heading && (
                            <h2 className={cn("mb-3 font-serif text-lg font-semibold", text)}>
                              {side.heading}
                            </h2>
                          )}
                          <div
                            className="prose-article"
                            dangerouslySetInnerHTML={{ __html: injectGlossarySpans(side.bodyHtml, issue.glossary) }}
                          />
                        </section>
                      );
                    })}
                  </div>
                );
              }

              return (
                <section
                  key={i}
                  className={cn(
                    "rounded-xl border p-5 sm:p-6",
                    section.heading
                      ? SECTION_ACCENT[i % SECTION_ACCENT.length]
                      : "border-border bg-surface-raised",
                  )}
                >
                  {section.heading && (
                    <h2 className="mb-3 font-serif text-xl font-semibold text-ink">
                      {section.heading}
                    </h2>
                  )}
                  {section.heading === "論点" ? (
                    <div>
                      <div
                        className="prose-article"
                        dangerouslySetInnerHTML={{ __html: injectGlossarySpans(section.bodyHtml, issue.glossary) }}
                      />
                      <p className="mb-2 mt-4 text-xs font-medium text-ink-faint">
                        この理由を引用してコメントを書く →
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {extractListItems(section.bodyHtml).map((point, j) => (
                          <Link
                            key={j}
                            href={quoteHref(issue.slug, point)}
                            className="rounded-full border border-accent/40 bg-white px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white"
                          >
                            {point.length > 40 ? `${point.slice(0, 40)}…` : point}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : section.heading && TIMELINE_HEADINGS.has(section.heading) ? (
                    <ArticleTimeline bodyHtml={section.bodyHtml} />
                  ) : (
                    <div
                      className="prose-article"
                      dangerouslySetInnerHTML={{ __html: injectGlossarySpans(section.bodyHtml, issue.glossary) }}
                    />
                  )}
                </section>
              );
            })}
          </div>
          </GlossaryHtmlProvider>

          <Link
            href={`/issues/${issue.slug}`}
            className="relative mt-10 block overflow-hidden rounded-[20px] border border-border bg-surface-raised px-6 py-7 text-center no-underline transition-transform hover:-translate-y-0.5"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-accent/[0.14] blur-[60px]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-hot/[0.12] blur-[60px]"
            />
            <p className="relative bg-gradient-to-r from-accent to-hot bg-clip-text text-lg font-bold text-transparent">
              投票して、賛成派・反対派の意見を読み比べる
            </p>
            <p className="relative mt-1.5 text-sm text-ink-secondary">
              声の大きさではなく納得感で並ぶ、{SITE.name}だけのスプリットスレッドへ →
            </p>
          </Link>

          <Suspense fallback={null}>
            <RelatedIssuesAside slug={slug} />
          </Suspense>
        </div>

        <div className="hidden lg:block">
          <Suspense fallback={<SidebarSkeleton />}>
            <AppSidebarStatic />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}
