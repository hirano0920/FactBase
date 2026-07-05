/**
 * FactBase Radar — Level 2「現時点まとめ」をGPT-5で生成（速報公開の10〜30分後）。
 *
 * 実行: npx tsx scripts/radar/summarize.ts
 * 記事生成そのものの安全設計（プロンプト・断定表現チェック）は src/lib/radar-article.ts を参照。
 * 続報が来た後の再生成は scripts/radar/followup.ts が別枠の日次上限で担当する。
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { RADAR } from "../../src/lib/constants";
import { generateArticle, violatesBan } from "../../src/lib/radar-article";
import { fetchPrimaryExcerpts } from "./lib/primary-text";
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
    where: { articleGeneratedAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
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
    });
    const sources = (candidate?.sourceUrls as { title: string; url: string; feed: string }[]) ?? [];
    if (sources.length === 0) continue;

    const isReported = issue.confirmation === "REPORTED";

    console.log(`生成中: ${issue.title}`);
    try {
      // OFFICIAL争点は公式ページ本文の抜粋を渡し「何が変わる」を実質のある内容で書かせる
      const primaryExcerpts = isReported ? [] : await fetchPrimaryExcerpts(sources);
      const article = await generateArticle({
        issueTitle: issue.title,
        isReported,
        sources,
        primaryExcerpts,
      });

      // 機械チェック: 断定表現が混入していたら公開しない
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
