/**
 * Yahoo RT の tweetCount をトピックに突合する（discover / 比較スクリプト共通）。
 *
 * 誤マッチ防止:
 * - 短すぎる部分一致は不可（「決済」1語で全東信にクレカ障害の数字が付く事故を防ぐ）
 * - エイリアスは「具体フレーズ同士」だけ。共通1語では結ばない
 */
export const TWEET_COUNT_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["クレカ障害", "クレジットカード障害", "カード決済障害", "決済障害"],
  ["モバイルsuica", "モバイルスイカ", "suica障害", "スイカ障害", "pasmo障害"],
];

/** 部分一致に使う最短語長（これ未満は includes しない） */
const MIN_SUBSTRING_LEN = 4;

export function matchYahooTweetCount(
  topic: string,
  yahoo: readonly { term: string; tweetCount: number }[],
  opts?: {
    matches?: (topic: string, term: string) => boolean;
  },
): number | undefined {
  let best = 0;
  const topicLower = topic.toLowerCase();
  const matches = opts?.matches;

  for (const y of yahoo) {
    if (!y.tweetCount || y.tweetCount <= 0) continue;
    const termLower = y.term.toLowerCase();
    const termLen = [...y.term.trim()].length;
    const topicLen = [...topic.trim()].length;

    let hit =
      y.term === topic ||
      (termLen >= MIN_SUBSTRING_LEN && topic.includes(y.term)) ||
      (topicLen >= MIN_SUBSTRING_LEN && y.term.includes(topic)) ||
      (matches?.(topic, y.term) ?? false);

    if (!hit) {
      for (const group of TWEET_COUNT_ALIAS_GROUPS) {
        const topicHits = group.filter((g) => topicLower.includes(g.toLowerCase()));
        const termHits = group.filter((g) => termLower.includes(g.toLowerCase()));
        // 双方がグループ内の具体フレーズに当たったときだけ（「決済」単独などでは結ばない）
        if (topicHits.length > 0 && termHits.length > 0) {
          hit = true;
          break;
        }
      }
    }
    if (hit) best = Math.max(best, y.tweetCount);
  }
  return best > 0 ? best : undefined;
}
