/**
 * 一時: 導火線プロンプト後の実記事をダンプして目視する。
 * 実行: npx tsx scripts/radar/dump-sample-articles.ts
 */
import { existsSync, writeFileSync } from "node:fs";
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

import { prisma } from "../../src/lib/prisma";
import { RADAR } from "../../src/lib/constants";
import { researchTopic, isEmptyEvidence } from "./lib/research";
import { generateVerifiedArticle } from "../../src/lib/radar-article";
import { shouldUseInternationalReports } from "../../src/lib/radar";
import { fetchReportExcerpts } from "./lib/report-text";

const topics = [
  "日銀の政策金利判断",
  "著名人のハラスメント疑惑と本人の反論",
  "最低賃金引き上げ論議",
];

const limits = {
  kokkaiRecords: RADAR.kokkaiRecords,
  lawRecords: RADAR.lawRecords,
  newsRecords: RADAR.newsRecords,
  internationalNewsRecords: RADAR.internationalNewsRecords,
};

async function main() {
  const out: unknown[] = [];
  for (const topic of topics) {
    console.log(`\n=== research: ${topic}`);
    const evidence = await researchTopic(topic, limits, prisma);
    if (isEmptyEvidence(evidence)) {
      console.warn("empty", topic);
      continue;
    }
    const isOfficial = evidence.laws.length > 0 || evidence.officialEvents.length > 0;
    const useIntl = shouldUseInternationalReports(null, topic);
    const domesticSources = evidence.news.map((n) => ({
      title: n.title,
      url: n.url,
      feed: n.source || "google-news",
      publishedAt: n.pubDate || undefined,
    }));
    const intlSources = evidence.internationalNews.map((n) => ({
      title: n.title,
      url: n.url,
      feed: n.source || "international",
      publishedAt: n.pubDate || undefined,
    }));
    // 国内主は国内見出し・本文のみ。海外主だけ海外を足す
    const sources = useIntl ? [...domesticSources, ...intlSources] : domesticSources;
    const reportExcerpts = isOfficial ? [] : await fetchReportExcerpts(domesticSources);
    const internationalReportExcerpts = useIntl ? await fetchReportExcerpts(intlSources) : [];
    if (!useIntl && intlSources.length > 0) {
      console.log(`  🌍 国内主のため海外${intlSources.length}件スキップ`);
    }
    const { article, verified, unresolvedClaims, attempts } = await generateVerifiedArticle({
      issueTitle: topic,
      isReported: !isOfficial,
      sources,
      reportExcerpts,
      internationalReportExcerpts,
      dietSpeeches: evidence.dietSpeeches,
      background: evidence.background,
      laws: evidence.laws,
      estatStats: evidence.estatStats,
    });
    out.push({
      topic,
      isOfficial,
      verified,
      attempts,
      unresolvedClaims: unresolvedClaims.slice(0, 5),
      reportExcerptCount: reportExcerpts.length,
      distinctOutlets: new Set(
        [...evidence.news, ...evidence.internationalNews].map((n) => n.source || n.url),
      ).size,
      hasWiki: !!evidence.background,
      lawCount: evidence.laws.length,
      lead: article.lead,
      bullets: article.bullets,
      articleHtml: article.articleHtml,
      claimsCount: article.claims?.length ?? 0,
    });
    console.log(`done ${topic} verified=${verified} official=${isOfficial}`);
  }
  const outPath = resolve(root, "tmp-article-eval.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`wrote ${outPath} (${out.length})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
