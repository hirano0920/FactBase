/**
 * ライブバズシミュレーション v3 - 正しいフィールド名で
 * npx tsx scripts/radar/_live_sim2.ts
 */
import { fetchTrendingKeywords, fetchTrendingItems } from "./sources/trends";
import { fetchYahooRealtimeBuzzPolitics } from "./sources/yahoo-realtime";
import { fetchYahooNewsRankingTitles } from "./sources/yahoo-news-ranking";
import { fetchYouTubeTrendingTitles } from "./sources/youtube-trending";
import { fetchTVNewsTitles } from "./sources/tv-news";
import { assembleBuzzScore } from "../../src/lib/buzz-cross-match";
import { selectionV2RankScore, passesSelectionV2 } from "./lib/selection-v2";
import type { BuzzSourceInputs } from "../../src/lib/radar";

async function main() {
console.log("=== LIVE BUZZ DATA ===");

const [trendKw, trendItems] = await Promise.all([
  fetchTrendingKeywords().catch(() => [] as string[]),
  fetchTrendingItems().catch(() => [] as any[]),
]);
const newsTitles = await fetchYahooNewsRankingTitles().catch(() => [] as string[]);
const yahooRT = await fetchYahooRealtimeBuzzPolitics().catch(() => [] as any[]);
const yt = await fetchYouTubeTrendingTitles().catch(() => ({ organic: [] as any[], all: [] as any[] }));
const tv = await fetchTVNewsTitles().catch(() => [] as string[]);

// Google Trends: keyword strings directly
const googleTerms = trendKw.filter(Boolean);

// Yahoo RT: .term field
const yahooRealtimeTerms = (yahooRT ?? []).map((r: any) => r.term).filter(Boolean);

console.log("Google Trends:", googleTerms.length);
console.log("Yahoo RT:", yahooRealtimeTerms.length);
console.log("Yahoo News:", newsTitles.length);
console.log("YouTube:", (yt?.organic ?? []).length);
console.log("TV:", tv.length);

const inputs: BuzzSourceInputs = {
  googleTerms,
  yahooRealtimeTerms,
  newsRankingTitles: newsTitles ?? [],
  youtubeTrendingTitles: (yt?.organic ?? []).map((e: any) => String(e.title ?? "")).filter(Boolean),
  tvNewsTitles: tv ?? [],
};

interface R {
  title: string;
  buzzEff: number; tweetCount: number;
  buzzPrime: number; clickHeat: number; debateHeat: number;
  rankScore: number; sources: string;
}

const results: R[] = [];
const seen = new Set<string>();

function tryTopic(title: string, tweetCount: number) {
  if (!title || seen.has(title)) return;
  seen.add(title);
  const buzzHit = assembleBuzzScore(title, inputs);
  const rank = selectionV2RankScore({
    buzzScore: buzzHit.effectiveScore,
    topic: title,
    tweetCount: tweetCount ?? 0,
    googleTrendTraffic: buzzHit.maxTrendTraffic,
    newsClusterCount: buzzHit.newsClusterCount,
  });
  if (passesSelectionV2(rank)) {
    results.push({
      title, tweetCount: tweetCount ?? 0,
      buzzEff: buzzHit.effectiveScore,
      sources: `${buzzHit.inGoogleTrends?"G":""}${buzzHit.inYahooRealtime?"R":""}${buzzHit.inNewsRanking?"N":""}${buzzHit.inYouTubeTrending?"Y":""}${buzzHit.inTVNews?"T":""}`,
      buzzPrime: rank.buzzPrime, clickHeat: rank.clickHeat, debateHeat: rank.debateHeat, rankScore: rank.rankScore,
    });
  }
}

// News topics
for (const n of newsTitles.slice(0, 50)) tryTopic(n, 0);

// Trends
for (const kw of trendKw) tryTopic(kw, 0);

// Yahoo RT
for (const r of yahooRT ?? []) tryTopic(r.term, r.tweetCount ?? 0);

results.sort((a, b) => b.rankScore - a.rankScore);

console.log("\n通過: " + results.length + " 件");
console.log("\n【通過候補一覧】");
for (const r of results.slice(0, 20)) {
  console.log("  Rank=" + r.rankScore.toFixed(4) + " B=" + r.buzzEff + "(" + r.buzzPrime.toFixed(2) + ") C=" + r.clickHeat.toFixed(3) + " D=" + r.debateHeat.toFixed(3) + " 出典:" + r.sources);
  console.log("    " + r.title);
  if (r.tweetCount > 0) console.log("    tweet=" + r.tweetCount);
}

// 投稿記事案
console.log("\n\n===== 実際に投稿される記事案 =====");
for (const r of results.slice(0, 5)) {
  console.log("\n📰 見出し: " + r.title);
  console.log("   選択肢: 賛成 / 反対");
  console.log("   Rank: " + r.rankScore.toFixed(4) + " B=" + r.buzzEff + " C=" + r.clickHeat.toFixed(3) + " D=" + r.debateHeat.toFixed(3));
  console.log("   出典: " + r.sources);
}

// 通過なしの場合のフォールバック説明
if (results.length === 0) {
  console.log("\n【現在PASSする候補がありません】");
  console.log("理由: 現時点では十分なバズデータが収集できていません。");
  console.log("Google Trends:" + googleTerms.length + "件 Yahoo RT:" + yahooRealtimeTerms.length + "件 News:" + newsTitles.length + "件");
  console.log("\n最新のニュースランキングから直接候補:");
  for (const n of newsTitles.slice(0, 5)) {
    console.log("  - " + n.slice(0, 60));
  }
}
}

main().catch(console.error);
