/**
 * 記事品質評価スクリプト（ルーブリックv1 採点）。
 * 直近N件のPublished記事をルーブリックで採点し、軸別の問題を抽出する。
 *
 * 使い方:
 *   npx tsx scripts/eval/grade-articles.ts             # デフォルト: 直近5件
 *   npx tsx scripts/eval/grade-articles.ts --limit 3     # 件数指定
 *   npx tsx scripts/eval/grade-articles.ts --regen       # 低スコア記事を再生成
 *   npx tsx scripts/eval/grade-articles.ts --limit 10 --regen
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { prisma } from "../../src/lib/prisma";
import { AI_MODELS } from "../../src/lib/constants";
import { createOpenAIClient } from "../../src/lib/openai-client";

// ローカル実行用: tsx は .env を自動ロードしないため .env.local / .env を読む
(function loadLocalEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const name of [".env.local", ".env"]) {
    const p = resolve(root, name);
    if (existsSync(p)) {
      try { process.loadEnvFile(p); } catch { /* noop */ }
    }
  }
})();

// ─── ルーブリック軸定義 ───────────────────────────

const AXES = [
  "hook",
  "title",
  "bothSides",
  "alignment",
  "attribution",
  "density",
  "voteChoices",
  "readability",
  "evidence",
  "debateFlow",
] as const;

type Axis = (typeof AXES)[number];

const WEIGHTS: Record<Axis, number> = {
  hook: 1,
  title: 1,
  bothSides: 2,
  alignment: 1,
  attribution: 1,
  density: 1,
  voteChoices: 1,
  readability: 1,
  evidence: 1,
  debateFlow: 1,
};

const EVAL_SYSTEM = `あなたはプロの政治ジャーナリズム編集者です。ニュース記事の品質を10軸・各1〜5点で採点し、具体的な改善点を指摘してください。

# 採点ルール
- 点数は**整数**（1〜5）で厳密に。
- reasonは**具体的な問題点を日本語30字以内**で。
- 全体としてプロが書いた記事として通用するかが判断基準。
- 「AIが書いた」と読者が気づくようなテンプレ表現には厳しく減点。

# 採点軸

## 1. hook（リードのフック力）
5: 冒頭1文で「何が起きたか・なぜ争点か・自分に関係あるか」の3要素。専門用語は即座に言い換え
4: 争点の核心に触れているが、一般読者への波及が弱い／専門用語をそのまま使っている
3: 正しいが教科書的。「〜を巡る議論」等の抽象切り出し
2: ニュース性が伝わらない／背景説明から始まる
1: リード無し／タイトルのコピペ／「問題になっています」型

## 2. title（タイトルの一般人クリック率 ★重要）
5: 専門用語を説明なしで使わず、一般読者に意味が通る。「自分に関係ある」と思わせる生活フックがある
4: 固有名詞はあるが専門用語を説明なしで使っている（「GPIF」を「年金運用機関」と説明していない等）
3: 固有名詞がなく抽象的だが、わかりやすい生活フックでカバーしている
2: 固有名詞がなく抽象的。読者が「よくわからないからスルー」する
1: 固有名詞ゼロ・フックゼロ／クリックベイト／キャッチコピー風

## 3. bothSides（両論のフェアネス ★最重要）
5: 両側3〜4項目・同分量・同根拠密度。各項目に帰属あり
4: 両側十分だがやや片側が薄い
3: 両側あるが片側が一般論埋め（「懸念」「必要」だけ）
2: 片側だけ具体的／スローガン2項目／極端な分量差
1: 片側欠落／「反対意見もあるようです」／同じことの繰り返し

## 4. alignment（論点の一致）
5: 両側とも設問に真っ向から賛否。完全一致
4: 概ね一致。片側がやや前提をずらすが実質対立
3: 設問と片側の芯が少しズレている
2: 両側が別の側面を言っていて噛み合わない
1: 設問と両セクションが別の話

## 5. attribution（帰属の品質）
5: 各主張に帰属あり。連続2文目以降は省略。リードに無駄な帰属なし
4: 帰属はあるが一部冗長／リードはすっきり
3: リードは良いが両セクションの半分以上に帰属なし（一般論）
2: 教科書的一般論で両セクション埋まっている
1: 帰属皆無／ソース不明の断定

## 6. density（情報密度）
5: 各セクションが固有の情報。重複ほぼ無し
4: 一部重複あるが各セクション役割を果たしている
3: 冒頭と両セクションで同じ事実が1〜2回繰り返される
2: 複数セクションで同じ事実が繰り返し書かれている
1: 全セクション同じ内容の言い換え

## 7. voteChoices（投票選択肢の現実味）
5: 具体的な行為/立場を指す選択肢。「支持する」ではなく「賛成派の意見を聞きたい」等
4: やや抽象寄りだが争点固有の要素を含む
3: 「賛成」「反対」のデフォルトを少し具体化している
2: 「賛成」「反対」「わからない」のデフォルトラベル／政党名入り
1: 選択肢が設問と対応していない／第三の立場が無視されている

## 8. readability（読みやすさ）
5: 一文適度（60字以内）。h2過不足なく使われ、箇条書きと段落が適切に使い分け
4: 概ね良いが一部やや長い文や段落あり
3: 一部に100字超の文がある／h2粒度がやや不適切
2: 150字超の文が複数／段落だらけで箇条書きが少ない
1: 長文段落のみ／h2が無い／HTML構造が崩れている

## 9. evidence（証拠の厚みと多様性）
5: 3社以上の独立ソース。両論とも複数の出典で裏付け
4: 2社以上、両論ともソースあり
3: 2社以上あるが一方の論拠が実質1ソース
2: 実質1ソースのみ／ソースが全て同じ系統
1: ソース1つ／裏付けなしの主張が目立つ／Wikipediaで補完

## 10. debateFlow（議論の導線設計）
5: 「まだ分からないこと」が核心を突く。両論拮抗で読者が決断迫られる
4: 未確定点は具体的だが議論の接戦感がやや弱い
3: 未確定点はあるが日常会話レベル
2: 未確定がテンプレ「今後の動向を注視」のみ
1: 一方的結論／議論の余地なし／「まだ分からないこと」が欠落

# 加点・減点
- タイムライン形式秀逸: +1（時系列整理が過不足なく日付順）
- 海外報道が国内議論を補完: +1（単なる海外ニュースの転載ではない）
- 公的統計/法律条文の具体的引用: +1（e-Stat/日銀/法律条文を具体的な議論に使っている）
- 冒頭とleadの内容ズレ: -2（leadと「いま何が論点か」が同じ内容になっていない）
- 帰属不明の主張が3つ以上: -1/件（「〜とされる」「〜との見方」等の無主観表現）
- 根拠無い数字・固有名詞: -2/件（資料に無い具体値が断定で書かれている）

# 出力形式
必ず以下のJSONのみで返すこと:
{
  "scores": {
    "hook": {"score": 1-5, "reason": "30字以内の日本語"},
    "title": {"score": 1-5, "reason": "..."},
    "bothSides": {"score": 1-5, "reason": "..."},
    "alignment": {"score": 1-5, "reason": "..."},
    "attribution": {"score": 1-5, "reason": "..."},
    "density": {"score": 1-5, "reason": "..."},
    "voteChoices": {"score": 1-5, "reason": "..."},
    "readability": {"score": 1-5, "reason": "..."},
    "evidence": {"score": 1-5, "reason": "..."},
    "debateFlow": {"score": 1-5, "reason": "..."}
  },
  "bonus": 0-3,
  "penalty": 0-5,
  "summary": "全体所感（100字以内の日本語）",
  "topIssue": "最も深刻な問題1つ（50字以内）"
}`;

