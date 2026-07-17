/**
 * PDCA日次レビュースクリプト
 * 現在のDB状態を元に、選抜結果・Gate通過状況・生成記事をレポートする。
 *
 * 使い方:
 *   npx tsx scripts/pdca/daily-review.ts [--day 1] [--fresh-hours 24]
 *
 * 出力:
 *   logs/pdca/day{N}.md にMarkdownレポートを保存
 */
import { prisma } from "../../src/lib/prisma";
import { selectionV2RankScore, passesSelectionV2 } from "../radar/lib/selection-v2";
import * as fs from "fs";
import * as path from "path";

const DAY = parseInt(process.argv.find((a) => a.startsWith("--day="))?.split("=")[1] ?? "1");
const FRESH_HOURS = parseInt(process.argv.find((a) => a.startsWith("--fresh-hours="))?.split("=")[1] ?? "24");
const LOG_DIR = path.resolve(__dirname, "../../logs/pdca");

interface ReviewRow {
  title: string;
  rankScore: number;
  buzzPrime: number;
  clickHeat: number;
  debateHeat: number;
  nationalImportance: number;
  commentCount: number;
  frictionScore: number | undefined;
  tweetCount: number;
  cluster: number;
  buzzSources: string[];
  externalPoll?: { divisionScore?: number };
  failReasons: string[];
  buzzScore: number;
  commentCountSurge?: number;
}

