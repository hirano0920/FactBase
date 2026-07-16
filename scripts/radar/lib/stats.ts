/**
 * 閾値校正監査（audit-threshold-calibration.ts）用の純粋な統計関数。
 * 「公開前のスコアが公開後の実測エンゲージメントとどれだけ相関するか」を測るのに使う。
 */

/**
 * ピアソン相関係数（-1〜1）。ペア数が2未満、またはどちらかの分散が0（全部同じ値）なら
 * 相関を定義できないためnull（「データ不足」を「相関なし(0)」と混同しない）。
 */
export function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  return cov / Math.sqrt(varX * varY);
}

/**
 * xsの値でpairsを昇順ソートし、bucketCount個の等分バケツに分けて、各バケツのys平均を返す。
 * 相関係数1つだけだとサンプルが少ない/非線形なときに読み違えるため、
 * 「スコアが高い群ほど実測エンゲージメントも高いか」を目で見て確認する用。
 */
export function bucketAverages(
  pairs: readonly { x: number; y: number }[],
  bucketCount: number,
): { xRange: [number, number]; yMean: number; n: number }[] {
  if (pairs.length === 0 || bucketCount <= 0) return [];
  const sorted = [...pairs].sort((a, b) => a.x - b.x);
  const size = Math.ceil(sorted.length / bucketCount);
  const buckets: { xRange: [number, number]; yMean: number; n: number }[] = [];
  for (let i = 0; i < sorted.length; i += size) {
    const chunk = sorted.slice(i, i + size);
    if (chunk.length === 0) continue;
    const yMean = chunk.reduce((s, p) => s + p.y, 0) / chunk.length;
    buckets.push({
      xRange: [chunk[0].x, chunk[chunk.length - 1].x],
      yMean,
      n: chunk.length,
    });
  }
  return buckets;
}