const EVAL_SCHEMA = z.object({
  scores: z.record(
    z.object({ score: z.number(), reason: z.string() }),
  ),
  bonus: z.number().min(0).max(3),
  penalty: z.number().min(0).max(5),
  summary: z.string(),
  topIssue: z.string(),
});

// ─── メイン ───────────────────────────

const LIMIT = parseInt(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "5", 10);
const SHOULD_REGEN = process.argv.includes("--regen");

function guessSummaryJson(summaryJson: unknown): { lead: string; bullets: string[] } {
  if (summaryJson && typeof summaryJson === "object") {
    const obj = summaryJson as Record<string, unknown>;
    return {
      lead: typeof obj.lead === "string" ? obj.lead : "",
      bullets: Array.isArray(obj.bullets) ? obj.bullets.filter((b): b is string => typeof b === "string") : [],
    };
  }
  return { lead: "", bullets: [] };
}

async function main() {
  console.log(`\n📊 記事品質評価（ルーブリックv1）— 直近${LIMIT}件`);

  const issues = await prisma.issue.findMany({
    where: {
      articleHtml: { not: null },
      confirmation: { in: ["REPORTED", "OFFICIAL"] },
    },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      slug: true,
      title: true,
      shareTitle: true,
      summaryJson: true,
      articleHtml: true,
      voteLabelsJson: true,
      createdAt: true,
    },
  });

  if (issues.length === 0) {
    console.log("  評価可能な記事がありません");
    await prisma.$disconnect();
    return;
  }

  const openai = createOpenAIClient({ timeout: 90_000, maxRetries: 1 });
  const results: {
    title: string;
    raw: number;
    pct: number;
    topIssue: string;
    summary: string;
    detail: string;
    scores: Record<string, number>;
  }[] = [];

  for (const issue of issues) {
    const summary = guessSummaryJson(issue.summaryJson);
    const voteLabels = issue.voteLabelsJson
      ? (issue.voteLabelsJson as Record<string, string>)
      : undefined;

    console.log(`\n━━━ ${issue.title}（${issue.createdAt.toLocaleDateString("ja-JP")}）━━━`);

    const articlePreview = [
      `タイトル: ${issue.title}`,
      `SHAREタイトル: ${issue.shareTitle ?? "(なし)"}`,
      `リード: ${summary.lead.slice(0, 200) || "(なし)"}`,
      `要点: ${summary.bullets.join(" | ").slice(0, 300) || "(なし)"}`,
      voteLabels
        ? `投票選択肢: 賛成=${voteLabels.for ?? "?"} / 反対=${voteLabels.against ?? "?"} / 中立=${voteLabels.undecided ?? "?"}`
        : "投票選択肢: (なし)",
      `本文(先頭2000字): ${(issue.articleHtml ?? "").replace(/<[^>]+>/g, "").slice(0, 2000)}`,
    ].join("\n\n");

    try {
      const res = await openai.chat.completions.create({
        model: AI_MODELS.topicFilter,
        messages: [
          { role: "system", content: EVAL_SYSTEM },
          { role: "user", content: articlePreview },
        ],
        response_format: { type: "json_object" },
      });

      const raw = res.choices[0]?.message?.content ?? "{}";
      const scores = EVAL_SCHEMA.parse(JSON.parse(raw));

      // 加重素点計算
      let weightedTotal = 0;
      let weightSum = 0;
      const scoreMap: Record<string, number> = {};
      for (const axis of AXES) {
        const s = scores.scores[axis];
        const score = Math.min(5, Math.max(1, Math.round(s?.score ?? 1)));
        scoreMap[axis] = score;
        weightedTotal += score * WEIGHTS[axis];
        weightSum += WEIGHTS[axis];
      }
      const baseScore = weightedTotal / weightSum;
      const pct = Math.round((baseScore / 5) * 100);

      // 加点減点
      const bonus = Math.min(3, Math.max(0, scores.bonus));
      const penalty = Math.min(5, Math.max(0, scores.penalty));
      const adjusted = Math.max(1, Math.min(5, baseScore + bonus * 0.2 - penalty * 0.2));
      const finalPct = Math.round((adjusted / 5) * 100);

      console.log(`  📈 総合: ${finalPct}点（加重平均${baseScore.toFixed(1)}/5, bonus+${bonus}, penalty-${penalty}）`);
      for (const axis of AXES) {
        const s = scores.scores[axis];
        const stars = "⭐".repeat(Math.min(5, Math.max(1, s?.score ?? 1)));
        console.log(`    ${axis.padEnd(12)} ${s?.score ?? "?"} ${stars}  ${s?.reason ?? ""}`);
      }
      console.log(`  💬 ${scores.summary}`);
      console.log(`  🔴 最優先課題: ${scores.topIssue}`);

      results.push({
        title: issue.title,
        raw: adjusted,
        pct: finalPct,
        topIssue: scores.topIssue,
        summary: scores.summary,
        detail: AXES.map((a) => `${a}:${scores.scores[a]?.score}－${scores.scores[a]?.reason}`).join(" | "),
        scores: scoreMap,
      });
    } catch (e) {
      console.warn(`  ⚠️ 採点失敗: ${e}`);
    }
  }

  // ─── サマリー ───────────────────
  if (results.length > 0) {
    const avgPct = Math.round(results.reduce((s, r) => s + r.pct, 0) / results.length);
    const topIssueCounts: Record<string, number> = {};
    for (const r of results) {
      const key = r.topIssue.slice(0, 30);
      topIssueCounts[key] = (topIssueCounts[key] ?? 0) + 1;
    }
    const sorted = Object.entries(topIssueCounts).sort((a, b) => b[1] - a[1]);

    // 軸別平均
    const axisAvg: Record<string, number> = {};
    for (const axis of AXES) {
      const vals = results.map((r) => r.scores[axis]).filter((v) => v != null);
      axisAvg[axis] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
    const worstAxes = Object.entries(axisAvg)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3);

    console.log("\n" + "=".repeat(60));
    console.log(`📊 評価サマリー（${results.length}件）`);
    console.log(`  平均: ${avgPct}点`);
    console.log(`  弱い軸トップ3:`);
    for (const [axis, avg] of worstAxes) {
      const bar = "▓".repeat(Math.round(avg));
      console.log(`    ${axis.padEnd(12)} ${avg.toFixed(1)} ${bar}`);
    }
    console.log(`  よくある問題:`);
    sorted.slice(0, 3).forEach(([issue, count], i) => {
      console.log(`    ${i + 1}. 「${issue}」— ${count}/${results.length}件`);
    });
    console.log("=".repeat(60));

    // CSV保存
    const csvLine = [
      new Date().toISOString(),
      LIMIT,
      avgPct,
      ...results.map((r) => r.pct),
      ...worstAxes.map(([a]) => a),
      ...sorted.slice(0, 3).map(([i]) => i),
    ].join(",");
    try {
      const fs = await import("fs");
      fs.appendFileSync("eval-results.csv", csvLine + "\n");
      console.log("  📁 eval-results.csv に追記");
    } catch {
      // ignore
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
