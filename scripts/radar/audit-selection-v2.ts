/**
 * Selection V2 監査: PENDING に対して Buzz×Heat 足切り＋両論Gate（証拠テキスト）を走らせ、
 * 「何が通って何が落ちたか／どんな内容か」を人間が読める形で出す。
 *
 *   node --env-file=.env.local --import tsx scripts/radar/audit-selection-v2.ts
 *   node --env-file=.env.local --import tsx scripts/radar/audit-selection-v2.ts --limit=40 --legitimacy=8
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
import { assessDebateLegitimacy } from "../../src/lib/ai";
import { buzzMatchesStrictTitleCorpus } from "../../src/lib/buzz-cross-match";
import { fetchYahooRealtimeBuzzPolitics } from "./sources/yahoo-realtime";
import { evaluateBuzzPromoteSufficiency } from "./lib/research";
import {
  isEligibleForPromotion,
  selectTopicsForPromotion,
  isLopsidedByPrediction,
  type PromotionCandidate,
  type SavedEvidence,
} from "./lib/promote-logic";
import {
  selectionV2RankScore,
  passesSelectionV2,
  BUZZ_MIN_DEFAULT,
  HEAT_MIN_DEFAULT,
  RANK_MIN_DEFAULT,
} from "./lib/selection-v2";
import { matchYahooTweetCount } from "./lib/match-tweet-count";

const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Math.max(5, parseInt(LIMIT_ARG.split("=")[1] ?? "", 10) || 40) : 40;
const LEGIT_ARG = process.argv.find((a) => a.startsWith("--legitimacy="));
const LEGIT_N = LEGIT_ARG ? Math.max(0, parseInt(LEGIT_ARG.split("=")[1] ?? "", 10) || 8) : 8;
const SKIP_LEGIT = process.argv.includes("--skip-legitimacy");

function newsExcerpts(evidence: SavedEvidence): { feed?: string; text: string }[] {
  const fromNews = (evidence.news ?? [])
    .map((n) => ({
      feed: n.source || "news",
      text: [n.title, (n as { summary?: string }).summary, (n as { snippet?: string }).snippet]
        .filter(Boolean)
        .join("。"),
    }))
    .filter((e) => e.text.trim().length >= 20);
  const fromIntl = (evidence.internationalNews ?? []).map((n) => ({
    feed: n.source || "intl",
    text: n.title || "",
  }));
  const fromBg = evidence.background?.extract
    ? [{ feed: "背景", text: evidence.background.extract.slice(0, 400) }]
    : [];
  return [...fromNews, ...fromIntl, ...fromBg].filter((e) => e.text.trim().length > 0);
}

function failReason(v2: ReturnType<typeof selectionV2RankScore>, eligible: boolean): string {
  if (!eligible) return "eligible外（buzz/証拠/debateType等）";
  const parts: string[] = [];
  if (v2.buzzPrime < BUZZ_MIN_DEFAULT) parts.push(`Buzz'不足(${v2.buzzPrime.toFixed(2)}<${BUZZ_MIN_DEFAULT})`);
  if (v2.heatPrime < HEAT_MIN_DEFAULT) parts.push(`Heat'不足(${v2.heatPrime.toFixed(2)}<${HEAT_MIN_DEFAULT})`);
  if (v2.rankScore < RANK_MIN_DEFAULT) parts.push(`積不足(${v2.rankScore.toFixed(3)}<${RANK_MIN_DEFAULT})`);
  if (parts.length === 0) return "Buzz×Heat通過";
  return parts.join(" / ");
}

async function main() {
  console.log("========== Selection V2 監査 ==========\n");

  const yahoo = await fetchYahooRealtimeBuzzPolitics();
  console.log(`Yahoo RT: ${yahoo.length}語`);
  if (yahoo.length > 0) {
    console.log(
      "  いまのRT上位:",
      yahoo
        .slice(0, 10)
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
    },
  });

  if (rows.length === 0) {
    console.log("PENDING buzz 候補が0件です。discover を先に走らせてください。");
    return;
  }

  const candidates: PromotionCandidate[] = rows.map((row) => {
    const evidence = (row.evidenceJson ?? {}) as unknown as SavedEvidence;
    const topic = row.topicTerm || row.title;
    const tweetOverride = matchYahooTweetCount(topic, yahoo, {
      matches: (t, term) => buzzMatchesStrictTitleCorpus(t, [term]) || buzzMatchesStrictTitleCorpus(term, [t]),
    });
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      topicTerm: row.topicTerm,
      sourceUrls: (row.sourceUrls ?? []) as PromotionCandidate["sourceUrls"],
      evidence: {
        ...evidence,
        tweetCount: evidence.tweetCount ?? tweetOverride ?? evidence.tweetCount,
      },
      updatedAt: row.updatedAt,
    };
  });

  const audited = candidates.map((c) => {
    const suff = evaluateBuzzPromoteSufficiency(c.evidence);
    const eligible = isEligibleForPromotion(c, suff, 2);
    const v2 = selectionV2RankScore(c.evidence);
    const passRank = passesSelectionV2(v2);
    const news = (c.evidence.news ?? []).slice(0, 4).map((n) => `${n.source ?? "?"}: ${n.title}`);
    return {
      id: c.id,
      title: c.title,
      category: c.category,
      voteQuestion: c.evidence.voteQuestion ?? null,
      debateType: c.evidence.debateType ?? null,
      debatable: c.evidence.debatable,
      buzzScore: c.evidence.buzzScore ?? 0,
      buzzSources: c.evidence.buzzSources ?? [],
      commentCount: c.evidence.commentCount ?? null,
      tweetCount: v2.tweetCount,
      tweetSaved: c.evidence.tweetCount ?? null,
      v2,
      eligible,
      passRank,
      reason: failReason(v2, eligible),
      news,
      newsCount: (c.evidence.news ?? []).length,
    };
  });

  const byRank = [...audited].sort((a, b) => b.v2.rankScore - a.v2.rankScore);
  const passBoth = byRank.filter((a) => a.eligible && a.passRank);
  const selected = selectTopicsForPromotion(candidates, 2, 9);

  console.log("\n========== Buzz×Heat 通過（eligible ∧ passesSelectionV2） ==========");
  if (passBoth.length === 0) {
    console.log("（0件）");
  } else {
    passBoth.forEach((r, i) => {
      console.log(
        `${i + 1}. [${r.v2.rankScore.toFixed(3)}] ${r.title}\n` +
          `   設問: ${r.voteQuestion ?? "（なし）"}\n` +
          `   type=${r.debateType} cat=${r.category} buzz=${r.buzzScore} tweets=${r.tweetCount} comments=${r.commentCount ?? "-"}\n` +
          `   buzz'=${r.v2.buzzPrime.toFixed(2)} heat'=${r.v2.heatPrime.toFixed(2)} sources=${(r.buzzSources ?? []).join(",") || "-"}\n` +
          `   報道例:\n` +
          (r.news.length ? r.news.map((n) => `     - ${n}`).join("\n") : "     （newsなし）"),
      );
    });
  }

  console.log("\n========== selectTopicsForPromotion 上位（本番と同じ選定） ==========");
  selected.forEach((c, i) => {
    const a = audited.find((x) => x.id === c.id)!;
    console.log(`${i + 1}. ${c.title}  [${a.v2.rankScore.toFixed(3)}]  ${a.voteQuestion ?? ""}`);
  });

  console.log("\n========== 落ちた理由 TOP（rank高いのに不合格） ==========");
  byRank
    .filter((a) => !(a.eligible && a.passRank))
    .slice(0, 15)
    .forEach((r, i) => {
      console.log(
        `${i + 1}. [${r.v2.rankScore.toFixed(3)}] ${r.title}\n` +
          `   → ${r.reason}  buzz=${r.buzzScore} tweets=${r.tweetCount} heat'=${r.v2.heatPrime.toFixed(2)}`,
      );
    });

  // 両論Gate: Buzz×Heat通過の上位、足りなければ rank 上位で補完
  const legitTargets = (
    passBoth.length > 0 ? passBoth : byRank.filter((a) => a.eligible)
  ).slice(0, SKIP_LEGIT ? 0 : LEGIT_N);

  type LegitRow = {
    title: string;
    voteQuestion: string | null;
    legitimate: boolean;
    problemType: string;
    reason: string;
    suggestedFrames: string[];
    excerptCount: number;
    excerptPreview: string[];
    predictedDivisionScore: number | undefined;
    lopsidedPredicted: boolean;
  };
  const legitRows: LegitRow[] = [];

  if (legitTargets.length > 0) {
    console.log(`\n========== 両論Gate（証拠テキスト・最大${legitTargets.length}件） ==========`);
    console.log("※ promote本番はURL抜粋後。ここは evidence の見出し/要約での事前チェック。\n");
    for (const t of legitTargets) {
      const c = candidates.find((x) => x.id === t.id)!;
      const excerpts = newsExcerpts(c.evidence);
      // 見出しだけだと40字未満が多い → タイトル＋設問を足して「材料がある」状態で判定
      const padded = excerpts.map((e) => ({
        feed: e.feed,
        text:
          e.text.trim().length >= 40
            ? e.text
            : `${c.title}。${e.text}。関連報道として各社が報じている。`,
      }));
      const result = await assessDebateLegitimacy({
        topic: c.title,
        voteQuestion: c.evidence.voteQuestion || c.title,
        excerpts: padded.length > 0 ? padded : [{ feed: "候補", text: `${c.title}。${c.evidence.voteQuestion || ""}。報道ベースの争点候補。` }],
        category: c.category ?? undefined,
      });
      const lopsidedPredicted =
        result.legitimate && isLopsidedByPrediction(result.predictedDivisionScore, c.evidence);
      const row: LegitRow = {
        title: c.title,
        voteQuestion: c.evidence.voteQuestion ?? null,
        legitimate: result.legitimate && !lopsidedPredicted,
        problemType: lopsidedPredicted ? "lopsided_predicted" : result.problemType,
        reason: result.reason,
        suggestedFrames: result.suggestedFrames,
        excerptCount: excerpts.length,
        excerptPreview: excerpts.slice(0, 3).map((e) => `[${e.feed}] ${e.text.slice(0, 80)}`),
        predictedDivisionScore: result.predictedDivisionScore,
        lopsidedPredicted,
      };
      legitRows.push(row);
      const mark = row.legitimate ? "✅通す" : "❌落とす";
      const divisionLabel =
        result.predictedDivisionScore != null
          ? ` (predictedDivisionScore=${result.predictedDivisionScore.toFixed(2)})`
          : "";
      console.log(
        `${mark} ${c.title}\n` +
          `   設問: ${c.evidence.voteQuestion ?? "（なし）"}\n` +
          `   → ${row.problemType}: ${result.reason}${divisionLabel}\n` +
          (result.suggestedFrames.length
            ? `   代案: ${result.suggestedFrames.join(" / ")}\n`
            : "") +
          `   材料${excerpts.length}件: ${excerpts
            .slice(0, 2)
            .map((e) => e.text.slice(0, 50))
            .join(" / ")}`,
      );
    }
  }

  const summary = {
    pendingSampled: audited.length,
    eligible: audited.filter((a) => a.eligible).length,
    passBuzzHeat: passBoth.length,
    selectedForPromote: selected.map((c) => c.title),
    legitimacyPass: legitRows.filter((r) => r.legitimate).length,
    legitimacyFail: legitRows.filter((r) => !r.legitimate).length,
    failBuckets: {
      notEligible: audited.filter((a) => !a.eligible).length,
      buzzLow: audited.filter((a) => a.eligible && a.v2.buzzPrime < BUZZ_MIN_DEFAULT).length,
      heatLow: audited.filter((a) => a.eligible && a.v2.heatPrime < HEAT_MIN_DEFAULT).length,
      productLow: audited.filter(
        (a) =>
          a.eligible &&
          a.v2.buzzPrime >= BUZZ_MIN_DEFAULT &&
          a.v2.heatPrime >= HEAT_MIN_DEFAULT &&
          a.v2.rankScore < RANK_MIN_DEFAULT,
      ).length,
    },
  };

  console.log("\n========== サマリー（課題の種） ==========");
  console.log(JSON.stringify(summary, null, 2));

  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "../_selection_v2_audit.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        yahooTop: yahoo.slice(0, 15).map((y) => ({ term: y.term, tweetCount: y.tweetCount })),
        summary,
        passBoth,
        selected: selected.map((c) => ({
          title: c.title,
          voteQuestion: c.evidence.voteQuestion,
          ...selectionV2RankScore(c.evidence),
        })),
        droppedTop: byRank.filter((a) => !(a.eligible && a.passRank)).slice(0, 20),
        legitimacy: legitRows,
        all: byRank,
      },
      null,
      2,
    ),
  );
  console.log(`\n詳細JSON: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
