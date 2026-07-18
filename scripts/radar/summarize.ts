/**
 * FactBase Radar — Level 2「現時点まとめ」をGPT-5で生成（速報公開の10〜30分後）。
 *
 * 実行: npx tsx scripts/radar/summarize.ts
 * 記事生成そのものの安全設計（プロンプト・断定表現チェック）は src/lib/radar-article.ts を参照。
 * 続報が来た後の再生成は scripts/radar/followup.ts が別枠の日次上限で担当する。
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { RADAR } from "../../src/lib/constants";
import { jstDayStart } from "../../src/lib/radar";
import { generateVerifiedArticle, violatesBan, hasFactualClaimIssue } from "../../src/lib/radar-article";
import { fetchPrimaryExcerpts } from "./lib/primary-text";
import { fetchReportExcerpts } from "./lib/report-text";
import { ensureEvidence, evidenceToArticleFacts, internationalNewsSources, pollingNewsSources } from "./lib/enrich";
import { notifyRadarFailure } from "./notify";
import { notifyRevalidate } from "./lib/notify-revalidate";

const prisma = new PrismaClient();

async function main() {
  const dailyLimit = Number(
    process.env.ARTICLE_DAILY_ARTICLE_LIMIT ??
      process.env.SONNET_DAILY_ARTICLE_LIMIT ??
      RADAR.articleDailyArticleLimit,
  );
  const generatedToday = await prisma.issue.count({
    where: { articleGeneratedAt: { gte: jstDayStart() } },
  });
  if (generatedToday >= dailyLimit) {
    console.log(`本日の記事生成上限（${dailyLimit}）に到達済み — skip`);
    return;
  }

  // Radar公開済み・記事未生成・公開から10分以上経過（続報が集まるのを少し待つ）
  const pending = await prisma.issue.findMany({
    where: {
      confirmation: { in: ["OFFICIAL", "REPORTED"] },
      articleHtml: null,
      createdAt: { lte: new Date(Date.now() - 10 * 60_000) },
    },
    orderBy: { createdAt: "asc" },
    take: dailyLimit - generatedToday,
  });
  if (pending.length === 0) {
    console.log("生成待ちの争点なし");
    return;
  }

  for (const issue of pending) {
    const candidate = await prisma.topicCandidate.findUnique({
      where: { issueId: issue.id },
      select: {
        id: true,
        evidenceJson: true,
        updatedAt: true,
        topicTerm: true,
        title: true,
        sourceUrls: true,
        decision: true,
      },
    });
    const sources =
      (candidate?.sourceUrls as { title: string; url: string; feed: string; publishedAt?: string }[]) ?? [];
    if (sources.length === 0) continue;

    let isReported = issue.confirmation === "REPORTED";

    console.log(`生成中: ${issue.title}`);
    try {
      let primaryExcerpts = isReported ? [] : await fetchPrimaryExcerpts(sources);
      if (!isReported && primaryExcerpts.length === 0) {
        console.warn(`  ⚠️ OFFICIALだが一次本文なし → REPORTEDにフォールバック: ${issue.title}`);
        isReported = true;
      }
      const reportExcerpts = isReported ? await fetchReportExcerpts(sources) : [];

      // detect.ts系（RSSクラスタ経由）はdiscover.tsのような能動調査を経ていないため、
      // ここでdiscover.ts相当の調査（国会会議録・関連法令・Wikipedia背景・国内外報道）を後付けする。
      // 検索語はnanoで正規化されていないissue.titleをそのまま使う（ヒットしなくても記事生成は続行）。
      const evidence = await ensureEvidence(prisma, issue.title, candidate);
      const { dietSpeeches, background, laws, estatStats, estatFigures, dietVote } = evidenceToArticleFacts(evidence);
      const [internationalReportExcerpts, pollingExcerpts] = evidence
        ? await Promise.all([
            fetchReportExcerpts(internationalNewsSources(evidence)),
            fetchReportExcerpts(pollingNewsSources(evidence)),
          ])
        : [[], []];

      const { article, verified, unresolvedClaims } = await generateVerifiedArticle({
        issueTitle: issue.title,
        isReported,
        sources,
        primaryExcerpts,
        reportExcerpts,
        internationalReportExcerpts,
        pollingExcerpts,
        dietSpeeches,
        background,
        laws,
        estatStats,
        estatFigures,
        dietVote,
      });

      // 機械チェック1: 主張の裏取り（Writer=GPT-5とは独立のnano照合）が最終試行後も不合格ならHELD
      if (!verified) {
        // 2026-07-16: 事実検証失敗とスタイル要件不足を区別する（詳細はpromote.tsの同種修正を参照）
        const prefix = hasFactualClaimIssue(unresolvedClaims) ? "unverified_claim" : "style_gate";
        const reasons = unresolvedClaims.map((c) => `${c.text}(${c.reason})`).join(" / ");
        console.warn(`  ⚠️ 主張の裏取り不合格「${reasons}」→ 公開せずHELD`);
        if (candidate) {
          await prisma.topicCandidate.update({
            where: { id: candidate.id },
            data: { status: "HELD", decision: `${candidate.decision} / ${prefix}:${reasons.slice(0, 200)}` },
          });
        }
        continue;
      }

      // 機械チェック2: 断定表現が混入していたら公開しない
      const banned = violatesBan(article);
      if (banned) {
        console.warn(`  ⚠️ 断定表現検出「${banned}」→ 公開せずHELD`);
        if (candidate) {
          await prisma.topicCandidate.update({
            where: { id: candidate.id },
            data: { status: "HELD", decision: `${candidate.decision} / banned_phrase:${banned}` },
          });
        }
        continue;
      }

      await prisma.$transaction([
        prisma.issue.update({
          where: { id: issue.id },
          data: {
            summaryJson: {
              lead: article.lead,
              bullets: article.bullets,
              sources: sources.slice(0, 5).map((s) => ({
                label: `${s.title.slice(0, 40)}（${s.feed}）`,
                url: s.url,
              })),
            } as unknown as Prisma.InputJsonValue,
            articleHtml: article.articleHtml,
            articleGeneratedAt: new Date(),
          },
        }),
        prisma.issueTimeline.create({
          data: { issueId: issue.id, label: "現時点まとめを公開（GPT-5生成・見出しベース）" },
        }),
      ]);
      await notifyRevalidate(issue.slug, issue.id);
      console.log(`  ✅ /issues/${issue.slug} のまとめ公開`);
    } catch (e) {
      console.error(`  ❌ 生成失敗: ${e}`);
      await notifyRadarFailure(`GPT-5要約生成失敗: ${issue.title}`, e);
    }
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await notifyRadarFailure("summarize.ts 致命的エラー（ジョブ全体が停止）", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
