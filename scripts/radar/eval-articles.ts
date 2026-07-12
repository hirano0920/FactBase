/**
 * Radar記事生成の評価ハーネス（ゴールデンセット）。
 *
 * 実行: npx tsx scripts/radar/eval-articles.ts [--limit N] [--topic "任意のトピック語"] [--json]
 *
 * 目的: プロンプト（radar-article.ts）を変更するたびに「本番アルゴリズムで何十個も作って改善」を
 * 目視だけでやるとリグレッションに気づけない。同じ固定トピック20件強で、変更前後をリンゴ対リンゴ比較する。
 *
 * 本番DBには一切書き込まない（researchTopicはSourceEvent/Issueの読み取りのみ）。
 *
 * 3層評価:
 *   1. 自動（0円）: generateVerifiedArticleの内部でfindUngroundedNumbers/findUnclaimedHighlights/
 *      violatesBanを実行済み。ここではverified/attempts/unresolvedClaimsをそのまま集計する
 *   2. LLM-as-judge: 書き手(grok-4.3)とは別モデル(gpt-5-mini)が7軸を1〜5点+理由で採点（lib/article-judge.ts）
 *   3. 人間キャリブレーション: このスクリプトの出力（特にjson出力）を人間が読んでjudgeを較正する。
 *      このスクリプト自体はスコアカードを出すところまでが範囲
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// tsx は .env.local を自動ロードしない。prisma に触る前に読む（CI では secrets が既にあるので no-op）
function loadLocalEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
    } catch {
      // Node が古い等で loadEnvFile が無い場合は握りつぶす
    }
  }
}
loadLocalEnv();

import { prisma } from "../../src/lib/prisma";
import { RADAR } from "../../src/lib/constants";
import { researchTopic, isEmptyEvidence, evaluateBuzzPromoteSufficiency } from "./lib/research";
import { generateVerifiedArticle } from "../../src/lib/radar-article";
import { judgeArticle, averageScore, JUDGE_AXES, type ArticleJudgeScore } from "./lib/article-judge";
import { fetchReportExcerpts } from "./lib/report-text";

interface GoldenTopic {
  topic: string;
  category: string;
  note: string;
}

/**
 * 固定ゴールデンセット。カテゴリ横断・OFFICIAL/REPORTED相当・速報型/スローバーン型を含む。
 * プロンプト変更の前後比較は必ずこの同じセット（またはサブセット）で行う。
 * セット自体を変えると過去のスコアと比較できなくなるため、追加はよいが既存項目の書き換えは避ける。
 */
export const GOLDEN_TOPICS: GoldenTopic[] = [
  { topic: "日銀の政策金利判断", category: "finance", note: "金融政策・数値中心" },
  { topic: "防衛費のGDP比引き上げ", category: "politics", note: "予算・安保" },
  { topic: "選択的夫婦別姓制度の法改正", category: "law", note: "法案・価値観の対立" },
  { topic: "入管法改正の外国人労働者への影響", category: "rights", note: "法案・人権" },
  { topic: "消費税減税をめぐる与野党対立", category: "economy", note: "スローバーン・与野党対立" },
  { topic: "米国の対中関税引き上げ", category: "international", note: "国際・経済安保" },
  { topic: "ウクライナ情勢の停戦交渉", category: "international", note: "国際・速報型" },
  { topic: "台湾有事を想定した安保対応", category: "international", note: "安保・シミュレーション" },
  { topic: "最低賃金引き上げ論議", category: "economy", note: "スローバーン・生活直結" },
  { topic: "選挙制度改革をめぐる議論", category: "politics", note: "法案・制度論" },
  { topic: "原発再稼働の是非", category: "politics", note: "スローバーン・エネルギー" },
  { topic: "教育無償化の対象拡大", category: "education", note: "予算・自分ごと度高い" },
  { topic: "円安の家計への影響", category: "finance", note: "経済・自分ごと度最重要ケース" },
  { topic: "国会議員の政治資金問題", category: "politics", note: "スキャンダル・報道ベース" },
  { topic: "裁判所の重要判決", category: "law", note: "司法・確定事実" },
  { topic: "大規模な自然災害への政府対応", category: "society", note: "災害・公式発表" },
  { topic: "AI技術規制の法整備", category: "law", note: "新興分野・国際比較あり" },
  { topic: "少子化対策の予算配分", category: "society", note: "予算・長期論点" },
  { topic: "芸能事務所と所属タレントの契約解除を巡る声明対立", category: "entertainment", note: "声明対立型（新設カテゴリの動作確認）" },
  {
    topic: "著名人のハラスメント疑惑と本人の反論",
    category: "entertainment",
    note: "声明対立・incidentFirst必須（否定先行の薄い記事を落とす回帰用）",
  },
  { topic: "地方自治体の財政再建計画", category: "economy", note: "地方行政" },
  { topic: "北朝鮮のミサイル発射", category: "international", note: "速報型" },
];

const RESEARCH_LIMITS = {
  kokkaiRecords: RADAR.kokkaiRecords,
  lawRecords: RADAR.lawRecords,
  newsRecords: RADAR.newsRecords,
  internationalNewsRecords: RADAR.internationalNewsRecords,
};

