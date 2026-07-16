/**
 * 閾値校正監査: 「公開前のスコア（Buzz'/Heat'/rankScore/分断シグナル）が、公開後の実測
 * エンゲージメント（投票参加数・実際の分断度・コメント数）とどれだけ相関するか」を測る。
 *
 * minBuzzScoreForPromotion・BUZZ_MIN_DEFAULT・HEAT_MIN_DEFAULT・RANK_MIN_DEFAULT・
 * researchPoolMultiplier は今まで勘で決めた定数だった。ここで実測との相関・バケツ分析・
 * Gate通過率を出し、閾値をどこに引くべきかの根拠にする。
 *
 *   node --env-file=.env.local --import tsx scripts/radar/audit-threshold-calibration.ts
 *   node --env-file=.env.local --import tsx scripts/radar/audit-threshold-calibration.ts --limit=200
 *
 * サンプル数が少ない時期は相関係数がノイズになる。nが小さいときは警告を出す
 * （目安: n<10は参考程度、n<20は相関係数を鵜呑みにしない）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
import { selectionV2RankScore, resolveDivisionScore } from "./lib/selection-v2";
import { pearsonCorrelation, bucketAverages } from "./lib/stats";
import type { SavedEvidence } from "./lib/promote-logic";

const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Math.max(10, parseInt(LIMIT_ARG.split("=")[1] ?? "", 10) || 200) : 200;
const MIN_TRUSTWORTHY_N = 20;
const MIN_REFERENCE_N = 10;

/** 実際の投票のfor/againstから、Yahoo投票のdivisionScoreと同じ式(1-margin)で実測分断度を出す */
function realVoteDivisionScore(forCount: number, againstCount: number): number | null {
  const total = forCount + againstCount;
  if (total === 0) return null;
  const margin = Math.abs(forCount - againstCount) / total;
  return 1 - margin;
}

function formatN(n: number): string {
  if (n < MIN_REFERENCE_N) return `n=${n}（参考にならない・様子見）`;
  if (n < MIN_TRUSTWORTHY_N) return `n=${n}（参考程度・鵜呑みにしない）`;
  return `n=${n}`;
}

function printCorrelation(label: string, pairs: { x: number; y: number }[]) {
  const r = pearsonCorrelation(
    pairs.map((p) => p.x),
    pairs.map((p) => p.y),
  );
  console.log(`  ${label}: r=${r === null ? "算出不可" : r.toFixed(3)} (${formatN(pairs.length)})`);
}

function printBuckets(label: string, pairs: { x: number; y: number }[], bucketCount = 3) {
  const buckets = bucketAverages(pairs, bucketCount);
  if (buckets.length === 0) {
    console.log(`  ${label}: データなし`);
    return;
  }
  console.log(`  ${label}（${formatN(pairs.length)}を${buckets.length}分位に分割）:`);
  for (const b of buckets) {
    console.log(
      `    x=${b.xRange[0].toFixed(2)}〜${b.xRange[1].toFixed(2)} → y平均${b.yMean.toFixed(2)}（n=${b.n}）`,
    );
  }
}

