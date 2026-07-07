/**
 * FactBase Radar 時間帯ゲート（discover.ts/promote.ts共通）。
 *
 * discover.tsの③能動調査は複数の外部API（国会・法令・国内外ニュース・Wikipedia）を
 * トピックごとに叩くため、24時間365日フル稼働させるとバズがほぼ無い深夜帯まで
 * 無駄なAPI呼び出しが発生する。ピーク公開時刻（promote.ts）の直前にだけ調査すれば
 * 「ピーク到達時には調査済み」というメリットは変わらずコストだけ大幅に減らせるため、
 * discover.tsもpromote.tsと同じ時間帯ゲートの仕組みを使う（対象時刻の配列が違うだけ）。
 */

/** 現在時刻がJSTの指定時間帯（許容幅内）かどうか */
export function isWithinPeakWindow(
  now: Date,
  windows: readonly { hour: number; minute: number }[],
  toleranceMin: number,
): boolean {
  const jst = new Date(now.getTime() + 9 * 60 * 60_000);
  const nowMinutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  return windows.some((w) => {
    const target = w.hour * 60 + w.minute;
    return Math.abs(nowMinutes - target) <= toleranceMin;
  });
}
