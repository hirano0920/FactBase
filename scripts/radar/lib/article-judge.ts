/**
 * 記事評価ハーネス（eval-articles.ts）用のLLM-as-judge。
 * 書き手（grok-4.3、radar-article.ts）とは別モデル（gpt-5-mini）で採点することで、
 * 同一モデルの自己採点による循環（検索・幻覚をそのまま自己承認してしまう）を避ける。
 */
import { z } from "zod";
import { createOpenAIClient } from "../../../src/lib/openai-client";
import { AI_MODELS, RADAR } from "../../../src/lib/constants";
import { repairSideSectionsWithMini } from "../../../src/lib/article-repair";

const JUDGE_SYSTEM = `あなたはニュース記事の品質を評価する編集デスクです。
渡された記事（一言まとめ・記事本文）を、以下7つの観点でそれぞれ1〜5点で採点してください。

# 採点観点
1. bothSidesQuality（両論性・最重要）: 賛成/反対両方の最強の理由が公平に、具体的に書かれているか。
   どちらかが弱い・存在しない・不公平に書かれている場合は低評価。
   ★片側だけ報道の具体手口・数字があり、もう片側が「国際競争力」「現行法で十分」「慎重にすべき」等の
   教科書一般論・帰属なしスローガンだけの場合は2点以下。両側とも媒体・発言者など帰属付きなら高評価。
2. factualGrounding（事実正確性・出典整合）: 記事内の具体的事実が出典・資料に基づいているように見えるか。
   数字や固有名詞の唐突な断定・根拠不明な記述があれば低評価。
3. neutrality（中立性・非煽り）: 断定的・扇動的な表現がなく、中立的なトーンか。
4. relatability（自分ごと度）: 読者が「自分に関係がある」と感じられる具体性があるか。
   タイトルに貿易・円・燃料・年金・SNS等のフックがあるのに本文・対立軸に波及が無い場合は低評価。
5. depth（情報の厚み）: 単なる見出しの言い換えでなく、実質のある内容か。
   「トラブルを巡る報道」「双方が対立」だけで事件内容が後段まで出てこない記事は1〜2点。
6. clarity（構造・わかりやすさ）: 冒頭で「何が起きたか／何が報じられたか」が分かるか。
   否定・反応が先で事件内容が後ろの記事、同じ事実の繰り返しが多い記事は低評価。
   一言まとめと冒頭セクションが別内容になっている記事も低評価。
7. titleHook（タイトルの引き）: タイトルが具体的で読みたくなるか（曖昧・抽象的でないか）。

各観点についてscore（1〜5の整数）とreason（40字以内の日本語）を返してください。
必ずJSONのみで回答してください。`;

/** 本番品質ゲート用（ゲート軸だけ採点してトークンを抑える） */
const GATE_JUDGE_SYSTEM = `あなたはニュース記事の品質を評価する編集デスクです。
渡された記事（一言まとめ・記事本文）を、以下4つの観点でそれぞれ1〜5点で採点してください。

# 採点観点
1. bothSidesQuality（両論性・最重要）: 賛成/反対両方の最強の理由が公平に、具体的に書かれているか。
   どちらかが弱い・存在しない・不公平に書かれている場合は低評価。
   ★片側だけ報道の具体手口・数字があり、もう片側が「国際競争力」「現行法で十分」「慎重にすべき」等の
   教科書一般論・帰属なしスローガンだけの場合は2点以下。両側とも媒体・発言者など帰属付きなら高評価。
2. neutrality（中立性・非煽り）: 断定的・扇動的な表現がなく、中立的なトーンか。
3. depth（情報の厚み）: 単なる見出しの言い換えでなく、実質のある内容か。
   「トラブルを巡る報道」「双方が対立」だけで事件内容が後段まで出てこない記事は1〜2点。
4. clarity（構造・わかりやすさ）: 冒頭で「何が起きたか／何が報じられたか」が分かるか。
   否定・反応が先で事件内容が後ろの記事、同じ事実の繰り返しが多い記事は低評価。
   一言まとめと冒頭セクションが別内容になっている記事も低評価。

各観点についてscore（1〜5の整数）とreason（40字以内の日本語）を返してください。
必ずJSONのみで回答してください。`;

