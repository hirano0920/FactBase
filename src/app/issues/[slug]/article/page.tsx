import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryBadge, StatusBadge } from "@/components/ui/badge";
import { PageContainer } from "@/components/layout/page-container";
import { AdSlotGated } from "@/components/layout/ad-slot-gated";
import { getIssueBySlug, getRelatedIssues } from "@/lib/data";
import { sanitizeArticleHtml } from "@/lib/sanitize";
import { extractListItems, splitArticleSections } from "@/lib/article-sections";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";

/** 論点の箇条書きをクリックすると、その論点を引用した状態でコメント欄まで飛べるようにする */
function quoteHref(slug: string, quote: string): string {
  const params = new URLSearchParams({ quote: quote.slice(0, 200) });
  return `/issues/${slug}?${params.toString()}#comment-form`;
}

/*
 * 見出しの内容（賛成/反対など）とは無関係に、単に論点ごとの区切りを視覚化するための配色ローテーション。
 * for/against(緑/赤)は投票結果の意味を持つ色なので、記事の内容分けには使わない。
 */
const SECTION_ACCENT = [
  "border-accent/25 bg-accent/5",
  "border-warm/25 bg-warm-muted/40",
  "border-border-strong bg-surface-muted",
] as const;

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

/** 時系列セクションのli要素から「日付」と「本文」を分離してタイムライン形式で描画する */
function TimelineSection({ bodyHtml }: { bodyHtml: string }) {
  const items = extractListItems(bodyHtml);
  if (items.length === 0) {
    return <div className="prose-article" dangerouslySetInnerHTML={{ __html: bodyHtml }} />;
  }

  return (
    <ol className="relative ml-3 space-y-0 border-l-2 border-accent/30">
      {items.map((item, i) => {
        // 「M月D日:」または「YYYY年M月D日:」形式の日付プレフィックスを検出
        const dateMatch = item.match(/^(\d{4}年)?(\d{1,2}月\d{1,2}日)[:\s：]+(.+)/);
        const date = dateMatch ? (dateMatch[1] ?? "") + dateMatch[2] : null;
        const body = dateMatch ? dateMatch[3].trim() : item;
        return (
          <li key={i} className="relative pl-6 pb-5 last:pb-0">
            {/* タイムラインのドット */}
            <span className="absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-accent/60 bg-surface-raised" />
            {date ? (
              <>
                <p className="mb-0.5 text-xs font-bold text-accent">{date}</p>
                <p className="text-sm leading-relaxed text-ink-secondary">{body}</p>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-ink-secondary">{body}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** 検証バッジ: 裏取り実施済み・ソース件数・確認ステータスを一目で示す */
function VerificationBar({
  confirmation,
  sourceCount,
}: {
  confirmation: "official" | "reported" | null;
  sourceCount: number;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-muted px-4 py-3">
      {/* 機械的照合済みバッジ */}
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

      {/* ソース件数バッジ */}
      {sourceCount > 0 && (
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
          {sourceCount}件のソースを横断比較
        </span>
      )}

      {/* 確認ステータスバッジ */}
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

      <span className="ml-auto text-xs text-ink-faint">GPT-5生成 + nanoによる独立照合</span>
    </div>
  );
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const [issue, relatedIssues] = await Promise.all([
    getIssueBySlug(slug),
    getRelatedIssues(slug),
  ]);
  if (!issue || !issue.articleHtml) notFound();

  // AI生成HTMLは必ずサニタイズしてから描画（プロンプトインジェクション対策）
  const safeHtml = sanitizeArticleHtml(issue.articleHtml);
  const sections = splitArticleSections(safeHtml);
  const sourceCount = issue.summary.sources?.length ?? 0;

  return (
    <PageContainer width="content">
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
          <p className="text-base leading-relaxed text-ink-secondary">{issue.summary.lead}</p>
        </div>

        {/* 検証バッジ */}
        <VerificationBar confirmation={issue.confirmation} sourceCount={sourceCount} />

        {issue.articleGeneratedAt && (
          <p className="mt-3 text-xs text-ink-faint">
            {new Date(issue.articleGeneratedAt).toLocaleDateString("ja-JP")}生成
          </p>
        )}
      </header>

      <div className="space-y-5">
        {sections.map((section, i) => (
          <section
            key={i}
            className={cn(
              "animate-fade-slide-up rounded-xl border p-5 sm:p-6",
              section.heading
                ? SECTION_ACCENT[i % SECTION_ACCENT.length]
                : "border-border bg-surface-raised",
            )}
            style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}
          >
            {section.heading && (
              <h2 className="mb-3 font-serif text-xl font-semibold text-ink">{section.heading}</h2>
            )}
            {section.heading === "論点" ? (
              <div>
                <div
                  className="prose-article"
                  dangerouslySetInnerHTML={{ __html: section.bodyHtml }}
                />
                <p className="mb-2 mt-4 text-xs font-medium text-ink-faint">
                  この論点について意見を書く →
                </p>
                <div className="flex flex-wrap gap-2">
                  {extractListItems(section.bodyHtml).map((point, j) => (
                    <Link
                      key={j}
                      href={quoteHref(issue.slug, point)}
                      className="rounded-full border border-accent/40 bg-white px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white"
                    >
                      💬 {point.length > 40 ? `${point.slice(0, 40)}…` : point}
                    </Link>
                  ))}
                </div>
              </div>
            ) : section.heading === "時系列" ? (
              <TimelineSection bodyHtml={section.bodyHtml} />
            ) : (
              <div
                className="prose-article"
                dangerouslySetInnerHTML={{ __html: section.bodyHtml }}
              />
            )}
          </section>
        ))}
      </div>

      <div className="mt-10 rounded-md border border-accent/20 bg-accent/5 px-5 py-4 text-center">
        <p className="text-sm text-ink-secondary">
          この争点について
          <Link href={`/issues/${issue.slug}`} className="mx-1 font-medium text-link">
            投票・議論に参加する →
          </Link>
        </p>
      </div>

      {/* 関連する過去の争点 */}
      {relatedIssues.length > 0 && (
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
      )}

      <AdSlotGated slug={slug} label="フッター広告" className="mt-8" />
    </PageContainer>
  );
}
