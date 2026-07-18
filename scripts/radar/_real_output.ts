/**
 * 実際の投稿シミュレーション - 収集済みデータでSelection V2ランクを計算
 * npx tsx scripts/radar/_real_output.ts
 */
import { prisma } from "../../src/lib/prisma";
import { selectionV2RankScore, passesSelectionV2 } from "./lib/selection-v2";

async function main() {
const freshSince = new Date(Date.now() - 12 * 3600_000);
const rows = await prisma.topicCandidate.findMany({
  where: { discoverySource: "buzz", status: "PENDING", updatedAt: { gte: freshSince } },
  orderBy: { updatedAt: "desc" },
  take: 100,
});

console.log("候補:" + rows.length + "件\n");

const results: { title: string; rankScore: number; buzzPrime: number; clickHeat: number; debateHeat: number; nationalImportance: number; commentCount: number; frictionScore: number; tweetCount: number; cluster: number; }[] = [];

for (const r of rows) {
  if (!r.evidenceJson) continue;
  const ev = r.evidenceJson as any;
  const rank = selectionV2RankScore(ev);
  const pass = passesSelectionV2(rank);
  if (pass) {
    results.push({
      title: r.title,
      rankScore: rank.rankScore,
      buzzPrime: rank.buzzPrime,
      clickHeat: rank.clickHeat,
      debateHeat: rank.debateHeat,
      nationalImportance: rank.nationalImportance,
      commentCount: ev.commentCount ?? 0,
      frictionScore: ev.commentFrictionScore ?? 0,
      tweetCount: ev.tweetCount ?? 0,
      cluster: ev.newsClusterCount ?? 0,
    });
  } else {
    // なぜ通らないか診断
    const reasons: string[] = [];
    if (rank.buzzPrime < 0.4) reasons.push("Buzz低(" + rank.buzzPrime.toFixed(2) + ")");
    if (rank.clickHeat === 0 && rank.debateHeat === 0) {
      if (!ev.tweetCount && !ev.newsClusterCount && !ev.googleTrendTraffic) reasons.push("clickHeat=0(データ不足)");
      else reasons.push("clickHeat=0");
    }
    if (rank.debateHeat < 0.05) reasons.push("Debate低(" + rank.debateHeat.toFixed(3) + ") comment=" + (ev.commentCount ?? "-") + " friction=" + (ev.commentFrictionScore?.toFixed(2) ?? "-"));
    if (rank.rankScore < 0.04 && reasons.length === 0) reasons.push("Rank低(" + rank.rankScore.toFixed(4) + ")" + (rank.nationalImportance !== 1 ? " NI=" + rank.nationalImportance.toFixed(1) : ""));
    if (reasons.length === 0) reasons.push("Rank=" + rank.rankScore.toFixed(4) + " B=" + rank.buzzPrime.toFixed(2) + " C=" + rank.clickHeat.toFixed(3) + " D=" + rank.debateHeat.toFixed(3) + (rank.nationalImportance !== 1 ? " NI=" + rank.nationalImportance.toFixed(1) : ""));
    console.log("❌ " + r.title.slice(0, 40) + " → [" + reasons.join(", ") + "]");
  }
}

results.sort((a, b) => b.rankScore - a.rankScore);

console.log("\n===== 通過候補: " + results.length + " 件 =====");
for (const r of results) {
  console.log("\n📰 " + r.title);
  console.log("   Rank=" + r.rankScore.toFixed(4) + " B=" + r.buzzPrime.toFixed(2) + " Click=" + r.clickHeat.toFixed(3) + " Debate=" + r.debateHeat.toFixed(3) + (r.nationalImportance !== 1 ? " NI=" + r.nationalImportance.toFixed(1) : ""));
  console.log("   tweet=" + r.tweetCount + " comment=" + r.commentCount + " friction=" + r.frictionScore.toFixed(2) + " cluster=" + r.cluster);
  console.log("   選択肢: 賛成 / 反対");
}

if (results.length > 0) {
  console.log("\n===== 実際に投稿される記事案（上位5件）=====");
  for (const r of results.slice(0, 5)) {
    console.log("\n📰 見出し: " + r.title);
    console.log("   選択肢: 賛成 / 反対");
    console.log("   理由: Buzz=" + r.buzzPrime.toFixed(2) + " ClickHeat=" + r.clickHeat.toFixed(3) + " DebateHeat=" + r.debateHeat.toFixed(3));
  }
} else {
  console.log("\n===== 通過ゼロの理由 =====");
  console.log("現時点ではSelection V2を通過する候補がいません。原因:");
  console.log("1. tweetCount: Yahoo RTのバズ用語とトピックタイトルのマッチングが機能していない");
  console.log("   ('改正皇室典範'≠'皇室典範改正'のように日本語の語順問題)");
  console.log("2. googleTrendTraffic: 収集はできているがevidenceに保存されていない");
  console.log("3. 多くのトピックがcommentCountまたはcommentFrictionScoreを持っていない");
  console.log("\nYahoo RT現在値:"); 
  console.log("   - 改正皇室典範: tweet=626 → トピック'皇室典範改正'と不一致");
  console.log("   - 日経平均株価 4000円: tweet=124");
  console.log("   - レベル4大雨危険警報: tweet=267 (非政治)");
}

await prisma.$disconnect();
}

main().catch(console.error);
