/**
 * Selection V2.1 — Rank スコア（Buzz' × ClickHeat' × DebateHeat'）。
 *
 * 2026-07-17 全面改訂:
 * - Heat'（主85%+副15%混在）を ClickHeat'（ツイート量）と
 *   DebateHeat'（コメント摩擦・投票分断）に分離。
 * - これにより「ツイートは多いが議論ゼロのゴシップ」と
 *   「ツイート少ないがコメントで大荒れの政治争点」を正しく区別する。
 * - rankScore = Buzz' × ClickHeat' × DebateHeat'
 * - Freshness は呼び出し側 (weightedPromoteScore) で乗算。
 * - Conflict'（旧DVS因子）は削除。DebateHeat' がその機能を包含する。
 */
import type { SavedEvidence } from "./promote-logic";

/** 「特大」SNSクリック熱の目安。実分布で校正する */
export const TWEET_REF = 5000;

/** 積スコアの下限（3因子積） */
export const RANK_MIN_DEFAULT = 0.04;

/**
 * Buzz' 下限。0.4 ≒ effectiveScore>=2（クロスソース最低ライン）。
 * 露出が無ければ出さない。
 */
export const BUZZ_MIN_DEFAULT = 0.4;

/**
 * ClickHeat' 下限。tweetCount無しでもコメント・摩擦がある話題を通すため 0。
 * （clickHeat=0 でも debateHeat>0 なら rankScore=0 なので実質debateだけでは通らない）
 */
export const CLICK_HEAT_MIN = 0;

/**
 * DebateHeat' 下限。コメント100程度で届く最低ライン。
 * 全く議論がない話題は clickHeat が高くても弾く。
 */
export const DEBATE_HEAT_MIN = 0.05;

/**
 * 実測DVSが極端に低いときのソフト下限（旧互換）。
 * 現在は DebateHeat' に包含されるが、audit用に残す。
 * @deprecated DebateHeat' が代替
 */
export const DVS_SOFT_FLOOR = 0.15;

