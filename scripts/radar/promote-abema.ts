/**
 * 討論系チャンネル（ABEMA Prime/ReHacQ/NewsPicks/PIVOT）の日次discover分を公開する
 * 独立エントリポイント（discoverySource名"abema_prime"は単一チャンネル時代の名残、
 * discover-abema.ts側のコメント参照）。
 * News(20)/Debate(5)の共通バズパイプライン（promote.ts、discoverySource="buzz"）とは
 * 完全に別枠・別予算（RADAR.abemaPrimeDailyPublishCap）で動く。
 * 番組側の編集判断＋discover段階のしきい値（再生数/伸び速度）とGeminiのexclude判定を
 * 信頼し、SNSバズ向けのキーワード/熱量ランキングは適用せず、PENDING候補を古い順にそのまま
 * 記事化を試みる（researchCandidate/writeAndPublishはpromote.tsのものをそのまま再利用）。
 *
 * 実行: npx tsx scripts/radar/promote-abema.ts [--dry-run]
 */
import { prisma } from "../../src/lib/prisma";
import { RADAR } from "../../src/lib/constants";
import { jstDayStart } from "../../src/lib/radar";
import type { SavedEvidence } from "./lib/promote-logic";
import type { PromotionCandidate } from "./lib/promote-logic";
import { researchCandidate, writeAndPublish, logHeldSummary } from "./promote";

const DRY_RUN = process.argv.includes("--dry-run");

async function countTodayAbemaPublished(): Promise<number> {
  return prisma.topicCandidate.count({
    where: {
      discoverySource: "abema_prime",
      status: "PUBLISHED",
      updatedAt: { gte: jstDayStart() },
    },
  });
}

async function main() {
  console.log(`📺 promote-abema 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);

  const todayCount = await countTodayAbemaPublished();
  const remaining = RADAR.abemaPrimeDailyPublishCap - todayCount;
  console.log(`  本日${todayCount}本済 / 上限${RADAR.abemaPrimeDailyPublishCap}本 → 残枠${Math.max(0, remaining)}本`);
  if (remaining <= 0) {
    console.log("  本日の上限に達しているためスキップ");
    return;
  }

  const rows = await prisma.topicCandidate.findMany({
    where: {
      discoverySource: "abema_prime",
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
        console.log(`  📝 [dry-run] ${c.title}（${researched.track === "news" ? "News" : "Debate"}）`);
        published++;
        continue;
      }
      const issueId = await writeAndPublish(researched);
      if (issueId) published++;
    } catch (e) {
      console.error(`  ❌ 失敗: ${c.title} (${e})`);
    }
  }

  logHeldSummary();
  console.log(`\n📺 promote-abema 完了: ${published}本公開`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