const JUDGE_SCHEMA = z.object({
  bothSidesQuality: z.object({ score: z.number(), reason: z.string() }),
  factualGrounding: z.object({ score: z.number(), reason: z.string() }),
  neutrality: z.object({ score: z.number(), reason: z.string() }),
  relatability: z.object({ score: z.number(), reason: z.string() }),
  depth: z.object({ score: z.number(), reason: z.string() }),
  clarity: z.object({ score: z.number(), reason: z.string() }),
  titleHook: z.object({ score: z.number(), reason: z.string() }),
});

const GATE_JUDGE_SCHEMA = z.object({
  bothSidesQuality: z.object({ score: z.number(), reason: z.string() }),
  neutrality: z.object({ score: z.number(), reason: z.string() }),
  depth: z.object({ score: z.number(), reason: z.string() }),
  clarity: z.object({ score: z.number(), reason: z.string() }),
});

export type ArticleJudgeScore = z.infer<typeof JUDGE_SCHEMA>;

export const JUDGE_AXES = [
  "bothSidesQuality",
  "factualGrounding",
  "neutrality",
  "relatability",
  "depth",
  "clarity",
  "titleHook",
] as const satisfies readonly (keyof ArticleJudgeScore)[];

/** JSONパース失敗・スキーマ不一致時は各軸1点+理由「採点失敗」にフォールバックする（0点で平均を壊さないため1点を最低点に） */
export function parseJudgeResponse(raw: string): ArticleJudgeScore {
  try {
    const json = JSON.parse(raw) as unknown;
    const parsed = JUDGE_SCHEMA.safeParse(json);
    if (parsed.success) {
      return {
        ...parsed.data,
        ...Object.fromEntries(
          JUDGE_AXES.map((axis) => [
            axis,
            { ...parsed.data[axis], score: clampScore(parsed.data[axis].score) },
          ]),
        ),
      } as ArticleJudgeScore;
    }
  } catch {
    // フォールスルー
  }
  return Object.fromEntries(
    JUDGE_AXES.map((axis) => [axis, { score: 1, reason: "採点失敗（JSON解析エラー）" }]),
  ) as ArticleJudgeScore;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, Math.round(n)));
}

/** 7軸の単純平均（bothSidesQualityを重視したい場合は呼び出し側で別途重み付けする） */
export function averageScore(score: ArticleJudgeScore): number {
  const total = JUDGE_AXES.reduce((sum, axis) => sum + score[axis].score, 0);
  return Math.round((total / JUDGE_AXES.length) * 100) / 100;
}

export interface ArticleForJudge {
  title: string;
  lead: string;
  articleHtml: string;
}

/**
 * 本番公開ゲート用に見る軸。
 * 両論・中立に加え、見出しの言い換えだけの薄い記事（depth）と構造のわかりにくさ（clarity）も落とす。
 * relatability / titleHook / factualGrounding は議論場の最低条件ではないためゲート外
 * （factualGroundingはclaims機械検証側で担保。relatabilityは構造チェック側で補助）。
 * bothSidesQuality だけは judgeBothSidesMinScore（既定4）で一段厳しくする。
 */
export const QUALITY_GATE_AXES = [
  "bothSidesQuality",
  "neutrality",
  "depth",
  "clarity",
] as const satisfies readonly (keyof ArticleJudgeScore)[];

export interface QualityGateResult {
  ok: boolean;
  score: ArticleJudgeScore;
  /** ok=falseの場合の不合格理由（軸=点数(reason) の一覧） */
  reason: string | null;
}