export interface SelectionV2Breakdown {
  buzzPrime: number;
  /**
   * @deprecated ClickHeat' + DebateHeat' に分離。互換性のため残す。
   * rankScore計算には使わない。
   */
  heatPrime: number;
  /**
   * 「いま人がそれを見たいと思ってる」度。
   * tweetCountを対数圧縮（log1p）した値。tweetCount無しは0。
   */
  clickHeat: number;
  /**
   * 「人がそれについて議論したがってる」度。
   * コメント数 + 摩擦度 + YouTube返信 + 投票拮抗 を総合。
   */
  debateHeat: number;
  /**
   * @deprecated Conflict'に統合。rankScore計算には使わない。互換性のために残す。
   */
  dvsPrime: number;
  /**
   * @deprecated DebateHeat' が包含。互換性のために残す。
   */
  conflictPrime: number;
  combinedConflictPrime?: number;
  claimDiffConflicts?: number;
  rankScore: number;
  hasTweetCount: boolean;
  tweetCount: number;
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
  | "googleTrendTraffic"
  | "newsClusterCount"
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
 * 上位が無ければ下位へフォールバック。何も無ければ 0。
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

/** 分断シグナルが1つでもあるか */
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
 * DVS'（独立因子）- 互換性のために残す。
 * @deprecated DebateHeat' が代替。rankScore計算で使用しない。
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
 * クリック熱量: log1p(tweetCount) / log1p(TWEET_REF)
 * 「いま人がそれを見たいと思ってる」度の代理指標。
 * tweetCount無しは0（別途 buzzScore で露出は評価済み）。
 */
export function tweetHeat(tweetCount: number, tweetRef: number = TWEET_REF): number {
  const n = Math.max(0, tweetCount);
  const ref = Math.max(1, tweetRef);
  return Math.min(1, Math.log1p(n) / Math.log1p(ref));
}

/**
 * ClickHeat': クリック熱量（0〜1）。
 * 「いま人がそれを見たいと思ってる」度を3つの独立シグナルから測定。
 *
 * 構成:
 * ① tweetHeat（対数圧縮）: X上の言及量。tweetCountが無い=0。
 * ② trendHeat: Google Trends 検索ボリューム。急上昇ワードとして実際に
 *    人が検索している量（Yahoo RTに載らない関心も拾う）。
 * ③ newsHeat: Yahoo!ニュースランキングのクラスタ数。編集部が「今、読者が
 *    知るべき」と判断した複数記事の掲載。
 *
 * tweetCount無しでも Google Trends で急上昇 + Yahoo News で複数記事 → 関心は高い。
 * 逆に tweetCount だけ高いゴシップは newsHeat/trendHeat が低く clickHeat 全体も低め。
 *
 * ClickHeat' 単独でのハード下限は設けていない（CLICK_HEAT_MIN=0）。
 * 最終的な rankScore = Buzz'×Click'×Debate' の積で自然にフィルタリングされる。
 * clickHeat=0 → rank=0 → 自動的に弾かれる（ゴシップはdebateも0なので死ぬ）。
 */
export function clickHeat(
  evidence: HeatEvidence,
  tweetCountOverride?: number | null,
  tweetRef: number = TWEET_REF,
): number {
  // ① tweetHeat
  const fromEvidence =
    typeof evidence.tweetCount === "number" && Number.isFinite(evidence.tweetCount)
      ? evidence.tweetCount
      : null;
  const fromOverride =
    typeof tweetCountOverride === "number" && Number.isFinite(tweetCountOverride)
      ? tweetCountOverride
      : null;
  const count = fromOverride ?? fromEvidence ?? 0;
  const th = count > 0 ? tweetHeat(count, tweetRef) : 0;

  // ② trendHeat: Google Trends 検索トラフィック
  // 10万超=大規模トレンド(+0.30), 1万超=小規模トレンド(+0.15)
  const traffic = evidence.googleTrendTraffic ?? 0;
  const trendH = traffic >= 100_000 ? 0.30 : traffic >= 10_000 ? 0.15 : 0;

  // ③ newsHeat: Yahoo!ニュースクラスタ数（同一争点の見出し数）
  // 5記事以上=大規模(+0.20), 3記事以上=中規模(+0.10), 2記事=小規模(+0.05)
  const cluster = evidence.newsClusterCount ?? 0;
  const newsH = cluster >= 5 ? 0.20 : cluster >= 3 ? 0.10 : cluster >= 2 ? 0.05 : 0;

  const total = th + trendH + newsH;
  return Math.min(1, total);
}

/**
 * DebateHeat': 議論熱量（0〜1）。
 * 「人がそれについて議論したがってる」度をコメント・摩擦・投票・YouTube応酬から測定。
 *
 * 構成（合計1.0超える場合はclamp）:
 * - コメント数: Yahoo+YouTubeの高い方（3000超で+0.35、1000超+0.30、500超+0.20、300超+0.12、100超+0.05）
 * - コメント急増: +0.40（炎上加速）
 * - YouTube返信（応酬の実測）: 300超+0.30、100超+0.15
 * - YouTubeいいね（共感）: 1万超+0.15、3000超+0.08
 * - コメント摩擦度: 0.5超+0.30、0.3超+0.15
 * - 投票拮抗: divisionScore>=0.2で+0.20
 */
export function debateHeat(evidence: HeatEvidence): number {
  let heat = 0;

  // コメント数（Yahoo + YouTube、高い方）
  const count = Math.max(evidence.commentCount ?? 0, evidence.youtubeCommentCount ?? 0);
  const friction = evidence.commentFrictionScore ?? 0;

  // 摩擦度(friction)でコメント熱量を重み付け。
  // スポーツ(大谷「すごい!」) = コメントは多いが摩擦ゼロ → 議論熱量は低い。
  // 政治(賛成vs反対) = 摩擦が高い → コメント数×摩擦ペナルティが小さい。
  // 係数3: friction=0 → heat 0%、friction=0.33 → heat 100%
  const frictionWeight = Math.min(1, friction * 3);

  let countHeat = 0;
  if (count >= 3000) countHeat = 0.35;
  else if (count >= 1000) countHeat = 0.30;
  else if (count >= 500) countHeat = 0.20;
  else if (count >= 300) countHeat = 0.12;
  else if (count >= 100) countHeat = 0.05;
  heat += countHeat * frictionWeight;

  // コメント急増（炎上加速）
  if (evidence.commentCountSurge) heat += 0.40;

  // YouTube返信（実際の応酬）
  const replyCount = evidence.youtubeReplyCount ?? 0;
  if (replyCount >= 300) heat += 0.30;
  else if (replyCount >= 100) heat += 0.15;

  // YouTubeいいね（共感）
  const likeCount = evidence.youtubeLikeCount ?? 0;
  if (likeCount >= 10000) heat += 0.15;
  else if (likeCount >= 3000) heat += 0.08;

  // 投票拮抗（実際の世論の分断）
  const pollDiv = evidence.externalPoll?.divisionScore;
  if (typeof pollDiv === "number" && pollDiv >= 0.2) {
    heat += 0.20;
  }

  return Math.min(1, heat);
}

/**
 * 副熱量（旧互換用）。debateHeat と同じ計算だが、commentCountSurgeを
 * 別枠にしないなど厳密な互換が必要な audit 用。
 * @deprecated debateHeat を使うこと
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
  const likeCount = evidence.youtubeLikeCount ?? 0;
  if (likeCount >= 10000) commentHeat += 0.15;
  else if (likeCount >= 3000) commentHeat += 0.08;
  return Math.min(1, commentHeat);
}

/**
 * Heat'（旧 - 主85%+副15%混在モデル）。
 * @deprecated ClickHeat' + DebateHeat' に分離。互換性のために残す。
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
 * Conflict'（対立因子）- 互換性のために残す。
 * @deprecated DebateHeat' が包含。rankScore計算で使用しない。
 */
export function conflictPrime(
  evidence: DivisionEvidence & Pick<HeatEvidence, "tweetCount" | "commentCount" | "commentCountSurge">,
): number {
  const hasHeatEvidence =
    (typeof evidence.tweetCount === "number" && evidence.tweetCount > 0) ||
    (typeof evidence.commentCount === "number" && evidence.commentCount >= 300) ||
    evidence.commentCountSurge === true;
  if (hasHeatEvidence) return 1.0;
  if (!hasMeasuredDivision(evidence)) return 1.0;
  return Math.max(DVS_SOFT_FLOOR, Math.min(1, resolveDivisionScore(evidence)));
}

/**
 * combineConflictPrime: 互換性のために残す。
 * @deprecated debateHeat が claimDiff を包含する形で代替。
 */
export function combineConflictPrime(
  baseConflictPrime: number,
  claimDiffConflicts: number,
): number {
  if (claimDiffConflicts <= 0) return baseConflictPrime;
  const mediaBonus = Math.min(0.15, claimDiffConflicts * 0.05);
  return Math.min(1.0, baseConflictPrime + mediaBonus);
}

/**
 * rankScore = Buzz' × ClickHeat' × DebateHeat'（3因子）。
 * Freshness は呼び出し側で乗算。
 */
export function selectionV2RankScore(
  evidence: Pick<SavedEvidence, "buzzScore"> & HeatEvidence,
  opts?: { tweetCountOverride?: number | null; tweetRef?: number },
): SelectionV2Breakdown {
  const bp = buzzPrime(evidence.buzzScore);
  const ch = clickHeat(evidence, opts?.tweetCountOverride, opts?.tweetRef);
  const dh = debateHeat(evidence);
  // 旧互換
  const heat = heatPrime(evidence, opts?.tweetCountOverride, opts?.tweetRef);
  const dvs = dvsPrime(evidence);
  const cp = conflictPrime(evidence);
  return {
    buzzPrime: bp,
    heatPrime: heat.heatPrime,
    clickHeat: ch,
    debateHeat: dh,
    dvsPrime: dvs.dvsPrime,
    conflictPrime: cp,
    tweetHeat: heat.tweetHeat,
    secondaryHeat: heat.secondaryHeat,
    rankScore: bp * ch * dh,
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
 * 公開してよい Rank か（Buzz・ClickHeat・DebateHeat・積の下限）。
 * 両論Gateは呼び出し側（assessDebateLegitimacy）で別途必須。
 */
export function passesSelectionV2(
  breakdown: Pick<SelectionV2Breakdown, "buzzPrime" | "clickHeat" | "debateHeat" | "heatPrime" | "rankScore">,
  opts?: { rankMin?: number; buzzMin?: number; clickMin?: number; debateMin?: number },
): boolean {
  const rankMin = opts?.rankMin ?? RANK_MIN_DEFAULT;
  const buzzMin = opts?.buzzMin ?? BUZZ_MIN_DEFAULT;
  const clickMin = opts?.clickMin ?? CLICK_HEAT_MIN;
  const debateMin = opts?.debateMin ?? DEBATE_HEAT_MIN;
  return (
    breakdown.rankScore >= rankMin &&
    breakdown.buzzPrime >= buzzMin &&
    breakdown.clickHeat >= clickMin &&
    breakdown.debateHeat >= debateMin
  );
}
