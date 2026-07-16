/**
 * バズ経路が PENDING を作れない理由の診断。
 * npx tsx scripts/radar/diagnose-buzz.ts
 */
import { prisma } from "../../src/lib/prisma";
import { fetchTrendingKeywords } from "./sources/trends";
import { fetchYahooRealtimeBuzzPolitics } from "./sources/yahoo-realtime";
import { fetchYahooNewsRankingTitles } from "./sources/yahoo-news-ranking";
import { fetchYouTubeTrendingTitles } from "./sources/youtube-trending";
import { filterRelevantTopics } from "../../src/lib/ai";
import { prefilterBuzzInputs, type BuzzTermInput } from "../../src/lib/buzz-prefilter";
import { buildBuzzAnchorCandidates } from "../../src/lib/buzz-cross-match";
import { computeBuzzScore, buzzSourceLabels, buzzEffectiveScore } from "../../src/lib/radar";
import { isWithinPeakWindow } from "./lib/schedule";
import { RADAR } from "../../src/lib/constants";

async function main() {
  const now = new Date();
  const inWindow = isWithinPeakWindow(now, RADAR.discoverWindowsJst, RADAR.discoverWindowToleranceMin);

  const [google, yahoo, news, buzzEver, pendingBuzz, pendingBill] = await Promise.all([
    fetchTrendingKeywords(),
    fetchYahooRealtimeBuzzPolitics(),
    fetchYahooNewsRankingTitles(),
    prisma.topicCandidate.count({ where: { discoverySource: "buzz" } }),
    prisma.topicCandidate.count({ where: { discoverySource: "buzz", status: "PENDING" } }),
    prisma.topicCandidate.count({ where: { discoverySource: "bill", status: "PENDING" } }),
  ]);
  const ytTrending = await fetchYouTubeTrendingTitles(news);
  const yt = ytTrending.all.map((e) => e.title);

  console.log("=== DB ===");
  console.log(`  buzz候補（累計）: ${buzzEver}件 / PENDING buzz: ${pendingBuzz} / PENDING bill: ${pendingBill}`);
  console.log(`  discover時間帯（今）: ${inWindow ? "YES" : "NO"} JST ${now.toISOString()}`);

  const yahooTerms = yahoo.map((b) => b.term);
  const rawInputs: BuzzTermInput[] = [
    ...google.map((term) => ({ term, source: "trends" as const })),
    ...yahoo.map((b) => ({ term: b.term, source: "yahoo_rt" as const, genre: b.genre })),
    ...news.map((term) => ({ term, source: "yahoo_news" as const })),
    ...yt.map((term) => ({ term, source: "youtube" as const })),
  ];
  const filtered = prefilterBuzzInputs(rawInputs);
  const inputs = {
    googleTerms: google,
    yahooRealtimeTerms: yahooTerms,
    newsRankingTitles: news,
    // 横断スコアは自己参照を避けるためorganicのみ（[[youtube-trending-circularity-fix]]参照）
    youtubeTrendingTitles: ytTrending.organic.map((e) => e.title),
  };
  const anchors = buildBuzzAnchorCandidates(filtered, inputs);
  const buzzTerms = [...new Set(filtered.map((i) => i.term.trim()).filter(Boolean))].sort((a, b) => {
    const scoreOf = (term: string) =>
      anchors.find((c) => c.anchor === term || c.variants.includes(term) || term.includes(c.anchor))?.score ??
      computeBuzzScore(term, inputs).effectiveScore;
    return scoreOf(b) - scoreOf(a) || a.localeCompare(b, "ja");
  });

  console.log(`\n=== ① 4ソース収集 ===`);
  console.log(`  生: Trends ${google.length} / Yahoo ${yahoo.length} / News ${news.length} / YouTube ${yt.length} = ${rawInputs.length}語`);
  console.log(`  政治圏プリフィルタ後: ${filtered.length}語（nano候補${buzzTerms.length}）・横断アンカー≥2: ${anchors.filter((c) => c.score >= 2).length}件`);

  const scored = anchors
    .map((c) => ({
      term: c.anchor,
      score: c.score,
      sources: buzzSourceLabels(c.hit),
      inputCount: c.inputCount,
    }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term, "ja"));

  console.log("\n  buzzScore 上位10（nano前・アンカー語）:");
  for (const s of scored.slice(0, 10)) {
    console.log(`    ${s.score}/4 (${s.inputCount}語) ${s.term.slice(0, 55)} [${s.sources.join(",")}]`);
  }

  const score2plus = scored.filter((s) => s.score >= 2);
  console.log(`\n  buzzScore≥2: ${score2plus.length}アンカー`);

  console.log(`\n=== ② mini 関連性判定（最大${RADAR.topicFilterMaxTerms}語）…`);
  let relevant: Awaited<ReturnType<typeof filterRelevantTopics>> = [];
  try {
    relevant = await filterRelevantTopics(buzzTerms.map((term) => ({ term })));
  } catch (e) {
    console.log(`  ❌ nano失敗: ${e}`);
    return;
  }

  console.log(`  → 争点として通過: ${relevant.length}件`);
  if (relevant.length === 0) {
    console.log("\n  ⚠️ ここで全滅していると discover は buzz の PENDING を1件も作れません。");
    console.log("     （今のトレンドがW杯・芸能中心だとよく起きます）");
  } else {
    for (const r of relevant) {
      const hit = computeBuzzScore(r.topic, inputs);
      console.log(`    [${r.category}] buzz=${buzzEffectiveScore(hit)}(raw${hit.score}) ${r.topic} — ${r.reason}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
