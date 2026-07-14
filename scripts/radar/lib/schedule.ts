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
  return minutesToNearestWindow(now, windows) <= toleranceMin;
}

/** 現在時刻から最も近い時間帯までの距離（分）。cron遅延の見逃し検知に使う */
export function minutesToNearestWindow(
  now: Date,
  windows: readonly { hour: number; minute: number }[],
): number {
  const jst = new Date(now.getTime() + 9 * 60 * 60_000);
  const nowMinutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  return Math.min(...windows.map((w) => Math.abs(nowMinutes - (w.hour * 60 + w.minute))));
}

/**
 * 時間帯マッチだけに頼ると、GitHub Actionsのscheduled cronが数十分〜数時間単位で
 * ずれる/欠落する場合（実測: 6回連続で全ての時間帯を外し、17時間以上パイプラインが
 * 完全に停止した）に、許容幅をどれだけ広げても原理的に取りこぼしうる。
 * 「最後に実際に動いてからどれだけ経ったか」を最終防衛ラインにする：
 * 経過時間がこの関数の閾値を超えていれば、時間帯に関わらず強制的に実行する。
 */
export function isOverdue(lastAt: Date | null, thresholdHours: number, now: Date = new Date()): boolean {
  if (!lastAt) return true;
  return now.getTime() - lastAt.getTime() > thresholdHours * 60 * 60_000;
}
