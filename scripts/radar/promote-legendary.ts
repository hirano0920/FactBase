/**
 * 伝説級バズり動画（discover-legendary.ts投入分）を常設Debateとして公開するエントリポイント。
 * promote-abema.tsと同じ「番組側の編集判断＋しきい値＋Gemini判定を信頼して古い順に記事化」方式だが、
 * こちらは公開後にIssue.isStanding=trueを立てる（歴代トップ再生＝旬に依存しない定番争点のため、
 * 通常のDebateのように数日で沈ませず常設枠として上部に固定表示する）。
 *
 * 実行: npx tsx scripts/radar/promote-legendary.ts [--dry-run]
 */
import { prisma } from "../../src/lib/prisma";
import { RADAR } from "../../src/lib/constants";
import { jstDayStart } from "../../src/lib/radar";
import type { SavedEvidence } from "./lib/promote-logic";
import type { PromotionCandidate } from "./lib/promote-logic";
import { researchCandidate, writeAndPublish, logHeldSummary } from "./promote";

const DRY_RUN = process.argv.includes("--dry-run");

async function countTodayLegendaryPublished(): Promise<number> {
  return prisma.topicCandidate.count({
    where: {
      discoverySource: "legendary_video",
      status: "PUBLISHED",
      updatedAt: { gte: jstDayStart() },
    },
  });
}

async function main() {
  console.log(`🏆 promote-legendary 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);

  const todayCount = await countTodayLegendaryPublished();
  const remaining = RADAR.legendaryDailyPublishCap - todayCount;
  console.log(`  本日${todayCount}本済 / 上限${RADAR.legendaryDailyPublishCap}本 → 残枠${Math.max(0, remaining)}本`);
  if (remaining <= 0) {
    console.log("  本日の上限に達しているためスキップ");
    return;
  }

  const rows = await prisma.topicCandidate.findMany({
    where: {
      discoverySource: "legendary_video",
      status: "PENDING",
      issueId: null,
      evidenceJson: { not: undefined },
    },
    orderBy: { createdAt: "asc" },
    take: remaining * 3, // HELDになる分の余裕を持って多めに取る
  });

  console.log(`  PENDING候補 ${rows.length}件（残枠${remaining}本まで公開を試みる）`);

  const candidates: PromotionCandidate[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    topicTerm: r.topicTerm,
    sourceUrls:
      (r.sourceUrls as unknown as { title: string; url: string; feed: string; publishedAt?: string }[]) ?? [],
    evidence: r.evidenceJson as unknown as SavedEvidence,
    updatedAt: r.updatedAt,
  }));

  let published = 0;
  for (const c of candidates) {
    if (published >= remaining) break;
    try {
      const researched = await researchCandidate(c);
      if (!researched) continue; // HELD済み（researchCandidate内でDB更新済み）
      if (DRY_RUN) {
        console.log(`  📝 [dry-run] ${c.title}（常設Debate）`);
        published++;
        continue;
      }
      const issueId = await writeAndPublish(researched);
      if (!issueId) continue;
      // 常設Debate化。writeAndPublish内のIssue作成には手を入れず、公開直後に立てる
      await prisma.issue.update({ where: { id: issueId }, data: { isStanding: true } });
      published++;
    } catch (e) {
      console.error(`  ❌ 失敗: ${c.title} (${e})`);
    }
  }

  logHeldSummary();
  console.log(`\n🏆 promote-legendary 完了: ${published}本公開`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
