/**
 * FactBase Radar バズ駆動記事の公開（④ 選定・公開ロジック）。
 *
 * 実行: npx tsx scripts/radar/promote.ts [--dry-run] [--force]
 * cron内で discover.ts の後に走る。discover.ts が集めた PENDING 候補（discoverySource="buzz"）を
 * ピーク時間帯（通勤・昼休み・夜）にだけ、buzzScore（クロス照合の強さ）と証拠十分性でtop2〜3本を
 * 選んで記事化する。法案（discoverySource="bill"）は既存detect.tsが継続的に公開するため対象外。
 * 戦争・災害・重大法案可決のような速報は既存detect.tsのLIVE経路（isBreakingNews）が別途即時処理する
 * ——本スクリプトはその安全網の外側で「バズだが急ぎではない」記事だけを扱う。
 *
 * 選定基準（両方満たすことを要求。どちらかだけでは薄い記事に戻るため）:
 *   - buzzScore >= minBuzzScoreForPromotion（4ソースのクロス照合。片方だけの弱いシグナルを弾く）
 *   - evaluateEvidenceSufficiency().sufficient（一次情報・複数媒体報道・背景解説等、
 *     記事に実質のある内容を書ける材料が揃っているか）
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { RADAR } from "../../src/lib/constants";
import { toIssueCategory, jstDateString } from "../../src/lib/radar";
import { generateVerifiedArticle, violatesBan } from "../../src/lib/radar-article";
import { fetchPrimaryExcerpts } from "./lib/primary-text";
import { fetchReportExcerpts } from "./lib/report-text";
import { pollingNewsSources } from "./lib/enrich";
import {
  selectTopicsForPromotion,
  findDuplicateActiveIssue,
  type SavedEvidence,
  type PromotionCandidate,
  type ActiveIssueForDedup,
} from "./lib/promote-logic";
import { isWithinPeakWindow } from "./lib/schedule";
import { notifyRadarFailure } from "./notify";
import { notifyRevalidate } from "./lib/notify-revalidate";
import { linkBuzzSourcesToIssue } from "./lib/link-buzz-sources";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force"); // ピーク時間帯チェックを無視（動作確認用）

/**
 * これより古いPENDING候補は選定対象にしない。
 * buzzScoreは「調査した瞬間にどれだけバズっていたか」のスナップショットで、
 * トピックがトレンドから消えても自動でゼロに巻き戻ることはない（discover.tsは
 * トレンドに再度載らない限りそのトピックを触らないため）。なので短すぎる鮮度切りは
 * 「その日のピーク3回すべてで他の強い話題に競り負けた良ネタ」を、翌朝には
 * 二度と選ばれないまま機械的に切り捨ててしまう。
 * 36時間＝「その日の残りのピーク＋翌朝のピーク」まで生存させることで、
 * 一時的に埋もれた良ネタにもう一度チャンスを与える。それより古い（何日も前に
 * 一度だけバズって以来放置されている）候補だけを弾く。
 */
const CANDIDATE_FRESHNESS_HOURS = 36;