async function main() {
  const now = new Date();
  const freshSince = new Date(now.getTime() - FRESH_HOURS * 3600_000);

  const rows = await prisma.topicCandidate.findMany({
    where: { discoverySource: "buzz", status: "PENDING", updatedAt: { gte: freshSince } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  // --- Ranking ---
  const passed: ReviewRow[] = [];
  const failed: ReviewRow[] = [];

  for (const r of rows) {
    if (!r.evidenceJson) continue;
    const ev = r.evidenceJson as any;
    const rank = selectionV2RankScore(ev);
    const pass = passesSelectionV2(rank);
    const reasons: string[] = [];
    if (!pass) {
      if ((rank.buzzPrime ?? 0) < 0.4) reasons.push(`Buzz低(${rank.buzzPrime?.toFixed(2)})`);
      if (rank.clickHeat === 0 && rank.debateHeat === 0) reasons.push("Click=Debate=0");
      if (rank.debateHeat < 0.05) reasons.push(`Debate低(${rank.debateHeat.toFixed(3)})`);
      if (reasons.length === 0) reasons.push(`Rank低(${rank.rankScore.toFixed(4)})`);
    }
    const row: ReviewRow = {
      title: r.title,
      rankScore: rank.rankScore,
      buzzPrime: rank.buzzPrime,
      clickHeat: rank.clickHeat,
      debateHeat: rank.debateHeat,
      nationalImportance: rank.nationalImportance,
      commentCount: ev.commentCount ?? 0,
      frictionScore: ev.commentFrictionScore,
      tweetCount: ev.tweetCount ?? 0,
      cluster: ev.newsClusterCount ?? 0,
      buzzSources: ev.buzzSources ?? [],
      externalPoll: ev.externalPoll,
      failReasons: reasons,
      buzzScore: ev.buzzScore ?? 0,
    };
    if (pass) passed.push(row);
    else failed.push(row);
  }

  passed.sort((a, b) => b.rankScore - a.rankScore);

  // --- 今日生成されたIssue（= 投稿記事） ---
  const todayIssues = await prisma.issue.findMany({
    where: {
      createdAt: { gte: freshSince },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, title: true, category: true, status: true, createdAt: true },
  });

  // --- 今日HELDされた候補（失敗情報） ---
  const heldCandidates = await prisma.topicCandidate.findMany({
    where: { discoverySource: "buzz", status: "HELD", updatedAt: { gte: freshSince } },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { title: true, status: true, decision: true, updatedAt: true },
  });

  // --- Generate Markdown ---
  const safeTitle = (s: string) => s.replace(/[<>]/g, "").slice(0, 60);
  const lines: string[] = [];

  lines.push(`# Day ${DAY} レビューレポート`);
  lines.push(`\n**日時:** ${now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`);
  lines.push(`**取得範囲:** 過去${FRESH_HOURS}時間`);
  lines.push(`**PENDING候補総数:** ${rows.length}件`);
  lines.push(`**Selection V2通過:** ${passed.length}件`);
  lines.push(`**Selection V2不合格:** ${failed.length}件`);
  lines.push(`**本日生成Issue:** ${todayIssues.length}件`);
  lines.push(`**HELD候補:** ${heldCandidates.length}件`);

  // === 通過候補トップ ===
  lines.push(`\n## 通過候補（全${passed.length}件）\n`);
  lines.push("| # | トピック | Rank | Buzz' | Click' | Debate' | NI | tweet | comment | friction | cluster |");
  lines.push("|---|---------|------|-------|--------|---------|----|-------|---------|----------|---------|");
  passed.forEach((r, i) => {
    const niStr = r.nationalImportance !== 1 ? r.nationalImportance.toFixed(1) : "-";
    const frStr = r.frictionScore !== undefined ? r.frictionScore.toFixed(2) : "-";
    lines.push(
      `| ${i + 1} | ${safeTitle(r.title)} | ${r.rankScore.toFixed(4)} | ${r.buzzPrime.toFixed(2)} | ${r.clickHeat.toFixed(3)} | ${r.debateHeat.toFixed(3)} | ${niStr} | ${r.tweetCount} | ${r.commentCount} | ${frStr} | ${r.cluster} |`,
    );
  });

  // === 実際に投稿されるトップ5 ===
  lines.push(`\n## 投稿候補トップ5\n`);
  for (const r of passed.slice(0, 5)) {
    const sources = r.buzzSources.length > 0 ? r.buzzSources.join(", ") : "（データなし）";
    const poll = r.externalPoll?.divisionScore !== undefined
      ? `division=${r.externalPoll.divisionScore.toFixed(2)}`
      : "なし";
    const niNote = r.nationalImportance !== 1
      ? `（国の重要度×${r.nationalImportance.toFixed(1)}で補正）`
      : "";
    lines.push(`### ${r.title}`);
    lines.push(`- **Rank:** ${r.rankScore.toFixed(4)} ${niNote}`);
    lines.push(`- **Buzz:** ${r.buzzPrime.toFixed(2)}（素点: ${r.buzzScore.toFixed(2)}）`);
    lines.push(`- **ClickHeat:** ${r.clickHeat.toFixed(3)}（tweet=${r.tweetCount}）`);
    lines.push(`- **DebateHeat:** ${r.debateHeat.toFixed(3)}（comment=${r.commentCount} friction=${r.frictionScore?.toFixed(2) ?? "未測定"} cluster=${r.cluster}）`);
    lines.push(`- **バズソース:** ${sources}`);
    lines.push(`- **世論調査:** ${poll}`);
    lines.push("");
  }

  // === 不合格理由 ===
  if (failed.length > 0) {
    lines.push(`\n## 不合格（${failed.length}件）\n`);
    lines.push("| # | トピック | Rank | 主な理由 |");
    lines.push("|---|---------|------|---------|");
    failed.sort((a, b) => b.buzzScore - a.buzzScore).slice(0, 30).forEach((r, i) => {
      lines.push(`| ${i + 1} | ${safeTitle(r.title)} | ${r.rankScore.toFixed(4)} | ${r.failReasons.join(", ")} |`);
    });
    if (failed.length > 30) {
      lines.push(`| ... | 他${failed.length - 30}件 | ... | ... |`);
    }
  }

  // === 本日生成Issue ===
  if (todayIssues.length > 0) {
    lines.push(`\n## 本日生成されたIssue（${todayIssues.length}件）\n`);
    lines.push("| # | タイトル | カテゴリ | ステータス |");
    lines.push("|---|---------|---------|-----------|");
    todayIssues.forEach((a, i) => {
      lines.push(`| ${i + 1} | ${safeTitle(a.title)} | ${a.category} | ${a.status} |`);
    });
  } else {
    lines.push(`\n## 本日生成されたIssue\n\nなし（前回promoteからの新規生成なし）\n`);
  }

  // === HELD候補 ===
  if (heldCandidates.length > 0) {
    lines.push(`\n## HELD候補（${heldCandidates.length}件）\n`);
    lines.push("| # | トピック | 判断 |");
    lines.push("|---|---------|------|");
    heldCandidates.slice(0, 20).forEach((r, i) => {
      lines.push(`| ${i + 1} | ${safeTitle(r.title)} | ${r.decision ?? "理由不明"} |`);
    });
    if (heldCandidates.length > 20) {
      lines.push(`| ... | 他${heldCandidates.length - 20}件 | ... |`);
    }
  }

  // === 前回との差分（初回は省略） ===
  const dayNMinus1 = path.join(LOG_DIR, `day${DAY - 1}.md`);
  if (DAY > 1 && fs.existsSync(dayNMinus1)) {
    const prevPassed = parseInt(
      fs.readFileSync(dayNMinus1, "utf-8").match(/Selection V2通過:\s*(\d+)/)?.[1] ?? "0",
    );
    const diff = passed.length - prevPassed;
    const diffSign = diff >= 0 ? `+${diff}` : `${diff}`;
    lines.push(`\n## 前日比\n`);
    lines.push(`- 通過数: ${prevPassed} → ${passed.length}（${diffSign}）`);
    lines.push(`- HELD数: 変化あり（詳細はログ参照）`);
  }

  // === 今日の改善ポイント ===
  lines.push(`\n## Day ${DAY} の所感\n\n（後で記入）\n`);

  const report = lines.join("\n");
  const outPath = path.join(LOG_DIR, `day${DAY}.md`);
  fs.writeFileSync(outPath, report, "utf-8");
  console.log(report);
  console.log(`\n---\n📁 保存: ${outPath}`);

  await prisma.$disconnect();
}

main().catch(console.error);
