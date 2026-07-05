/**
 * FactBase Radar — 続報反映（articleHtml再生成 + タイムライン追記）。
 *
 * 実行: npx tsx scripts/radar/followup.ts （detect.ts → summarize.ts の後、同cron内3本目）
 * 対象: detect.ts が match_issue_id でSourceEventを紐付け済みの、公開済み・記事生成済みIssue。
 * 頻度制御は src/lib/radar.ts の shouldRegenerateFollowUp（純関数）に集約:
 *   - LIVE(REPORTED): 新着distinctFeed>=1件で最短30分間隔
 *   - OFFICIAL: 新着に一次情報級(trustWeight>=85)があり最短2時間間隔
 * 1日の再生成上限は初回生成（ARTICLE_DAILY_ARTICLE_LIMIT）とは別枠（FOLLOWUP_DAILY_LIMIT）。
 */
import { PrismaClient, type Prisma, type ConfirmationStatus } from "@prisma/client";
import { RADAR } from "../../src/lib/constants";
import { shouldRegenerateFollowUp } from "../../src/lib/radar";
import { generateArticle, violatesBan } from "../../src/lib/radar-article";
import { fetchPrimaryExcerpts } from "./lib/primary-text";
import { notifyRadarFailure } from "./notify";
import { notifyRevalidate } from "./lib/notify-revalidate";

const prisma = new PrismaClient();

interface CandidateRow {
  id: string;
  slug: string;
  title: string;
  confirmation: ConfirmationStatus;
  articleGeneratedAt: Date;
  newEventCount: bigint;
  newDistinctFeeds: bigint;
  maxNewTrustWeight: number;
}

const FOLLOW_UP_LABEL_PREFIX = "続報反映:";

async function main() {
  const dailyLimit = Number(process.env.FOLLOWUP_DAILY_LIMIT ?? RADAR.followUpDailyLimit);
  const todayStart = new Date(new Date().toISOString().slice(0, 10));
  const generatedToday = await prisma.issueTimeline.count({
    where: { label: { startsWith: FOLLOW_UP_LABEL_PREFIX }, at: { gte: todayStart } },
  });
  if (generatedToday >= dailyLimit) {
    console.log(`本日の続報反映上限（${dailyLimit}）に到達済み — skip`);
    return;
  }

  // 続報SourceEventが1件以上ある、公開済み・記事生成済み・監視期限内のIssueを集計
  const rows = await prisma.$queryRaw<CandidateRow[]>`
    SELECT i.id, i.slug, i.title, i.confirmation, i."articleGeneratedAt",
      COUNT(se.id) AS "newEventCount",
      COUNT(DISTINCT se."feedName") AS "newDistinctFeeds",
      COALESCE(MAX(se."trustWeight"), 0) AS "maxNewTrustWeight"
    FROM "Issue" i
    JOIN "SourceEvent" se ON se."issueId" = i.id AND se."createdAt" > i."articleGeneratedAt"
    WHERE i.confirmation IN ('OFFICIAL', 'REPORTED')
      AND i."articleHtml" IS NOT NULL
      AND i."monitoringUntil" > NOW()
    GROUP BY i.id
    HAVING COUNT(se.id) > 0
  `;

  const now = new Date();
  const eligible = rows.filter((r) =>
    shouldRegenerateFollowUp(
      {
        confirmation: r.confirmation as "OFFICIAL" | "REPORTED",
        articleGeneratedAt: r.articleGeneratedAt,
        newEventCount: Number(r.newEventCount),
        newDistinctFeeds: Number(r.newDistinctFeeds),
        maxNewTrustWeight: Number(r.maxNewTrustWeight),
      },
      now,
    ),
  );

  // LIVE(REPORTED)を優先、同種内は記事が古いものから
  eligible.sort((a, b) => {
    if (a.confirmation !== b.confirmation) return a.confirmation === "REPORTED" ? -1 : 1;
    return a.articleGeneratedAt.getTime() - b.articleGeneratedAt.getTime();
  });

  const targets = eligible.slice(0, dailyLimit - generatedToday);
  if (targets.length === 0) {
    console.log("続報反映対象なし");
    return;
  }
  console.log(`続報反映対象: ${targets.length}件`);

  for (const row of targets) {
    try {
      const issue = await prisma.issue.findUnique({ where: { id: row.id } });
      if (!issue || !issue.articleHtml || !issue.articleGeneratedAt) continue;

      const candidate = await prisma.topicCandidate.findUnique({ where: { issueId: issue.id } });
      const baseSources = (candidate?.sourceUrls as { title: string; url: string; feed: string }[]) ?? [];
      const newEvents = await prisma.sourceEvent.findMany({
        where: { issueId: issue.id, createdAt: { gt: issue.articleGeneratedAt } },
        orderBy: { createdAt: "asc" },
      });
      const cumulativeSources = [
        ...baseSources,
        ...newEvents.map((e) => ({ title: e.title, url: e.url, feed: e.feedName })),
      ].slice(-RADAR.sourceCap);

      const summaryJson = issue.summaryJson as { lead?: string } | null;
      console.log(`続報反映中: ${issue.title}（新着${newEvents.length}件）`);

      // OFFICIAL争点の続報には新着イベント分の公式ページ本文だけを渡す（既報分は前回記事に反映済み）
      const primaryExcerpts =
        issue.confirmation === "REPORTED"
          ? []
          : await fetchPrimaryExcerpts(
              newEvents.map((e) => ({ title: e.title, url: e.url, feed: e.feedName })),
            );
      const article = await generateArticle({
        issueTitle: issue.title,
        isReported: issue.confirmation === "REPORTED",
        sources: cumulativeSources,
        primaryExcerpts,
        previousArticle: { lead: summaryJson?.lead ?? "", articleHtml: issue.articleHtml },
      });

      const banned = violatesBan(article);
      if (banned) {
        console.warn(`  ⚠️ 断定表現検出「${banned}」→ 更新せず既存記事を維持`);
        continue;
      }

      await prisma.$transaction([
        prisma.issue.update({
          where: { id: issue.id },
          data: {
            summaryJson: {
              lead: article.lead,
              bullets: article.bullets,
              sources: cumulativeSources.slice(-5).map((s) => ({
                label: `${s.title.slice(0, 40)}（${s.feed}）`,
                url: s.url,
              })),
            } as unknown as Prisma.InputJsonValue,
            articleHtml: article.articleHtml,
            articleGeneratedAt: new Date(),
          },
        }),
        prisma.issueTimeline.create({
          data: {
            issueId: issue.id,
            label: `${FOLLOW_UP_LABEL_PREFIX} ${(article.followUpNote || "新着情報を反映しました").slice(0, 60)}`,
          },
        }),
      ]);
      await notifyRevalidate(issue.slug, issue.id);
      console.log(`  ✅ /issues/${issue.slug} を続報反映で更新`);
    } catch (e) {
      console.error(`  ❌ 続報反映失敗: ${e}`);
      await notifyRadarFailure(`続報反映失敗: ${row.title}`, e);
    }
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await notifyRadarFailure("followup.ts 致命的エラー（ジョブ全体が停止）", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
