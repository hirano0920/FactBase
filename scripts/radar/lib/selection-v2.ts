/**
 * Selection V2 — Rank スコア（Buzz' × Heat' × DVS'）と公開可否。
 * docs/PIPELINE_SELECTION_V2.md 準拠。
 *
 * 公開には Buzz'/Heat' 下限 + 積下限 + 両論Gate（抜粋後）が必要。
 * DVS' は並び用の独立因子（不明は×1＝ペナルティなし。測れたときだけ効く）。
 */
import type { SavedEvidence } from "./promote-logic";

/** 「特大」SNS熱の目安。実分布で校正する */
export const TWEET_REF = 5000;

/** 積スコアの下限（両方そこそこ必要） */
export const RANK_MIN_DEFAULT = 0.12;

/**
 * Buzz' 下限。0.4 ≒ effectiveScore>=2（クロスソース最低ライン）。
 * 片方だけ高くても、露出が無ければ出さない。
 */
export const BUZZ_MIN_DEFAULT = 0.4;

/**
 * Heat' 下限。コメント副熱量だけでも届く程度だが、完全ゼロ熱は出さない。
 * （tweetCount無しの副熱量キャップ0.55のうち、300コメント程度で約0.084、1000で約0.21）
 */
export const HEAT_MIN_DEFAULT = 0.15;

/**
 * 実測DVSが極端に低いときのソフト下限。
 * 0にすると積が死ぬが、ハードゲートにはせず順位だけ沈める。
 */
export const DVS_SOFT_FLOOR = 0.15;

export interface SelectionV2Breakdown {
  buzzPrime: number;
  heatPrime: number;
  /**
   * @deprecated Conflict'に統合。rankScore計算には使わない。audit/テスト互換性のために残す。
   */
  dvsPrime: number;
  /**
   * Conflict'（対立因子）: DVS信号（poll division, comment friction）から算出する係数。
   * DVS未測定 → 1.0（中立。データ不足を一方的と決めつけない）
   * DVS測定済み → 分断度をそのまま系数に（0〜1、極端な偏りはDVS_SOFT_FLOORで下限保護）
   * ただし熱量の実測がある場合はペナルティなし（tweetCount/commentCountで実際に盛り上がっているのを
   * 分断が低いという理由だけで抑制しない）。
   * claimDiffの食い違い数など「事後的な実測」は researchCandidate で combineConflictPrime により乗算。
   *
   * 2026-07-16: 以前はDVS'を独立因子にしていたが、Grok 4.5改善案の「4掛け算にしない」
   * 原則に従い Conflict' 1因子に統合。rankScore = Buzz' × Heat' × Conflict'（3因子）。
   */
  conflictPrime: number;
  /** claimDiff.conflicts 数から add-on した分（combineConflictPrime適用後）。researchCandidateで設定 */
  combinedConflictPrime?: number;
  claimDiffConflicts?: number;
  rankScore: number;
  /** tweetCount が evidence / 引数にあるか */
  hasTweetCount: boolean;
  tweetCount: number;
  /** 分断シグナルが1つでも実測/予測できたか */
  hasMeasuredDvs: boolean;
}

export type HeatEvidence = Pick<
  SavedEvidence,
  | "commentCount"
  | "commentCountSurge"
  | "externalPoll"
  | "tweetCount"
  | "youtubeCommentCount"
  | "youtubeReplyCount"
  | "youtubeLikeCount"
  | "commentStanceSpread"
  | "commentFrictionScore"
  | "predictedDivisionScore"
>;

export type DivisionEvidence = Pick<
  SavedEvidence,
  "externalPoll" | "commentStanceSpread" | "commentFrictionScore" | "predictedDivisionScore"
>;

/**
 * 分断シグナルを信頼度順に統合する（1つの数値・0〜1）。
 *   1. externalPoll.divisionScore — Yahoo!投票の実測集計（最優先）
 *   2. commentFrictionScore — Yahooコメントの反応数（共感/うーん）から算術だけで求めた実測値
 *   3. commentStanceSpread — コメント文面のLLM判定（confidenceで重み付け）
 *   4. predictedDivisionScore — Gate（assessDebateLegitimacy）が抜粋から推定したLLM予測
 * 上位が無ければ下位へフォールバック。何も無ければ 0（呼び出し側は hasMeasuredDivision で不明と区別）。
 */
export function resolveDivisionScore(evidence: DivisionEvidence): number {
  if (evidence.externalPoll && Number.isFinite(evidence.externalPoll.divisionScore)) {
    return Math.min(1, Math.max(0, evidence.externalPoll.divisionScore));
  }
  if (typeof evidence.commentFrictionScore === "number" && Number.isFinite(evidence.commentFrictionScore)) {
    return Math.min(1, Math.max(0, evidence.commentFrictionScore));
  }
  const spread = evidence.commentStanceSpread;
  if (spread?.split && Number.isFinite(spread.confidence)) {
    return Math.min(1, Math.max(0, spread.confidence));
  }
  if (
    typeof evidence.predictedDivisionScore === "number" &&
    Number.isFinite(evidence.predictedDivisionScore)
  ) {
    return Math.min(1, Math.max(0, evidence.predictedDivisionScore));
  }
  return 0;
}

