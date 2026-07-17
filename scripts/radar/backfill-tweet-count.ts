/**
 * 既存 PENDING の evidenceJson に Yahoo RT の tweetCount をバックフィルする。
 * discover 換装前の候補でも Selection V2 が動くようにする。
 *
 *   npx tsx scripts/radar/backfill-tweet-count.ts
 *   npx tsx scripts/radar/backfill-tweet-count.ts --dry-run
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Prisma } from "@prisma/client";

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
import { buzzMatchesStrictTitleCorpus } from "../../src/lib/buzz-cross-match";
import { fetchYahooRealtimeBuzzPolitics } from "./sources/yahoo-realtime";
import { matchYahooTweetCount } from "./lib/match-tweet-count";
import type { SavedEvidence } from "./lib/promote-logic";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const yahoo = await fetchYahooRealtimeBuzzPolitics();
  console.log(`Yahoo RT: ${yahoo.length}語`);
  yahoo.slice(0, 10).forEach((y) => console.log(`  ${y.term}: ${y.tweetCount}`));

  const rows = await prisma.topicCandidate.findMany({
    where: { status: "PENDING", discoverySource: "buzz" },
    select: { id: true, title: true, topicTerm: true, evidenceJson: true },
  });

  let updated = 0;
  let matched = 0;
  for (const row of rows) {
    const evidence = (row.evidenceJson ?? {}) as unknown as SavedEvidence;
    const topic = row.topicTerm || row.title;
    const tweetCount = matchYahooTweetCount(topic, yahoo, {
      matches: (t, term) => buzzMatchesStrictTitleCorpus(t, [term]) || buzzMatchesStrictTitleCorpus(term, [t]),
    });
    if (!tweetCount) continue;
    matched++;
    if (evidence.tweetCount === tweetCount) continue;
    console.log(`  ✓ ${row.title} → tweetCount=${tweetCount}`);
    if (!DRY_RUN) {
      await prisma.topicCandidate.update({
        where: { id: row.id },
        data: {
          evidenceJson: {
            ...evidence,
            tweetCount,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }
    updated++;
  }

  console.log(
    `\n突合${matched}件 / 更新${updated}件${DRY_RUN ? "（dry-run）" : ""} / 全PENDING ${rows.length}件`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