function minScoreForAxis(axis: (typeof QUALITY_GATE_AXES)[number]): number {
  if (axis === "bothSidesQuality") return RADAR.judgeBothSidesMinScore;
  return RADAR.judgeQualityGateMinScore;
}

/** judge採点済みスコアから合否を機械的に判定する（純関数・テスト用に分離） */
export function gateFromScore(score: ArticleJudgeScore): QualityGateResult {
  const failing = QUALITY_GATE_AXES.filter(
    (axis) => score[axis].score < minScoreForAxis(axis),
  );
  if (failing.length === 0) return { ok: true, score, reason: null };
  const reason = failing.map((axis) => `${axis}=${score[axis].score}(${score[axis].reason})`).join(" / ");
  return { ok: false, score, reason };
}

/**
 * 本番生成ループ（detect.ts/promote.ts）から同期的に呼ぶ品質ゲート。
 * bothSidesQualityがjudgeBothSidesMinScore未満、または他ゲート軸がjudgeQualityGateMinScore未満ならHELD。
 * 呼び出し側はnano失敗時にfail-open（公開続行）する運用を想定し、ここでは例外をそのまま投げる。
 */
export async function checkArticleQualityGate(article: ArticleForJudge): Promise<QualityGateResult> {
  try {
    const score = await judgeArticleForGate(article);
    return gateFromScore(score);
  } catch (e) {
    console.warn(`  ⚠️ 品質ゲートのjudge失敗（fail-open・公開続行）: ${e}`);
    return {
      ok: true,
      score: {
        bothSidesQuality: { score: 3, reason: "judge失敗（fail-open）" },
        neutrality: { score: 3, reason: "judge失敗（fail-open）" },
        depth: { score: 3, reason: "judge失敗（fail-open）" },
        clarity: { score: 3, reason: "judge失敗（fail-open）" },
        factualGrounding: { score: 3, reason: "judge失敗（fail-open）" },
        relatability: { score: 3, reason: "judge失敗（fail-open）" },
        titleHook: { score: 3, reason: "judge失敗（fail-open）" },
      },
      reason: null,
    };
  }
}

/**
 * 品質ゲート不合格時に両側だけ mini で直して一度再判定する。
 * 全文 Grok 再生成より安く、bothSidesQuality 不足のHELDを減らす。
 * 検証ループ内で既に mini 修理済みなら二重呼び出ししない。
 * 修理してもなお不合格の場合は、同じ記事をもう一度別枠でジャッジし直す
 * （2026-07-18: 単発nano/mini judgeのブレによる誤検知HELDが多かったため、
 *  1回の不合格だけでは確定させず、2回連続で同じ軸が閾値未満になった場合だけ
 *  confirmed=trueとする。1回目と2回目で結果が割れた場合はブレとみなし合格扱いにする）。
 * 呼び出し側は confirmed=true の場合だけHELDにしてよい。
 */