interface TopicScorecard {
  topic: string;
  category: string;
  note: string;
  hasEvidence: boolean;
  distinctNewsOutlets: number;
  verified: boolean;
  attempts: number;
  unresolvedCount: number;
  /** reason 別件数（改善の当たりをつける用） */
  unresolvedByReason: Record<string, number>;
  /** 不合格サンプル（最大5件） */
  unresolvedSamples: { reason: string; text: string; sourceUrl: string }[];
  reportExcerptCount: number;
  judge: ArticleJudgeScore;
  average: number;
}

async function evalOne(t: GoldenTopic): Promise<TopicScorecard | null> {
  const evidence = await researchTopic(t.topic, RESEARCH_LIMITS, prisma);
  if (isEmptyEvidence(evidence)) {
    console.warn(`  ⚠️ 証拠なし（スキップ）: ${t.topic}`);
    return null;
  }
  const suff = evaluateBuzzPromoteSufficiency(evidence);
  const isOfficial = evidence.laws.length > 0 || evidence.officialEvents.length > 0;

  const sources = [...evidence.news, ...evidence.internationalNews].map((n) => ({
    title: n.title,
    url: n.url,
    feed: n.source || "google-news",
    publishedAt: n.pubDate || undefined,
  }));
  // 本番 promote と同じく報道本文を渡す（無いと claims 検証がほぼ全部落ちる）
  const reportExcerpts = isOfficial ? [] : await fetchReportExcerpts(sources);

  const { article, verified, unresolvedClaims, attempts } = await generateVerifiedArticle({
    issueTitle: t.topic,
    isReported: !isOfficial,
    sources,
    reportExcerpts,
    dietSpeeches: evidence.dietSpeeches,
    background: evidence.background,
    laws: evidence.laws,
    estatStats: evidence.estatStats,
  });

  const unresolvedByReason: Record<string, number> = {};
  for (const c of unresolvedClaims) {
    unresolvedByReason[c.reason] = (unresolvedByReason[c.reason] ?? 0) + 1;
  }

  const judge = await judgeArticle({ title: t.topic, lead: article.lead, articleHtml: article.articleHtml });

  return {
    topic: t.topic,
    category: t.category,
    note: t.note,
    hasEvidence: true,
    distinctNewsOutlets: suff.distinctNewsOutlets,
    verified,
    attempts,
    unresolvedCount: unresolvedClaims.length,
    unresolvedByReason,
    unresolvedSamples: unresolvedClaims.slice(0, 5).map((c) => ({
      reason: c.reason,
      text: c.text.slice(0, 80),
      sourceUrl: c.sourceUrl.slice(0, 80),
    })),
    reportExcerptCount: reportExcerpts.length,
    judge,
    average: averageScore(judge),
  };
}

function printScorecard(s: TopicScorecard): void {
  const verifiedMark = s.verified ? "✅" : "⚠️";
  console.log(`\n${verifiedMark} ${s.topic}（${s.category}・${s.note}）`);
  console.log(`   異なる媒体${s.distinctNewsOutlets}件 / 報道抜粋${s.reportExcerptCount}件 / 検証${s.verified ? "合格" : `不合格(${s.unresolvedCount}件)`}（試行${s.attempts}回） / 平均${s.average.toFixed(2)}`);
  if (!s.verified && s.unresolvedCount > 0) {
    const parts = Object.entries(s.unresolvedByReason)
      .map(([r, n]) => `${r}:${n}`)
      .join(" · ");
    console.log(`   不合格内訳: ${parts}`);
    for (const sample of s.unresolvedSamples) {
      console.log(`     - [${sample.reason}] ${sample.text}${sample.sourceUrl ? ` ← ${sample.sourceUrl}` : ""}`);
    }
  }
  for (const axis of JUDGE_AXES) {
    const a = s.judge[axis];
    console.log(`   ${axis}: ${a.score} — ${a.reason}`);
  }
}

function printSummary(scorecards: TopicScorecard[]): void {
  if (scorecards.length === 0) {
    console.log("\n有効なスコアカードがありません（全件で証拠なし）");
    return;
  }
  console.log(`\n=== サマリー（${scorecards.length}件） ===`);
  const verifiedCount = scorecards.filter((s) => s.verified).length;
  console.log(`検証合格率: ${verifiedCount}/${scorecards.length}（${Math.round((verifiedCount / scorecards.length) * 100)}%）`);
  for (const axis of JUDGE_AXES) {
    const avg = scorecards.reduce((sum, s) => sum + s.judge[axis].score, 0) / scorecards.length;
    console.log(`  ${axis}: ${avg.toFixed(2)}`);
  }
  const overall = scorecards.reduce((sum, s) => sum + s.average, 0) / scorecards.length;
  console.log(`総合平均: ${overall.toFixed(2)} / 5`);
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : GOLDEN_TOPICS.length;
  const topicArg = args.indexOf("--topic");
  const asJson = args.includes("--json");

  const targets = topicArg >= 0
    ? [{ topic: args[topicArg + 1], category: "politics", note: "--topic指定" }]
    : GOLDEN_TOPICS.slice(0, limit);

  console.log(`🧪 記事評価ハーネス開始（${targets.length}トピック、モデル: 書き手grok-4.3 / 判定gpt-5-mini）`);

  const scorecards: TopicScorecard[] = [];
  for (const t of targets) {
    try {
      const card = await evalOne(t);
      if (card) {
        scorecards.push(card);
        if (!asJson) printScorecard(card);
      }
    } catch (e) {
      console.error(`  ❌ 失敗: ${t.topic} — ${e}`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(scorecards, null, 2));
  } else {
    printSummary(scorecards);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