async function auditCorrelation() {
  const rows = await prisma.topicCandidate.findMany({
    where: { discoverySource: "buzz", status: "PUBLISHED", issueId: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: LIMIT,
    select: { id: true, title: true, evidenceJson: true, issueId: true },
  });

  const issueIds = rows.map((r) => r.issueId).filter((id): id is string => !!id);
  const issues = await prisma.issue.findMany({
    where: { id: { in: issueIds } },
    select: {
      id: true,
      voteForCount: true,
      voteAgainstCount: true,
      voteUndecidedCount: true,
      commentCount: true,
    },
  });
  const issueById = new Map(issues.map((i) => [i.id, i]));

  type Point = {
    title: string;
    buzzPrime: number;
    heatPrime: number;
    rankScore: number;
    divisionScore: number;
    totalVotes: number;
    realDivisionScore: number | null;
    realCommentCount: number;
  };

  const points: Point[] = [];
  for (const r of rows) {
    if (!r.issueId) continue;
    const issue = issueById.get(r.issueId);
    if (!issue) continue;
    const evidence = r.evidenceJson as unknown as SavedEvidence | null;
    if (!evidence) continue;

    const v2 = selectionV2RankScore(evidence);
    const divisionScore = resolveDivisionScore(evidence);
    const totalVotes = issue.voteForCount + issue.voteAgainstCount + issue.voteUndecidedCount;
    const realDivisionScore = realVoteDivisionScore(issue.voteForCount, issue.voteAgainstCount);

    points.push({
      title: r.title,
      buzzPrime: v2.buzzPrime,
      heatPrime: v2.heatPrime,
      rankScore: v2.rankScore,
      divisionScore,
      totalVotes,
      realDivisionScore,
      realCommentCount: issue.commentCount,
    });
  }

  console.log(`\n========== ①公開前スコア vs 公開後の実測相関（対象${points.length}件） ==========`);
  if (points.length < MIN_REFERENCE_N) {
    console.log(
      `  ⚠️ 公開済みbuzz記事が${points.length}件しかありません。校正には最低${MIN_REFERENCE_N}件、` +
        `信頼するには${MIN_TRUSTWORTHY_N}件以上が目安です。今は参考程度に留めてください。\n`,
    );
  }

  console.log("\n-- 投票参加数（totalVotes）との相関 --");
  printCorrelation("Buzz'", points.map((p) => ({ x: p.buzzPrime, y: p.totalVotes })));
  printCorrelation("Heat'", points.map((p) => ({ x: p.heatPrime, y: p.totalVotes })));
  printCorrelation("rankScore(Buzz'×Heat')", points.map((p) => ({ x: p.rankScore, y: p.totalVotes })));

  console.log("\n-- 実測コメント数（FactBase上の実際の議論量）との相関 --");
  printCorrelation("rankScore", points.map((p) => ({ x: p.rankScore, y: p.realCommentCount })));
  printCorrelation("事前分断シグナル(resolveDivisionScore)", points.map((p) => ({ x: p.divisionScore, y: p.realCommentCount })));

  const withRealDivision = points.filter((p) => p.realDivisionScore !== null) as (Point & {
    realDivisionScore: number;
  })[];
  console.log("\n-- 実測投票の分断度（for/against拮抗度）との相関 --");
  printCorrelation(
    "事前分断シグナル(resolveDivisionScore) vs 実測投票分断度",
    withRealDivision.map((p) => ({ x: p.divisionScore, y: p.realDivisionScore })),
  );

  console.log("\n========== ②rankScoreの分位ごとの実測エンゲージメント（閾値の当たりを付ける） ==========");
  printBuckets("rankScore → 投票参加数", points.map((p) => ({ x: p.rankScore, y: p.totalVotes })));
  printBuckets("rankScore → 実測コメント数", points.map((p) => ({ x: p.rankScore, y: p.realCommentCount })));
  printBuckets(
    "事前分断シグナル → 実測投票分断度",
    withRealDivision.map((p) => ({ x: p.divisionScore, y: p.realDivisionScore })),
  );
}

/** decisionフィールドの先頭prefix（例: "thin_excerpts:理由..." → "thin_excerpts"） */
function decisionPrefix(decision: string | null): string {
  if (!decision) return "(理由なし)";
  return decision.split(":")[0].split("/").pop()?.trim() || decision;
}

/**
 * 事前に「抜粋取得後の脱落はthin_excerpts/writeability_rejected/debate_legitimacy_rejectedだけ」
 * と決め打ちしていたが、実データを見るとHELDの大半は unverified_claim（Writerが生成した記事の
 * 主張が裏取りできない）・quality_gate（bothSidesQuality不足）という**Writer実行後**の
 * 品質ゲートだった（2026-07-16、実データで確認）。つまりresearchPoolMultiplierが本当に
 * 吸収すべき「抜粋取得の対象になったが最終的に公開されなかった」候補は、
 * 理由の種類を問わず discoverySource=buzz の HELD 全件とみなすのが実態に合っている。
 */
async function auditGatePassRate() {
  const LOOKBACK_DAYS = 30;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60_000);

  const [published, held] = await Promise.all([
    prisma.topicCandidate.count({
      where: { discoverySource: "buzz", status: "PUBLISHED", updatedAt: { gte: since } },
    }),
    prisma.topicCandidate.findMany({
      where: { discoverySource: "buzz", status: "HELD", updatedAt: { gte: since } },
      select: { decision: true },
    }),
  ]);

  const heldByPrefix = new Map<string, number>();
  for (const h of held) {
    const prefix = decisionPrefix(h.decision);
    heldByPrefix.set(prefix, (heldByPrefix.get(prefix) ?? 0) + 1);
  }
  const preWriterPrefixes = new Set(["thin_excerpts", "writeability_rejected", "debate_legitimacy_rejected"]);
  const postWriterCount = held.length - [...heldByPrefix.entries()]
    .filter(([prefix]) => preWriterPrefixes.has(prefix))
    .reduce((sum, [, count]) => sum + count, 0);

  const poolStageTotal = held.length + published;

  console.log(`\n========== ③Gate通過率（過去${LOOKBACK_DAYS}日・researchPoolMultiplierの妥当性） ==========`);
  console.log(`  公開: ${published}件 / HELD: ${held.length}件`);
  console.log("  HELD内訳（上位、多い順）:");
  for (const [prefix, count] of [...heldByPrefix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${prefix}: ${count}件`);
  }
  if (postWriterCount > 0) {
    console.log(
      `  ⚠️ HELDの${postWriterCount}件はWriter実行後（unverified_claim/quality_gate等）の脱落。` +
        `researchPoolMultiplier（抜粋取得段階の倍率）ではなく、Writerの裏取り精度・` +
        `bothSidesQualityの方が本当のボトルネックの可能性が高い。`,
    );
  }

  if (poolStageTotal === 0) {
    console.log("  抜粋取得後の脱落データが無く、通過率を算出できません。");
    return;
  }
  const passRate = published / poolStageTotal;
  const suggestedMultiplier = passRate > 0 ? Math.ceil(1 / passRate) : null;
  console.log(
    `  抜粋取得〜公開までの全体通過率: ${(passRate * 100).toFixed(1)}%` +
      `（${published}/${poolStageTotal}、${formatN(poolStageTotal)}）`,
  );
  if (suggestedMultiplier !== null) {
    console.log(
      `  → 目安のresearchPoolMultiplier ≈ ${suggestedMultiplier}（現在値と比べて確認してください。` +
        `ただし上記の通りボトルネックがWriter後にあるなら、倍率を増やしても解決しない）`,
    );
  }
}

async function main() {
  console.log("========== 閾値校正監査 ==========");
  await auditCorrelation();
  await auditGatePassRate();
  console.log("\n完了。相関・分位・通過率を見て、閾値定数を動かす根拠にしてください。");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
