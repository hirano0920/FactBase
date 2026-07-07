/**
 * Radar トピック選定パイプラインの目視確認用レポート。
 *
 * 実行:
 *   npx tsx scripts/radar/inspect-pipeline.ts           # DB の候補・公開シミュレーション
 *   npx tsx scripts/radar/inspect-pipeline.ts --live    # 上記 + 4ソースを今すぐ取得
 */
import { prisma } from "../../src/lib/prisma";
import {
  buildPipelineInspectReport,
  formatBuzzSources,
  type PromotionEvaluation,
} from "../../src/lib/radar-pipeline-inspect";

const LIVE = process.argv.includes("--live");

function bar(score: number, max = 4): string {
  return "█".repeat(score) + "░".repeat(Math.max(0, max - score));
}

function printCandidate(c: PromotionEvaluation, mark: string): void {
  console.log(
    `  ${mark} ${c.title.slice(0, 48)} | buzz ${c.buzzScore}/4 ${bar(c.buzzScore)} | ${formatBuzzSources(c.buzzSources)}`,
  );
  console.log(
    `      媒体${c.distinctNewsOutlets} 加点[${c.bonusSignals.join(",") || "—"}] | ${c.skipDetail}`,
  );
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log(" FactBase Radar — トピック選定パイプライン インスペクタ");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log("【ルート概要】");
  console.log("  A. discover→promote : Google Trends / Yahoo RT / Yahoo News / YouTube");
  console.log("     → nano関連性判定 → 能動調査 → PENDING → promote（buzzScore≥2 & 証拠十分）");
  console.log("  B. detect.ts          : 公式一次情報 + 🔴LIVE緊急のみ（選挙・内閣・戦争・テロ・震度6強+甚大被害）");
  console.log("  C. summarize/followup : 既存争点の記事生成・続報");
  console.log("  ※ X/YouTube等のバズ政治ネタ → A がピーク(7:30/12:00/19:30)に記事付き公開\n");

  const report = await buildPipelineInspectReport(prisma, { includeLiveBuzz: LIVE });

  if (report.liveBuzz) {
    const lb = report.liveBuzz;
    console.log("【① ライブ収集（4ソース・nano前）】");
    console.log(
      `  Trends ${lb.googleTrends.length} / Yahoo RT ${lb.yahooRealtime.length} / News ${lb.yahooNewsRanking.length} / YouTube ${lb.youtubeTrending.length}`,
    );
    console.log("  ── クロス照合プレビュー（buzzScore 降順・上位15）──");
    for (const t of lb.termPreviews.slice(0, 15)) {
      console.log(
        `    ${t.buzzScore}/4 ${bar(t.buzzScore)} ${t.term.slice(0, 40)} ← ${formatBuzzSources(t.buzzSources)}`,
      );
    }
    console.log("");
  } else {
    console.log("  （--live で4ソースの現在値も表示）\n");
  }

  const th = report.thresholds;
  console.log("【閾値】");
  console.log(
    `  promote: buzzScore≥${th.minBuzzScoreForPromotion} & 証拠十分 → 各ピーク${th.buzzArticlesPerWindow}本 / 鮮度${th.candidateFreshnessHours}h`,
  );
  console.log(
    `  discover: 最大${th.researchTopicsPerRun}トピック/回 · mini候補${th.topicFilterMaxTerms}語 · 起動 ${th.discoverWindowsJst.map((w) => `${w.hour}:${String(w.minute).padStart(2, "0")}`).join(", ")} JST`,
  );
  console.log(
    `  promoteピーク: ${th.peakWindowsJst.map((w) => `${w.hour}:${String(w.minute).padStart(2, "0")}`).join(", ")} JST\n`,
  );

  const sim = report.promotionSimulation;
  console.log(`【④ promote シミュレーション（PENDING buzz ${sim.pendingBuzzCount}件）】`);
  if (sim.selected.length === 0) {
    console.log("  ✅ 選定なし（次回ピークまで待機）");
  } else {
    console.log("  ✅ 次回 promote で記事化される候補:");
    for (const c of sim.selected) printCandidate(c, "→");
  }
  if (sim.rejected.length > 0) {
    console.log("\n  ✗ 除外された候補:");
    for (const c of sim.rejected.slice(0, 20)) printCandidate(c, "·");
    if (sim.rejected.length > 20) console.log(`    …他 ${sim.rejected.length - 20} 件`);
  }
  console.log("");

  console.log("【最近の公開争点（ルート付き）】");
  for (const issue of report.recentIssues.slice(0, 15)) {
    const buzz =
      issue.buzzScore != null
        ? ` buzz=${issue.buzzScore} [${formatBuzzSources(issue.buzzSources)}]`
        : "";
    console.log(
      `  ${issue.createdAt.slice(0, 16).replace("T", " ")} | ${issue.routeLabel}${buzz}`,
    );
    console.log(`    /issues/${issue.slug} — ${issue.title.slice(0, 50)}`);
    if (issue.timelineHint) console.log(`    TL: ${issue.timelineHint.slice(0, 70)}`);
  }
  console.log("\n生成: " + report.generatedAt);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