export async function checkArticleQualityGateWithRepair(
  article: { title: string; lead: string; articleHtml: string },
  repairHints: string[],
  options?: { sideRepairAlreadyUsed?: boolean },
): Promise<{ gate: QualityGateResult; articleHtml: string; repaired: boolean; confirmed: boolean }> {
  const gate = await checkArticleQualityGate(article);
  if (gate.ok) return { gate, articleHtml: article.articleHtml, repaired: false, confirmed: false };

  const bothSidesFail = gate.reason?.includes("bothSidesQuality");
  const canRepair = bothSidesFail && repairHints.length > 0 && !options?.sideRepairAlreadyUsed;

  let finalGate = gate;
  let finalHtml = article.articleHtml;
  let repaired = false;

  if (canRepair) {
    try {
      const repairedHtml = await repairSideSectionsWithMini({
        issueTitle: article.title,
        articleHtml: article.articleHtml,
        sourceHints: repairHints,
        failureReason: gate.reason,
      });
      if (repairedHtml) {
        const gate2 = await checkArticleQualityGate({ ...article, articleHtml: repairedHtml });
        if (gate2.ok) {
          return { gate: gate2, articleHtml: repairedHtml, repaired: true, confirmed: false };
        }
        finalGate = gate2;
        finalHtml = repairedHtml;
      }
    } catch {
      // 修理失敗時は元のgateのまま確認ジャッジに進む
    }
  }

  // ここまで来た時点でまだ不合格。単発judgeのブレを疑い、もう一度独立にジャッジして確認する。
  try {
    const confirmGate = await checkArticleQualityGate({ ...article, articleHtml: finalHtml });
    if (confirmGate.ok) {
      // 1回目と2回目で結果が割れた＝ブレの可能性が高いので合格扱いにする
      return { gate: confirmGate, articleHtml: finalHtml, repaired, confirmed: false };
    }
    return { gate: confirmGate, articleHtml: finalHtml, repaired, confirmed: true };
  } catch {
    // 確認judgeが例外なら確定できないので、確認できなかった扱い（呼び出し側はfail-soft運用）
    return { gate: finalGate, articleHtml: finalHtml, repaired, confirmed: false };
  }
}

/** gpt-5-mini（書き手の grok-4.3 とは別モデル）で記事を採点する（eval用・7軸） */
export async function judgeArticle(article: ArticleForJudge): Promise<ArticleJudgeScore> {
  const openai = createOpenAIClient({ timeout: 60_000, maxRetries: 2 });
  const res = await openai.chat.completions.create({
    model: AI_MODELS.topicFilter,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      {
        role: "user",
        content: `タイトル: ${article.title}\n一言まとめ: ${article.lead}\n\n記事本文（HTML）:\n${article.articleHtml}`,
      },
    ],
  });
  return parseJudgeResponse(res.choices[0]?.message?.content ?? "{}");
}

/**
 * 本番品質ゲート用: ゲート軸4つだけ採点（トークン削減）。
 * 非ゲート軸は機械検証側で担保済みのため、平均用に中立点3を埋める。
 */
export async function judgeArticleForGate(article: ArticleForJudge): Promise<ArticleJudgeScore> {
  const openai = createOpenAIClient({ timeout: 60_000, maxRetries: 2 });
  const res = await openai.chat.completions.create({
    model: AI_MODELS.topicFilter,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: GATE_JUDGE_SYSTEM },
      {
        role: "user",
        content: `タイトル: ${article.title}\n一言まとめ: ${article.lead}\n\n記事本文（HTML）:\n${article.articleHtml}`,
      },
    ],
  });
  return parseGateJudgeResponse(res.choices[0]?.message?.content ?? "{}");
}

/** ゲート用4軸JSONを ArticleJudgeScore に正規化（欠落軸はゲート対象外として3点） */
export function parseGateJudgeResponse(raw: string): ArticleJudgeScore {
  try {
    const json = JSON.parse(raw) as unknown;
    const parsed = GATE_JUDGE_SCHEMA.safeParse(json);
    if (parsed.success) {
      const filler = { score: 3, reason: "ゲート対象外" };
      return {
        bothSidesQuality: {
          ...parsed.data.bothSidesQuality,
          score: clampScore(parsed.data.bothSidesQuality.score),
        },
        neutrality: {
          ...parsed.data.neutrality,
          score: clampScore(parsed.data.neutrality.score),
        },
        depth: { ...parsed.data.depth, score: clampScore(parsed.data.depth.score) },
        clarity: { ...parsed.data.clarity, score: clampScore(parsed.data.clarity.score) },
        factualGrounding: filler,
        relatability: filler,
        titleHook: filler,
      };
    }
  } catch {
    // フォールスルー
  }
  return Object.fromEntries(
    JUDGE_AXES.map((axis) => [axis, { score: 1, reason: "採点失敗（JSON解析エラー）" }]),
  ) as ArticleJudgeScore;
}
