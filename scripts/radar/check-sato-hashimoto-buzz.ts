/**
 * 一時: 佐藤二朗×橋本愛がライブバズに載るか確認
 * npx tsx scripts/radar/check-sato-hashimoto-buzz.ts
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
for (const name of [".env.local", ".env"]) {
  const path = resolve(root, name);
  if (!existsSync(path)) continue;
  try {
    process.loadEnvFile(path);
  } catch {
    /* ignore */
  }
}

import { fetchTrendingKeywords } from "./sources/trends";
import { fetchYahooRealtimeBuzzPolitics } from "./sources/yahoo-realtime";
import { fetchYahooNewsRankingTitles } from "./sources/yahoo-news-ranking";
import { fetchYouTubeTrendingTitles } from "./sources/youtube-trending";
import { assembleBuzzScore } from "../../src/lib/buzz-cross-match";
import { shouldKeepBuzzTerm } from "../../src/lib/buzz-prefilter";
import { filterRelevantTopics } from "../../src/lib/ai";
import { researchTopic, evaluateBuzzPromoteSufficiency } from "./lib/research";
import { prisma } from "../../src/lib/prisma";
import { RADAR } from "../../src/lib/constants";
import { fetchReportExcerpts } from "./lib/report-text";
import { generateVerifiedArticle } from "../../src/lib/radar-article";
import { shouldUseInternationalReports } from "../../src/lib/radar";

const KEYS = ["佐藤二朗", "橋本愛", "ハラスメント", "文春"];

async function main() {
  const [trendsRaw, yahooRt, news, yt] = await Promise.all([
    fetchTrendingKeywords(),
    fetchYahooRealtimeBuzzPolitics(),
    fetchYahooNewsRankingTitles(),
    fetchYouTubeTrendingTitles(),
  ]);
  const trends = trendsRaw.map((t) => (typeof t === "string" ? t : String(t)));

  console.log("=== source sizes ===", {
    trends: trends.length,
    yahooRt: yahooRt.length,
    news: news.length,
    yt: yt.length,
  });

  const show = (label: string, items: string[]) => {
    const found = items.filter((t) => KEYS.some((k) => t.includes(k)));
    console.log(`\n=== ${label} hits (${found.length}) ===`);
    for (const t of found.slice(0, 15)) console.log(" -", t.slice(0, 120));
    return found;
  };

  const trendHits = show("trends", trends);
  const rtHits = show(
    "yahooRt",
    yahooRt.map((t) => `${t.term}${t.genre ? ` [${t.genre}]` : ""}`),
  );
  const newsHits = show("news", news);
  const ytHits = show("youtube", yt);

  const sources = {
    googleTerms: trends,
    yahooRealtimeTerms: yahooRt.map((t) => t.term),
    newsRankingTitles: news,
    youtubeTrendingTitles: yt,
  };

  console.log("\n=== buzzScore ===");
  for (const a of ["佐藤二朗", "橋本愛", "佐藤二朗 ハラスメント", "佐藤二朗 橋本愛"]) {
    console.log(a, assembleBuzzScore(a, sources));
  }

  // prefilter sample
  console.log("\n=== prefilter keep? ===");
  for (const term of [...trendHits, ...newsHits].slice(0, 8)) {
    console.log(
      shouldKeepBuzzTerm({ term, source: "yahoo_news" }),
      term.slice(0, 60),
    );
  }

  const topic = "佐藤二朗と橋本愛のハラスメント疑惑を巡る声明対立";
  console.log("\n=== filterRelevantTopics ===");
  const filtered = await filterRelevantTopics([
    { term: "佐藤二朗" },
    { term: "橋本愛" },
    { term: topic },
    { term: "佐藤二朗 ハラスメント" },
  ]);
  console.log(JSON.stringify(filtered, null, 2));

  console.log("\n=== research + article ===");
  const evidence = await researchTopic(
    topic,
    {
      kokkaiRecords: RADAR.kokkaiRecords,
      lawRecords: RADAR.lawRecords,
      newsRecords: RADAR.newsRecords,
      internationalNewsRecords: RADAR.internationalNewsRecords,
    },
    prisma,
  );
  const suff = evaluateBuzzPromoteSufficiency(evidence);
  console.log({
    news: evidence.news.length,
    intl: evidence.internationalNews.length,
    wiki: !!evidence.background,
    laws: evidence.laws.length,
    distinctOutlets: suff.distinctNewsOutlets,
    promoteSufficient: suff.sufficient,
    sampleTitles: evidence.news.slice(0, 6).map((n) => `${n.source}: ${n.title.slice(0, 60)}`),
  });

  const useIntl = shouldUseInternationalReports("entertainment", topic);
  const domestic = evidence.news.map((n) => ({
    title: n.title,
    url: n.url,
    feed: n.source || "google-news",
    publishedAt: n.pubDate || undefined,
  }));
  const excerpts = await fetchReportExcerpts(domestic);
  console.log("excerpts", excerpts.length, "useIntl", useIntl);

  const { article, verified, unresolvedClaims, attempts } = await generateVerifiedArticle({
    issueTitle: topic,
    isReported: true,
    sources: domestic,
    reportExcerpts: excerpts,
    internationalReportExcerpts: [],
    dietSpeeches: evidence.dietSpeeches,
    background: evidence.background,
    laws: evidence.laws,
  });

  console.log("\n=== article result ===");
  console.log({ verified, attempts, unresolved: unresolvedClaims.slice(0, 3) });
  console.log("LEAD:", article.lead);
  console.log("BULLETS:", article.bullets);
  const h2 = [...article.articleHtml.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  console.log("H2:", h2.join(" → "));
  // print key sections
  for (const name of h2) {
    const re = new RegExp(`<h2>${name}</h2>([\\s\\S]*?)(?=<h2>|$)`);
    const m = article.articleHtml.match(re);
    if (!m) continue;
    const text = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 350);
    console.log(`\n## ${name}\n${text}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
