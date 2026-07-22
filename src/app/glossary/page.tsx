import Link from "next/link";
import { listGlossaryTerms } from "@/lib/glossary-pages";
import { AppSidebarStatic } from "@/components/layout/app-sidebar";
import { PageContainer } from "@/components/layout/page-container";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "政治・経済の用語集",
  description:
    "ニュースに出てくる政治・経済の専門用語をやさしく解説。各用語が実際に登場した争点・議論へのリンク付きで、文脈の中で理解できます。",
};

/** 用語集の一覧ページ（SEO入口）。出現記事数が多い順 = 世の中で今よく使われている順 */
export default async function GlossaryIndexPage() {
  const terms = await listGlossaryTerms(500);

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-6 border-b border-border pb-6">
            <h1 className="text-2xl font-bold text-ink">用語集</h1>
            <p className="mt-2 text-sm text-ink-secondary">
              ニュースに出てくる専門用語をやさしく解説。実際の争点・議論とセットで理解できます。
            </p>
          </header>

          {terms.length === 0 ? (
            <p className="text-sm text-ink-muted">まだ用語がありません。</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {terms.map((t) => (
                <li key={t.term}>
                  <Link
                    href={`/glossary/${encodeURIComponent(t.term)}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3.5 py-1.5 text-sm text-ink no-underline transition-colors hover:border-accent hover:text-accent"
                  >
                    {t.term}
                    {t.issueCount > 1 && (
                      <span className="text-xs text-ink-faint">{t.issueCount}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="hidden lg:block">
          <AppSidebarStatic />
        </div>
      </div>
    </PageContainer>
  );
}
