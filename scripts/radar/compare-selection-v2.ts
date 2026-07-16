/**
 * Selection V2（本番換装後）と旧加算スコアの並び比較。
 *
 * 使い方:
 *   npx tsx scripts/radar/compare-selection-v2.ts
 *   npx tsx scripts/radar/compare-selection-v2.ts --demo
 *   npx tsx scripts/radar/compare-selection-v2.ts --limit=20
 *
 * evidence.tweetCount が無い候補は、実行時 Yahoo RT 突合で override する。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

(function loadLocalEnv() {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const name of [".env.local", ".env"]) {
    const p = resolve(dir, "../..", name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      const m = line.match(/^\s*([\w_]+)\s*=\s*(.+?)\s*$/);
      if (m) process.env[m[1]] = process.env[m[1]] || m[2].replace(/^["']|["']$/g, "");
    }
  }
})();

import { prisma } from "../../src/lib/prisma";
import { buzzMatchesTitleCorpus } from "../../src/lib/buzz-cross-match";
import { fetchYahooRealtimeBuzzPolitics } from "./sources/yahoo-realtime";
import { evaluateBuzzPromoteSufficiency } from "./lib/research";
import {
  weightedPromoteScore,
  weightedPromoteScoreLegacy,
  type SavedEvidence,
  type PromotionCandidate,
} from "./lib/promote-logic";
import {
  selectionV2RankScore,
  passesRankMin,
  RANK_MIN_DEFAULT,
} from "./lib/selection-v2";
import { matchYahooTweetCount } from "./lib/match-tweet-count";

const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Math.max(5, parseInt(LIMIT_ARG.split("=")[1] ?? "", 10) || 30) : 30;
const DEMO = process.argv.includes("--demo");

const DEMO_CASES: {
  title: string;
  buzzScore: number;
  tweetCount: number;
  commentCount?: number;
  commentCountSurge?: boolean;
  divisionScore?: number;
}[] = [
  { title: "消費減税（食料品1%・2年限定）の是非", buzzScore: 2, tweetCount: 4200, commentCount: 1200 },
  { title: "EUの中国製ドローン部品購入の是非", buzzScore: 4, tweetCount: 1800, divisionScore: 0.7 },
  { title: "米軍の連続的な対イラン攻撃", buzzScore: 3, tweetCount: 3500, commentCount: 800 },
  { title: "公務員と民間の賞与格差", buzzScore: 0, tweetCount: 200, commentCount: 400 },
  { title: "加熱式たばこの一斉値上げ（JT）", buzzScore: 2, tweetCount: 40 },
  { title: "クレカ障害（参考: 今のRT特大）", buzzScore: 2, tweetCount: 1735, commentCountSurge: true },
];

function runDemo() {
  console.log("========== DEMO（仮想 tweetCount）旧加算 vs V2 ==========\n");

  const rows = DEMO_CASES.map((d) => {
    const evidence: SavedEvidence = {
      topic: d.title,
      dietSpeeches: [],
      laws: [],
      news: [],
      internationalNews: [],
      background: null,
      officialEvents: [],
      gatheredAt: "",
      buzzScore: d.buzzScore,
      commentCount: d.commentCount,
      commentCountSurge: d.commentCountSurge,
      externalPoll:
        d.divisionScore != null
          ? { question: "q", url: "https://x", choices: [], divisionScore: d.divisionScore }
          : undefined,
      tweetCount: d.tweetCount,
      debateType: "policy",
      debatable: true,
    };
    const candidate: PromotionCandidate = {
      id: d.title,
      title: d.title,
      category: "politics",
      topicTerm: d.title,
      sourceUrls: [],
      evidence,
    };
    const legacy = weightedPromoteScoreLegacy(candidate, 2);
    const v2 = selectionV2RankScore(evidence);
    const prod = weightedPromoteScore(candidate, 2);
    return { title: d.title, legacy, v2, prod, passMin: passesRankMin(v2.rankScore) };
  });

  const byLegacy = [...rows].sort((a, b) => b.legacy - a.legacy);
  const byV2 = [...rows].sort((a, b) => b.v2.rankScore - a.v2.rankScore);

  console.log("--- 旧加算 TOP ---");
  byLegacy.forEach((r, i) => console.log(`${i + 1}. [${r.legacy.toFixed(2)}] ${r.title}`));
  console.log("\n--- V2 / 本番 weightedPromoteScore TOP ---");
  byV2.forEach((r, i) =>
    console.log(
      `${i + 1}. [${r.v2.rankScore.toFixed(3)}] ${r.title}  buzz'=${r.v2.buzzPrime.toFixed(2)} heat'=${r.v2.heatPrime.toFixed(2)} tweets=${r.v2.tweetCount} pass=${r.passMin} prod=${r.prod.toFixed(3)}`,
    ),
  );
}

async function main() {
  if (DEMO) {
    runDemo();
    return;
  }

  const yahoo = await fetchYahooRealtimeBuzzPolitics();
  console.log(`Yahoo RT: ${yahoo.length}語（tweetCount突合用）`);
  if (yahoo.length > 0) {
    console.log(
      "  現在のRT例:",
      yahoo
        .slice(0, 8)
        .map((y) => `${y.term}(${y.tweetCount})`)
        .join(" / "),
    );
  }

  const rows = await prisma.topicCandidate.findMany({
    where: { status: "PENDING", discoverySource: "buzz" },
    orderBy: { updatedAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      title: true,
      category: true,
      topicTerm: true,
      sourceUrls: true,
      evidenceJson: true,
      updatedAt: true,
      status: true,
    },
  });

  if (rows.length === 0) {
    console.log("PENDING buzz 候補が0件です。");
    return;
  }

  type Row = {
    title: string;
    category: string | null;
    legacy: number;
    prod: number;
    v2: ReturnType<typeof selectionV2RankScore>;
    passMin: boolean;
    evidenceTweetCount: number | undefined;
  };

  const compared: Row[] = [];

  for (const row of rows) {
    const evidence = (row.evidenceJson ?? {}) as unknown as SavedEvidence;
    const sourceUrls = (row.sourceUrls ?? []) as PromotionCandidate["sourceUrls"];
    const topic = row.topicTerm || row.title;
    const tweetOverride = matchYahooTweetCount(topic, yahoo, {
      matches: (t, term) => buzzMatchesTitleCorpus(t, [term]) || buzzMatchesTitleCorpus(term, [t]),
    });
    const evidenceForScore: SavedEvidence = {
      ...evidence,
      tweetCount: evidence.tweetCount ?? tweetOverride,
    };
    const candidate: PromotionCandidate = {
      id: row.id,
      title: row.title,
      category: row.category,
      topicTerm: row.topicTerm,
      sourceUrls,
      evidence: evidenceForScore,
      updatedAt: row.updatedAt,
    };
    const suff = evaluateBuzzPromoteSufficiency(evidence);
    const legacy = weightedPromoteScoreLegacy(candidate, suff.distinctNewsOutlets);
    const prod = weightedPromoteScore(candidate, suff.distinctNewsOutlets);
    const v2 = selectionV2RankScore(evidenceForScore);
    compared.push({
      title: row.title,
      category: row.category,
      legacy,
      prod,
      v2,
      passMin: passesRankMin(v2.rankScore),
      evidenceTweetCount: evidence.tweetCount,
    });
  }

  const byLegacy = [...compared].sort((a, b) => b.legacy - a.legacy);
  const byV2 = [...compared].sort((a, b) => b.v2.rankScore - a.v2.rankScore);

  console.log("\n========== 旧加算 TOP ==========");
  byLegacy.slice(0, 10).forEach((r, i) => {
    console.log(
      `${i + 1}. [${r.legacy.toFixed(2)}] ${r.title}\n` +
        `   V2: rank=${r.v2.rankScore.toFixed(3)} tweets=${r.v2.tweetCount} saved=${r.evidenceTweetCount ?? "なし"} pass=${r.passMin}`,
    );
  });

  console.log("\n========== V2 / 本番 TOP ==========");
  byV2.slice(0, 10).forEach((r, i) => {
    console.log(
      `${i + 1}. [${r.v2.rankScore.toFixed(3)}] ${r.title}\n` +
        `   buzz'=${r.v2.buzzPrime.toFixed(2)} heat'=${r.v2.heatPrime.toFixed(2)} tweets=${r.v2.tweetCount} pass=${r.passMin} legacy=${r.legacy.toFixed(2)}`,
    );
  });

  const passCount = compared.filter((r) => r.passMin).length;
  const withSavedTweet = compared.filter((r) => (r.evidenceTweetCount ?? 0) > 0).length;
  console.log("\n========== サマリー ==========");
  console.log(`候補数: ${compared.length}`);
  console.log(`evidenceにtweetCount保存済み: ${withSavedTweet}`);
  console.log(`RANK_MIN(${RANK_MIN_DEFAULT})通過: ${passCount}件`);

  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../_selection_v2_compare.json");
  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), byLegacy, byV2 }, null, 2));
  console.log(`詳細: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
