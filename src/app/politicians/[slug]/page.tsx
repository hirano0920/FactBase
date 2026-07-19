import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getPoliticianPersuasionScore, getPoliticianVoteHistory } from "@/lib/politician-persuasion";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";

const STANCE_LABEL: Record<"FOR" | "AGAINST" | "ABSTAIN", string> = {
  FOR: "賛成",
  AGAINST: "反対",
  ABSTAIN: "棄権",
};
const STANCE_CLASS: Record<"FOR" | "AGAINST" | "ABSTAIN", string> = {
  FOR: "bg-for-muted text-for",
  AGAINST: "bg-against-muted text-against",
  ABSTAIN: "bg-neutral-muted text-neutral",
};

interface PoliticianPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PoliticianPageProps): Promise<Metadata> {
  const { slug } = await params;
  const politician = await prisma.politician.findUnique({
    where: { slug: decodeURIComponent(slug) },
    select: { name: true },
  });
  return { title: politician ? `${politician.name}の説得力スコア` : "見つかりません" };
}

/**
 * 政治家/政党の争点横断・説得力スコアページ。
 * 生の支持率(好き嫌い投票)ではなく、タグ付けされた争点でその立場側のコメントが
 * 相手陣営・中立層からどれだけ支持されたか(bridging)を積み上げて表示する。
 * タグ付け(IssuePolitician行の作成)自体は今回未実装で、手動投入 or 将来のパイプライン拡張が前提。
 */
export default async function PoliticianPage({ params }: PoliticianPageProps) {
  const { slug: rawSlug } = await params;
  // 日本語名をそのままslugにしているため、URLエンコードされたままparamsに来ることがある
  // （Next.jsのdynamic route paramsが常に自動デコードされるとは限らない）。明示的にデコードする。
  const slug = decodeURIComponent(rawSlug);
  const politician = await prisma.politician.findUnique({ where: { slug }, select: { id: true } });
  if (!politician) notFound();

  const [score, voteHistory] = await Promise.all([
    getPoliticianPersuasionScore(politician.id),
    getPoliticianVoteHistory(politician.id),
  ]);
  if (!score) notFound();

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-6 border-b border-border pb-6">
            <h1 className="text-2xl font-bold text-ink">{score.name}</h1>
            {score.party && <p className="mt-1 text-sm text-ink-secondary">{score.party}</p>}
          </header>

          <Section>
            <h2 className="mb-3 text-base font-bold text-ink">争点横断・中立層への説得力</h2>
            {score.issueCount === 0 ? (
              <p className="text-sm text-ink-muted">
                まだこの政治家/政党がタグ付けされた争点がありません。
              </p>
            ) : (
              <div className="rounded-lg border border-border bg-surface-muted/50 px-4 py-4">
                <p className="text-sm text-ink-secondary">
                  タグ付けされた争点 <strong className="text-ink">{score.issueCount}</strong> 件
                </p>
                <p className="mt-2 text-sm text-ink-secondary">
                  この立場側のコメントが受けた評価 <strong className="text-ink">{score.totalHelpful}</strong> 件
                </p>
                {score.bridgingRate !== null ? (
                  <p className="mt-2 text-sm text-ink-secondary">
                    うち相手陣営・中立層からの評価{" "}
                    <strong className="text-ink">{score.bridgingHelpful}</strong> 件（
                    <strong className="text-ink">{score.bridgingRate}%</strong>）
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-ink-faint">
                    評価件数がまだ少なく、割合を表示できるほどのデータが揃っていません。
                  </p>
                )}
              </div>
            )}
            <p className="mt-4 text-xs text-ink-faint">
              これは支持率のような「好き嫌い」の投票ではありません。この政治家/政党が取った立場の主張が、
              賛成・反対にかかわらずどれだけ他の陣営や中立層を説得できたかを表す指標です。
            </p>
          </Section>

          <Section className="mt-6">
            <h2 className="mb-3 text-base font-bold text-ink">直近の争点での賛否</h2>
            {voteHistory.length === 0 ? (
              <p className="text-sm text-ink-muted">まだ記録がありません。</p>
            ) : (
              <ul className="space-y-2">
                {voteHistory.map((v) => (
                  <li
                    key={v.issueId}
                    className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised px-4 py-2.5"
                  >
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
                        STANCE_CLASS[v.stance],
                      )}
                    >
                      {STANCE_LABEL[v.stance]}
                    </span>
                    <Link
                      href={`/issues/${v.issueSlug}`}
                      className="min-w-0 flex-1 truncate text-sm text-ink no-underline hover:text-accent hover:underline"
                    >
                      {v.issueTitle}
                    </Link>
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
