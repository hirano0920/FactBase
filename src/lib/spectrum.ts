/**
 * 「沈黙の多数派」ヒートマップ（A-4）・意見変化率（A-3）用の純粋関数群。
 * 読了後の連続スライダー投票(-100〜+100)を離散stanceにbucket化し、分布・変化率を計算する。
 */
import type { VoteChoice } from "@prisma/client";

/** 中央帯（-10〜+10）は「まだ決められない」＝UNDECIDED扱いにする */
export const UNDECIDED_BAND = 10;

export function bucketIntensity(intensity: number): VoteChoice {
  if (intensity > UNDECIDED_BAND) return "FOR";
  if (intensity < -UNDECIDED_BAND) return "AGAINST";
  return "UNDECIDED";
}

export interface HistogramBin {
  min: number;
  max: number;
  count: number;
}

/**
 * -100..100を指定bin数で均等分割したヒストグラムを作る（沈黙の多数派ヒートマップの本体）。
 * 3択の箱でなく連続値の分布として見せる設計思想に合わせ、bin数は多め（既定10）にする。
 */
export function buildHistogram(values: number[], binCount = 10): HistogramBin[] {
  const binWidth = 200 / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    min: -100 + i * binWidth,
    max: -100 + (i + 1) * binWidth,
    count: 0,
  }));
  for (const raw of values) {
    const clamped = Math.min(100, Math.max(-100, raw));
    const idx = Math.min(binCount - 1, Math.floor((clamped + 100) / binWidth));
    bins[idx].count += 1;
  }
  return bins;
}

export interface ShiftResult {
  /** BEFORE_READ/AFTER_READ両方が揃っているユーザー数（母数）。過剰主張しないため必ず表示する */
  n: number;
  shiftedCount: number;
  shiftPercent: number;
}

/** BEFORE_READ→AFTER_READでbucketが変わった割合（=意見が変わった率）を計算する */
export function computeShift(pairs: { before: VoteChoice; after: VoteChoice }[]): ShiftResult {
  const n = pairs.length;
  if (n === 0) return { n: 0, shiftedCount: 0, shiftPercent: 0 };
  const shiftedCount = pairs.filter((p) => p.before !== p.after).length;
  return { n, shiftedCount, shiftPercent: Math.round((shiftedCount / n) * 1000) / 10 };
}

export function clampIntensity(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(-100, n)));
}
