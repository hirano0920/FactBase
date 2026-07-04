import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryBadge, StatusBadge } from "@/components/ui/badge";
import { PageContainer, AdSlot } from "@/components/layout/page-container";
import { getIssueBySlug } from "@/lib/data";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import type { Metadata } from "next";

// Next.jsのセグメント設定はリテラルのみ許可のため、lib/constants.tsのISSUE_PAGE_REVALIDATE_SEC(3600)と値を同期
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

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const issue = await getIssueBySlug(slug);
  if (!issue || !issue.articleHtml) notFound();

  // AI生成HTMLは必ずサニタイズしてから描画（プロンプトインジェクション対策）
  const safeHtml = sanitizeArticleHtml(issue.articleHtml);

  return (
    <PageContainer width="content">
      <AdSlot className="mb-8" />

      <header className="mb-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <CategoryBadge category={issue.category} />
          <StatusBadge status={issue.status} />
        </div>
        <h1 className="font-serif text-3xl font-semibold leading-tight text-ink sm:text-4xl text-balance">
          {issue.title}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-ink-secondary">
          {issue.summary.lead}
        </p>
        {issue.articleGeneratedAt && (
          <p className="mt-3 text-xs text-ink-faint">
            AI生成記事（GPT-5・一次情報のみ使用）·{" "}
            {new Date(issue.articleGeneratedAt).toLocaleDateString("ja-JP")}生成
          </p>
        )}
      </header>

      <article
        className="prose-article"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />

      <div className="mt-10 rounded-md border border-accent/20 bg-accent/5 px-5 py-4 text-center">
        <p className="text-sm text-ink-secondary">
          この争点について
          <Link href={`/issues/${issue.slug}`} className="mx-1 font-medium text-link">
            投票・議論に参加する →
          </Link>
        </p>
      </div>

      <AdSlot label="フッター広告" className="mt-8" />
    </PageContainer>
  );
}
