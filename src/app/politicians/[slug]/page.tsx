import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  getPoliticianPersuasionScore,
  getPoliticianVoteHistory,
  getRelatedNewsForPolitician,
} from "@/lib/politician-persuasion";
import { PoliticianVotePanel } from "@/components/politician/politician-vote-panel";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";

interface DietSpeech {
  date: string;
  house: string;
  meeting: string;
  session: string;
  speaker: string;
  speakerGroup: string;
  snippet: string;
  url: string;
}

/** 投票集計はクライアント側でハイドレートするため、ページ本体はISRでCDNに乗せる */
export const revalidate = 3600;

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

/** 賛否タグ付けの出典表示。LLM生成でなく一次データ由来であることを読者に明示する */
const SOURCE_LABEL: Record<string, string> = {
  "dietVote:party": "参議院本会議・記名投票（政党多数派）",
  "dietVote:defector": "参議院本会議・記名投票（本人の投票）",
};

interface PoliticianPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PoliticianPageProps): Promise<Metadata> {
  const { slug } = await params;
  const politician = await prisma.politician.findUnique({
    where: { slug: decodeURIComponent(slug) },
    select: { name: true, party: true },
  });
  if (!politician) return { title: "見つかりません" };
  const title = `${politician.name}の評価・争点での賛否記録`;
  const description = `${politician.name}${politician.party && politician.party !== politician.name ? `（${politician.party}）` : ""}の国会での賛否記録・争点横断の説得力スコア・みんなの評価投票。行動と発言に基づく評価をリアルタイムで確認できます。`;
  return {
    title,
    description,
    openGraph: { title, description },
  };
}

/**
 * 政治家/政党ページ。
 * 「人格への好き嫌い」でなく「行動・発言・国会活動」への評価に一貫して寄せる:
 * - 賛否記録は本会議の記名投票（一次データ）由来で、出典を明示する
 * - 評価投票の設問も「活動を評価しますか」の枠付け
 * - 説得力スコア（bridging）は従来通り
 * - 各争点から議論（Debate）への導線を張り、評価の根拠を読める場所につなぐ
 */
