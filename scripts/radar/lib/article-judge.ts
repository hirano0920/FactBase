/**
 * 記事評価ハーネス（eval-articles.ts）用のLLM-as-judge。
 * 書き手（grok-4.3、radar-article.ts）とは別モデル（gpt-5-mini）で採点することで、
 * 同一モデルの自己採点による循環（検索・幻覚をそのまま自己承認してしまう）を避ける。
 */
import { z } from "zod";
import { createOpenAIClient } from "../../../src/lib/openai-client";
import { AI_MODELS, RADAR } from "../../../src/lib/constants";

const JUDGE_SYSTEM = `あなたはニュース記事の品質を評価する編集デスクです。
渡された記事（一言まとめ・記事本文）を、以下7つの観点でそれぞれ1〜5点で採点してください。

# 採点観点
1. bothSidesQuality（両論性・最重要）: 賛成/反対両方の最強の理由が公平に、具体的に書かれているか。
   どちらかが弱い・存在しない・不公平に書かれている場合は低評価。
2. factualGrounding（事実正確性・出典整合）: 記事内の具体的事実が出典・資料に基づいているように見えるか。
   数字や固有名詞の唐突な断定・根拠不明な記述があれば低評価。
3. neutrality（中立性・非煽り）: 断定的・扇動的な表現がなく、中立的なトーンか。
4. relatability（自分ごと度）: 読者が「自分に関係がある」と感じられる具体性があるか。
5. depth（情報の厚み）: 単なる見出しの言い換えでなく、実質のある内容か。
   「トラブルを巡る報道」「双方が対立」だけで事件内容が後段まで出てこない記事は1〜2点。
6. clarity（構造・わかりやすさ）: 冒頭で「何が起きたか／何が報じられたか」が分かるか。
   否定・反応が先で事件内容が後ろの記事、同じ事実の繰り返しが多い記事は低評価。
7. titleHook（タイトルの引き）: タイトルが具体的で読みたくなるか（曖昧・抽象的でないか）。

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
 * （factualGroundingはclaims機械検証側で担保）。
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

/** judge採点済みスコアから合否を機械的に判定する（純関数・テスト用に分離） */
export function gateFromScore(score: ArticleJudgeScore): QualityGateResult {
  const failing = QUALITY_GATE_AXES.filter(
    (axis) => score[axis].score < RADAR.judgeQualityGateMinScore,
  );
  if (failing.length === 0) return { ok: true, score, reason: null };
  const reason = failing.map((axis) => `${axis}=${score[axis].score}(${score[axis].reason})`).join(" / ");
  return { ok: false, score, reason };
}

/**
 * 本番生成ループ（detect.ts/promote.ts）から同期的に呼ぶ品質ゲート。
 * bothSidesQuality/neutralityがjudgeQualityGateMinScore未満なら公開不可（HELDへ）と判定する。
 * 呼び出し側はnano失敗時にfail-open（公開続行）する運用を想定し、ここでは例外をそのまま投げる。
 */
export async function checkArticleQualityGate(article: ArticleForJudge): Promise<QualityGateResult> {
  const score = await judgeArticle(article);
  return gateFromScore(score);
}

/** gpt-5-mini（書き手の grok-4.3 とは別モデル）で記事を採点する */
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