/** 分断シグナルが1つでもあるか（0点の実測と「不明」を区別する） */
export function hasMeasuredDivision(evidence: DivisionEvidence): boolean {
  if (evidence.externalPoll && Number.isFinite(evidence.externalPoll.divisionScore)) return true;
  if (typeof evidence.commentFrictionScore === "number" && Number.isFinite(evidence.commentFrictionScore)) {
    return true;
  }
  const spread = evidence.commentStanceSpread;
  if (spread?.split && Number.isFinite(spread.confidence)) return true;
  if (
    typeof evidence.predictedDivisionScore === "number" &&
    Number.isFinite(evidence.predictedDivisionScore)
  ) {
    return true;
  }
  return false;
}

/**
 * DVS'（独立因子）- 2026-07-16の実装。
 * 現在は Conflict' への統合により直接の乗算は行わないが、hasMeasuredDvs の
 * 型情報として残す（SelectionV2Breakdown には含まれず、audit用にのみ expose）。
 * @deprecated Conflict' に統合。rankScore 計算で直接使用しない。
 */
export function dvsPrime(evidence: DivisionEvidence): { dvsPrime: number; hasMeasured: boolean } {
  if (!hasMeasuredDivision(evidence)) {
    return { dvsPrime: 1, hasMeasured: false };
  }
  const raw = resolveDivisionScore(evidence);
  return { dvsPrime: Math.max(DVS_SOFT_FLOOR, Math.min(1, raw)), hasMeasured: true };
}

/**
 * Buzz' = clamp(effectiveScore / 5, 0, 1)
 */
export function buzzPrime(buzzScore: number | undefined | null): number {
  const raw = typeof buzzScore === "number" && Number.isFinite(buzzScore) ? buzzScore : 0;
  return Math.min(1, Math.max(0, raw / 5));
}

/**
 * 主熱量: log1p(tweetCount) / log1p(TWEET_REF)
 */
export function tweetHeat(tweetCount: number, tweetRef: number = TWEET_REF): number {
  const n = Math.max(0, tweetCount);
  const ref = Math.max(1, tweetRef);
  return Math.min(1, Math.log1p(n) / Math.log1p(ref));
}

/**
 * 副熱量: コメント実測のみ。0〜1。
 * 分断度は DVS' に独立させた（二重計上しない）。
 * コメント数はYahoo!記事とYouTube動画の高い方を採用する。
 * YouTube返信数は応酬の実測として別枠加点。
 */
export function secondaryHeat(evidence: HeatEvidence): number {
  let commentHeat = 0;
  if (evidence.commentCountSurge) commentHeat += 0.4;
  const count = Math.max(evidence.commentCount ?? 0, evidence.youtubeCommentCount ?? 0);
  if (count >= 3000) commentHeat += 0.35;
  else if (count >= 1000) commentHeat += 0.3;
  else if (count >= 500) commentHeat += 0.2;
  else if (count >= 300) commentHeat += 0.12;
  const replyCount = evidence.youtubeReplyCount ?? 0;
  if (replyCount >= 300) commentHeat += 0.3;
  else if (replyCount >= 100) commentHeat += 0.15;
  // YouTubeいいね: コメントまではしないが共感を集めているシグナル（viewCountより熱量に直結）
  const likeCount = evidence.youtubeLikeCount ?? 0;
  if (likeCount >= 10000) commentHeat += 0.15;
  else if (likeCount >= 3000) commentHeat += 0.08;
  return Math.min(1, commentHeat);
}

/**
 * Heat': tweetCount があれば主85%+副15%。無ければ副のみ・上限0.55。
 */
export function heatPrime(
  evidence: HeatEvidence,
  tweetCountOverride?: number | null,
  tweetRef: number = TWEET_REF,
): {
  heatPrime: number;
  tweetHeat: number;
  secondaryHeat: number;
  tweetCount: number;
  hasTweetCount: boolean;
} {
  const fromEvidence =
    typeof evidence.tweetCount === "number" && Number.isFinite(evidence.tweetCount)
      ? evidence.tweetCount
      : null;
  const fromOverride =
    typeof tweetCountOverride === "number" && Number.isFinite(tweetCountOverride)
      ? tweetCountOverride
      : null;
  const tweetCount = fromOverride ?? fromEvidence ?? 0;
  const hasTweetCount = (fromOverride ?? fromEvidence) !== null && tweetCount > 0;

  const th = tweetHeat(tweetCount, tweetRef);
  const sh = secondaryHeat(evidence);

  if (hasTweetCount) {
    return {
      heatPrime: Math.min(1, 0.85 * th + 0.15 * sh),
      tweetHeat: th,
      secondaryHeat: sh,
      tweetCount,
      hasTweetCount: true,
    };
  }
  return {
    heatPrime: Math.min(0.55, sh),
    tweetHeat: 0,
    secondaryHeat: sh,
    tweetCount: 0,
    hasTweetCount: false,
  };
}