export default async function PoliticianPage({ params }: PoliticianPageProps) {
  const { slug: rawSlug } = await params;
  // 日本語名をそのままslugにしているため、URLエンコードされたままparamsに来ることがある
  // （Next.jsのdynamic route paramsが常に自動デコードされるとは限らない）。明示的にデコードする。
  const slug = decodeURIComponent(rawSlug);
  const politician = await prisma.politician.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      photoUrl: true,
      bioSummary: true,
      wikipediaUrl: true,
      recentStatementsJson: true,
      electoralDistrict: true,
    },
  });
  if (!politician) notFound();

  const [score, voteHistory, relatedNews] = await Promise.all([
    getPoliticianPersuasionScore(politician.id),
    getPoliticianVoteHistory(politician.id),
    getRelatedNewsForPolitician(politician.name),
  ]);
  if (!score) notFound();

  const statements = (politician.recentStatementsJson as unknown as DietSpeech[] | null) ?? [];
  const fundsReportSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(`site:soumu.go.jp OR site:soumu.go.jp/senkyo ${politician.name} 政治資金収支報告書`)}`;

  const activeIssues = voteHistory.filter(
    (v) => v.issueStatus === "ACTIVE" || v.issueStatus === "TRENDING",
  );

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-6 border-b border-border pb-6">
            <div className="flex items-start gap-4">
              {politician.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- Wikipedia由来の外部画像。next/imageの最適化対象外
                <img
                  src={politician.photoUrl}
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-full border border-border object-cover"
                />
              )}
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-ink">{score.name}</h1>
                {(score.party && score.party !== score.name) || politician.electoralDistrict ? (
                  <p className="mt-1 text-sm text-ink-secondary">
                    {score.party && score.party !== score.name && score.party}
                    {score.party && score.party !== score.name && politician.electoralDistrict && " · "}
                    {politician.electoralDistrict && `選挙区: ${politician.electoralDistrict}`}
                  </p>
                ) : null}
              </div>
            </div>

            {politician.bioSummary && (
              <div className="mt-4">
                <p className="text-sm leading-relaxed text-ink-secondary">{politician.bioSummary}</p>
                {politician.wikipediaUrl && (
                  <a
                    href={politician.wikipediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-ink-faint underline decoration-border underline-offset-2 hover:text-ink"
                  >
                    出典: Wikipedia
                  </a>
                )}
              </div>
            )}

          </header>

          <PoliticianVotePanel slug={slug} />

          {activeIssues.length > 0 && (
            <Section className="mt-6">
              <h2 className="mb-3 text-base font-bold text-ink">いま議論中の関連争点</h2>
              <ul className="space-y-2">
                {activeIssues.slice(0, 5).map((v) => (
                  <li key={v.issueId}>
                    <Link
                      href={`/issues/${v.issueSlug}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft/40 px-4 py-3 text-sm text-ink no-underline transition-colors hover:border-accent hover:bg-accent-soft"
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold",
                            STANCE_CLASS[v.stance],
                          )}
                        >
                          {STANCE_LABEL[v.stance]}
                        </span>
                        {v.issueTitle}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-accent">議論を見る →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {relatedNews.length > 0 && (
            <Section className="mt-6">
              <h2 className="mb-3 text-base font-bold text-ink">関連するニュース</h2>
              <ul className="space-y-2">
                {relatedNews.map((n) => (
                  <li key={n.slug}>
                    <Link
                      href={`/issues/${n.slug}`}
                      className="block rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm text-ink no-underline hover:border-accent"
                    >
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {statements.length > 0 && (
            <Section className="mt-6">
              <h2 className="mb-3 text-base font-bold text-ink">国会での過去の発言</h2>
              <ul className="space-y-3">
                {statements.map((s, i) => (
                  <li key={`${s.url}-${i}`} className="rounded-lg border border-border bg-surface-raised px-4 py-3">
                    <p className="text-xs text-ink-faint">
                      {s.date} · {s.house} {s.meeting}
                      {s.speakerGroup && ` · ${s.speakerGroup}`}
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink">{s.snippet}</p>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-block text-xs text-accent underline-offset-2 hover:underline"
                    >
                      会議録原文を見る →
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-faint">
                国会会議録検索システム（国立国会図書館）から取得。同姓同名の別人の発言が混入する可能性があります。
              </p>
            </Section>
          )}

          <Section className="mt-6">
            <h2 className="mb-2 text-base font-bold text-ink">政治資金収支報告書</h2>
            <p className="text-sm text-ink-secondary">
              政治資金の収支は総務省・都道府県選管が公開する報告書が一次情報です。内容の要約・転記による誤りを避けるため、当サイトでは検索リンクのみを提供します。
            </p>
            <a
              href={fundsReportSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-semibold text-accent underline-offset-2 hover:underline"
            >
              総務省の公開情報を検索する →
            </a>
          </Section>

          <Section className="mt-6">
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
            <h2 className="mb-3 text-base font-bold text-ink">争点での賛否記録</h2>
            {voteHistory.length === 0 ? (
              <p className="text-sm text-ink-muted">まだ記録がありません。</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {voteHistory.map((v) => (
                    <li
                      key={v.issueId}
                      className="rounded-lg border border-border bg-surface-raised px-4 py-2.5"
                    >
                      <div className="flex items-center gap-3">
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
                      </div>
                      {v.source && SOURCE_LABEL[v.source] && (
                        <p className="mt-1 pl-1 text-[11px] text-ink-faint">
                          出典: {SOURCE_LABEL[v.source]}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-faint">
                  賛否記録は本会議の記名投票結果などの一次データから機械的に取り込んでいます（AIによる推定ではありません）。
                  誤りを見つけた場合は該当争点ページから報告できます。
                </p>
              </>
            )}
          </Section>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