async function main() {
  console.log(`📰 Radar promote 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);

  if (!FORCE && !isWithinPeakWindow(new Date(), RADAR.peakWindowsJst, RADAR.peakWindowToleranceMin)) {
    console.log("  ピーク時間帯外のためスキップ（--forceで無視可）");
    return;
  }

  const freshSince = new Date(Date.now() - CANDIDATE_FRESHNESS_HOURS * 60 * 60_000);
  const rows = await prisma.topicCandidate.findMany({
    where: {
      discoverySource: "buzz",
      status: "PENDING",
      issueId: null,
      evidenceJson: { not: Prisma.JsonNull },
      updatedAt: { gte: freshSince },
    },
    orderBy: { updatedAt: "desc" },
    take: 100, // buzzScore/sufficiencyで絞る前の母集団（鮮度内で広めに取る）
  });

  const candidates: PromotionCandidate[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    topicTerm: r.topicTerm,
    sourceUrls:
      (r.sourceUrls as unknown as { title: string; url: string; feed: string; publishedAt?: string }[]) ?? [],
    evidence: r.evidenceJson as unknown as SavedEvidence,
  }));

  const selected = selectTopicsForPromotion(
    candidates,
    RADAR.minBuzzScoreForPromotion,
    RADAR.buzzArticlesPerWindow,
    RADAR.maxSameCategoryPerPromoteWindow,
  );
  console.log(
    `  ${candidates.length}件のPENDING候補 → buzzScore>=${RADAR.minBuzzScoreForPromotion}かつ証拠十分で${selected.length}件選定`,
  );

  // detect.ts（RSS経路）とdiscover.ts（バズ経路）は別々のnanoプロンプトが独立にタイトルを
  // 生成するため、同じ出来事でもdedupKeyの文字列一致だけでは重複を防げないことがある。
  // 新規Issue作成前に、既存のアクティブなIssueと出来事として同一でないか機械的に再確認する。
  const activeIssues: ActiveIssueForDedup[] = await prisma.issue.findMany({
    where: {
      status: { in: ["ACTIVE", "TRENDING"] },
      confirmation: { in: ["OFFICIAL", "REPORTED"] },
      monitoringUntil: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: RADAR.followUpMaxActiveIssuesForMatch,
    select: { id: true, title: true, keywords: true },
  });

  for (const c of selected) {
    try {
      const duplicate = findDuplicateActiveIssue(c.title, c.topicTerm, activeIssues);
      if (duplicate) {
        await mergeIntoExistingIssue(c, duplicate);
      } else {
        await promoteOne(c);
      }
    } catch (e) {
      console.error(`  ❌ 記事化失敗: ${c.title} (${e})`);
      await notifyRadarFailure(`promote.ts: 記事化失敗 ${c.title}`, e);
    }
  }

  console.log("📰 Radar promote 完了");
}

/**
 * 既存のアクティブなIssueと同一出来事だと判定した場合、新規Issueは作らず
 * タイムラインに1行追記するだけに留める（記事本文の再生成はfollowup.tsの担当）。
 */
async function mergeIntoExistingIssue(c: PromotionCandidate, duplicate: ActiveIssueForDedup): Promise<void> {
  console.log(`  🔗 [重複回避] ${c.title} は既存Issue「${duplicate.title}」と同一出来事と判定 — 続報として統合`);
  if (DRY_RUN) return;

  await prisma.$transaction([
    prisma.topicCandidate.update({
      where: { id: c.id },
      data: { status: "PUBLISHED", issueId: duplicate.id, decision: `merged_into_existing_issue:${duplicate.id}` },
    }),
    prisma.issueTimeline.create({
      data: {
        issueId: duplicate.id,
        label: `バズ検知: 関連トピックとして検知（${c.title.slice(0, 60)}）`,
      },
    }),
  ]);
}

async function promoteOne(c: PromotionCandidate): Promise<void> {
  let isOfficial = c.evidence.officialEvents.length > 0 || c.evidence.laws.length > 0;
  const internationalSources = c.evidence.internationalNews.map((n) => ({
    title: n.title,
    url: n.url,
    feed: n.source || "international",
  }));

  let primaryExcerpts = isOfficial
    ? await fetchPrimaryExcerpts(
        c.evidence.officialEvents.map((o) => ({ title: o.title, url: o.url, feed: o.feed })),
      )
    : [];

  if (isOfficial && primaryExcerpts.length === 0) {
    console.warn(`  ⚠️ OFFICIAL判定だが一次本文なし → REPORTEDにフォールバック: ${c.title}`);
    isOfficial = false;
  }

  const [reportExcerpts, internationalReportExcerpts, pollingExcerpts] = await Promise.all([
    isOfficial ? Promise.resolve([]) : fetchReportExcerpts(c.sourceUrls),
    fetchReportExcerpts(internationalSources),
    fetchReportExcerpts(pollingNewsSources(c.evidence)),
  ]);

  const { article, verified, unresolvedClaims } = await generateVerifiedArticle({
    issueTitle: c.title,
    isReported: !isOfficial,
    sources: c.sourceUrls,
    primaryExcerpts,
    reportExcerpts,
    internationalReportExcerpts,
    pollingExcerpts,
    dietSpeeches: c.evidence.dietSpeeches,
    background: c.evidence.background,
    laws: c.evidence.laws,
    estatStats: c.evidence.estatStats,
  });

  if (!verified) {
    const reasons = unresolvedClaims.map((c2) => `${c2.text}(${c2.reason})`).join(" / ");
    console.warn(`  ⚠️ 主張の裏取り不合格「${reasons}」→ 公開せずHELD: ${c.title}`);
    await prisma.topicCandidate.update({
      where: { id: c.id },
      data: { status: "HELD", decision: `unverified_claim:${reasons.slice(0, 200)}` },
    });
    return;
  }

  const banned = violatesBan(article);
  if (banned) {
    console.warn(`  ⚠️ 断定表現検出「${banned}」→ 公開せずHELD: ${c.title}`);
    await prisma.topicCandidate.update({
      where: { id: c.id },
      data: { status: "HELD", decision: `banned_phrase:${banned}` },
    });
    return;
  }

  if (DRY_RUN) {
    console.log(
      `  📝 [dry-run] ${c.title}（buzzScore=${c.evidence.buzzScore} / ${isOfficial ? "OFFICIAL" : "REPORTED"}）`,
    );
    console.log(`     lead: ${article.lead}`);
    return;
  }

  const slug = `radar-buzz-${jstDateString()}-${randomUUID().slice(0, 8)}`;
  const choices = c.evidence.voteChoices ?? { for: "支持する", against: "支持しない", undecided: "わからない" };

  const issue = await prisma.issue.create({
    data: {
      slug,
      title: c.evidence.voteQuestion || c.title,
      category: toIssueCategory(c.category ?? ""),
      status: "TRENDING",
      confirmation: isOfficial ? "OFFICIAL" : "REPORTED",
      summaryJson: {
        lead: article.lead,
        bullets: article.bullets,
        sources: c.sourceUrls.slice(0, 5).map((s) => ({ label: `${s.title.slice(0, 40)}（${s.feed}）`, url: s.url })),
      } as unknown as Prisma.InputJsonValue,
      articleHtml: article.articleHtml,
      articleGeneratedAt: new Date(),
      voteLabelsJson: choices as unknown as Prisma.InputJsonValue,
      keywords: c.topicTerm ? [c.topicTerm] : [c.title],
      monitoringUntil: new Date(Date.now() + 60 * 86400_000),
    },
  });

  await prisma.$transaction([
    prisma.topicCandidate.update({
      where: { id: c.id },
      data: { status: "PUBLISHED", issueId: issue.id },
    }),
    prisma.issueTimeline.create({
      data: {
        issueId: issue.id,
        label: `バズ検知→一次情報調査を経て記事を公開（buzzScore=${c.evidence.buzzScore}）`,
      },
    }),
  ]);

  const linkSources = [
    ...c.sourceUrls,
    ...c.evidence.officialEvents.map((o) => ({ title: o.title, url: o.url, feed: o.feed })),
    ...c.evidence.news.map((n) => ({ title: n.title, url: n.url, feed: n.source || "google-news" })),
  ];
  const linked = await linkBuzzSourcesToIssue(prisma, issue.id, linkSources, c.topicTerm);
  if (linked.created + linked.linkedExisting > 0) {
    console.log(`  🔗 SourceEvent紐づけ: 新規${linked.created}・既存RSS${linked.linkedExisting}件`);
  }

  await notifyRevalidate(slug, issue.id);
  console.log(`  ✅ /issues/${slug} を公開（${isOfficial ? "OFFICIAL" : "REPORTED"}・buzzScore=${c.evidence.buzzScore}）`);
}

main()
  .catch(async (e) => {
    console.error(e);
    await notifyRadarFailure("promote.ts 致命的エラー（ジョブ全体が停止）", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