/**
 * Conflict'（対立因子）: DVSの実測値をそのまま係数にする（0〜1）。
 * - 熱量の実測がある（tweetCount/commentCount/surge）→ 1.0（中立。実際に盛り上がっているのを抑制しない）
 * - 熱量なし、DVS測定済み → clamp(DVS実測値, SOFT_FLOOR, 1.0)。偏りが強いと低くなり順位が沈む
 * - 熱量なし、DVS不明 → 1.0（中立。データ不足を一方的と決めつけない）
 *
 * rankScore = Buzz' × Heat' × Conflict'（3因子積）。
 */
export function conflictPrime(
  evidence: DivisionEvidence & Pick<HeatEvidence, "tweetCount" | "commentCount" | "commentCountSurge">,
): number {
  // 熱量の実測がある → 中立。実際に盛り上がっているトピックを抑制しない
  const hasHeatEvidence =
    (typeof evidence.tweetCount === "number" && evidence.tweetCount > 0) ||
    (typeof evidence.commentCount === "number" && evidence.commentCount >= 300) ||
    evidence.commentCountSurge === true;
  if (hasHeatEvidence) return 1.0;

  // 熱量なし → DVSで判断（偏りが強いと順位が沈む）
  if (!hasMeasuredDivision(evidence)) return 1.0;
  return Math.max(DVS_SOFT_FLOOR, Math.min(1, resolveDivisionScore(evidence)));
}

/**
 * combineConflictPrime: researchCandidate（抜粋後）で呼ぶ。
 * 証拠ベースの conflictPrime に加え、claimDiff.conflicts の数に応じた上乗せを行う。
 * 複数媒体が実際に食い違っている＝議論熱が確実にある証拠なので、追加で最大0.15上乗せする。
 */
export function combineConflictPrime(
  baseConflictPrime: number,
  claimDiffConflicts: number,
): number {
  if (claimDiffConflicts <= 0) return baseConflictPrime;
  // conflicts 1件あたり+0.05、最大+0.15
  const mediaBonus = Math.min(0.15, claimDiffConflicts * 0.05);
  return Math.min(1.0, baseConflictPrime + mediaBonus);
}

/**
 * rankScore = Buzz' × Heat' × Conflict'（3因子。2026-07-16: DVS'別乗は廃止、Conflict'に統合）
 */
export function selectionV2RankScore(
  evidence: Pick<SavedEvidence, "buzzScore"> & HeatEvidence,
  opts?: { tweetCountOverride?: number | null; tweetRef?: number },
): SelectionV2Breakdown {
  const bp = buzzPrime(evidence.buzzScore);
  const heat = heatPrime(evidence, opts?.tweetCountOverride, opts?.tweetRef);
  const dvs = dvsPrime(evidence);
  const cp = conflictPrime(evidence);
  return {
    buzzPrime: bp,
    heatPrime: heat.heatPrime,
    dvsPrime: dvs.dvsPrime,
    conflictPrime: cp,
    tweetHeat: heat.tweetHeat,
    secondaryHeat: heat.secondaryHeat,
    rankScore: bp * heat.heatPrime * cp,
    hasTweetCount: heat.hasTweetCount,
    tweetCount: heat.tweetCount,
    hasMeasuredDvs: dvs.hasMeasured,
  };
}

/** @deprecated passesSelectionV2 を使うこと */
export function passesRankMin(rankScore: number, rankMin: number = RANK_MIN_DEFAULT): boolean {
  return rankScore >= rankMin;
}

/**
 * 公開してよい Rank か（Buzz・Heat・積の下限）。
 * DVSは不明時ペナルティなしのため下限に入れない（測れたときだけ並びで効く）。
 * 両論Gateは呼び出し側（抜粋後の assessDebateLegitimacy）で別途必須。
 */
export function passesSelectionV2(
  breakdown: Pick<SelectionV2Breakdown, "buzzPrime" | "heatPrime" | "rankScore">,
  opts?: { rankMin?: number; buzzMin?: number; heatMin?: number },
): boolean {
  const rankMin = opts?.rankMin ?? RANK_MIN_DEFAULT;
  const buzzMin = opts?.buzzMin ?? BUZZ_MIN_DEFAULT;
  const heatMin = opts?.heatMin ?? HEAT_MIN_DEFAULT;
  return (
    breakdown.rankScore >= rankMin &&
    breakdown.buzzPrime >= buzzMin &&
    breakdown.heatPrime >= heatMin
  );
}
