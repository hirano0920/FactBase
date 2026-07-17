/**
 * 簡易：最新バズデータ収集 → 既存PENDING候補と横断一致 → ランク算出
 * npx tsx scripts/radar/_live_sim.ts
 */
import { prisma } from "../../src/lib/prisma";
import { RADAR } from "../../src/lib/constants";
import { fetchTrendingKeywords, fetchTrendingItems } from "./sources/trends";
import { fetchYahooRealtimeBuzzPolitics } from "./sources/yahoo-realtime";
import { fetchYahooNewsRankingTitles } from "./sources/yahoo-news-ranking";
import { fetchYouTubeTrendingTitles } from "./sources/youtube-trending";
import { fetchTVNewsTitles } from "./sources/tv-news";
import { assembleBuzzScore } from "../../src/lib/buzz-cross-match";
import { selectionV2RankScore, passesSelectionV2 } from "./lib/selection-v2";
import type { BuzzSourceInputs } from "../../src/lib/radar";

async function main() {
console.log("=== 最新バズデータ収集 ===");

console.log("① Google Trends...");
const [trendKeywords] = await Promise.all([
  fetchTrendingKeywords().catch((e: any) => { console.error("  Trends error:", e.message); return []; }),
]);
const googleTerms = [...trendKeywords.map((k: any) => k.title)];
console.log("   " + googleTerms.length + " 件");

console.log("② Yahoo!リアルタイム...");
const yahooRealtime = await fetchYahooRealtimeBuzzPolitics().catch((e: any) => { console.error("  Yahoo RT error:", e.message); return []; });
const yahooRealtimeTerms = yahooRealtime.map((r: any) => r.title);
console.log("   " + yahooRealtimeTerms.length + " 件");

console.log("③ Yahoo!ニュースランキング...");
const newsTitles = await fetchYahooNewsRankingTitles().catch((e: any) => { console.error("  News ranking error:", e.message); return []; });
console.log("   " + newsTitles.length + " 件");

const yt = await fetchYouTubeTrendingTitles().catch((e: any) => { console.error("  YouTube error:", e.message); return { organic: [], all: [] } as any; });
const ytTitles = (yt?.organic ?? []).map((e: any) => e.title).filter(Boolean);
console.log("④ YouTubeトレンド: " + ytTitles.length + " 件");

const tvTitles = (await fetchTVNewsTitles().catch((e: any) => { console.error("  TV error:", e.message); return []; })) ?? [];
console.log("⑤ テレビ報道: " + tvTitles.length + " 件");

const buzzInputs: BuzzSourceInputs = {
  googleTerms,
  yahooRealtimeTerms,
  newsRankingTitles: newsTitles,
  youtubeTrendingTitles: ytTitles,
  tvNewsTitles: tvTitles,
};

console.log("\n=== PENDING候補スコアリング ===");
const pending = await prisma.topicCandidate.findMany({
  where: { status: "PENDING" },
  orderBy: { updatedAt: "desc" },
});

interface R { id: string; title: string; b: number; bp: number; c: number; d: number; r: number; t: boolean; }
const results: R[] = [];

for (const cand of pending) {
  if (!cand.evidenceJson) continue;
  const buzzHit = assembleBuzzScore(cand.title, buzzInputs);
  const ev = cand.evidenceJson as Record<string, any>;
  
  const newsClusterCount = newsTitles.filter((n: string) => {
    const tokens = cand.title.split(/[、。\s]+/).filter(Boolean).map((t: string) => t.trim());
    return tokens.some((t: string) => t.length >= 3 && n.includes(t));
  }).length;

  const rank = selectionV2RankScore({
    buzzScore: buzzHit.effectiveScore,
    tweetCount: ev.tweetCount ?? 0,
    googleTrendTraffic: ev.googleTrendTraffic,
    newsClusterCount: Math.max(newsClusterCount, ev.newsClusterCount ?? 0),
    commentCount: ev.commentCount ?? 0,
    commentCountSurge: ev.commentCountSurge,
    commentFrictionScore: ev.commentFrictionScore,
    externalPoll: ev.externalPoll,
    youtubeCommentCount: ev.youtubeCommentCount,
    youtubeReplyCount: ev.youtubeReplyCount,
    youtubeLikeCount: ev.youtubeLikeCount,
  });

  if (passesSelectionV2(rank)) {
    results.push({
      id: cand.id, title: cand.title,
      b: buzzHit.effectiveScore, bp: rank.buzzPrime,
      c: rank.clickHeat, d: rank.debateHeat,
      r: rank.rankScore, t: rank.hasTweetCount,
    });
  }
}

results.sort((a, b) => b.r - a.r);

console.log("\n通過: " + results.length + " / " + pending.length + " 件");
console.log("\n【通過候補一覧（Rank降順）】");
for (const r of results.slice(0, 15)) {
  console.log("  #" + r.r.toFixed(4) + " B=" + r.b + "(" + r.bp.toFixed(2) + ") C=" + r.c.toFixed(3) + " D=" + r.d.toFixed(3) + " " + (r.t ? "" : "(tweet無)"));
  console.log("    " + r.title);
}

await prisma.$disconnect();
}

main().catch(console.error);
