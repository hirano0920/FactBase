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

/**
 * 日本語文字列からbi-gram (2文字の連続部分列) を抽出（語順違いのマッチング用）。
 * 「改正皇室典範」→ {改, 改正, 正皇, 皇室, 室典, 典範, 範}
 * 「皇室典範改正」→ {皇, 皇室, 室典, 典範, 範改, 改正, 正}
 * 両者の共有bigram数で類似度を測る。
 */
function bigramSet(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function sharedBigramRatio(a: string, b: string): number {
  const setA = bigramSet(a);
  const setB = bigramSet(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  return intersection.size / Math.max(setA.size, setB.size, 1);
}

function countSharedBigrams(a: string, b: string): number {
  const setA = bigramSet(a);
  const setB = bigramSet(b);
  return [...setA].filter((x) => setB.has(x)).length;
}

/**
 * 日本語文字列から「内容語」の感触を持つ2文字以上のトークンを抽出。
 * 漢字連続列（2文字以上）・カタカナ連続列（2文字以上）を一塊として抽出。
 * ひらがな・記号・空白はスキップ。
 */
export function extractContentTokens(s: string): string[] {
  const tokens: string[] = [];
  // 漢字2+連続
  const kanji = s.match(/[一-龯]{2,}/g);
  if (kanji) tokens.push(...kanji);
  // カタカナ2+連続
  const kana = s.match(/[ァ-ヶー]{2,}/g);
  if (kana) tokens.push(...kana);
  // 英単語
  const eng = s.match(/[a-zA-Z]{2,}/g);
  if (eng) tokens.push(...eng);
  return [...new Set(tokens)];
}

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
      // 日本語語順違い対応: bi-gram（2文字連続列）の一致率が50%以上なら同一トピックとみなす
      // 「改正皇室典範」vs「皇室典範改正」: bi-gram一致率=4/5=80%
      if (sharedBigramRatio(topic, y.term) >= 0.5) {
        hit = true;
      }
    }

    if (!hit) {
      // 内容語トークンのサブストリング一致: 一方のトークン(3文字以上)が他方に部分一致し、
      // かつbi-gramが2つ以上共有されていれば同一争点とみなす。
      // 例: 「日経平均」⊂「日経平均株価 4000円」、共有bi-gram=日経/経平/平均→3 → MATCH
      const topicTokens = extractContentTokens(topic);
      const termTokens = extractContentTokens(y.term);
      const allTokens = [...new Set([...topicTokens, ...termTokens])];
      for (const token of allTokens) {
        if ([...token].length < 3) continue; // 短すぎるトークンは誤爆防止
        if (topic.includes(token) && y.term.includes(token) && token !== topic && token !== y.term) {
          const intersection = countSharedBigrams(topic, y.term);
          if (intersection >= 2) {
            hit = true;
            break;
          }
        }
      }
    }
    if (!hit) {
      // 日本語語順違い対応: 両方に含まれる内容語トークンが2つ以上かつ50%以上共有
      const topicTokens = extractContentTokens(topic);
      const termTokens = extractContentTokens(y.term);
      const shared = topicTokens.filter((t) => termTokens.includes(t));
      if (shared.length >= 2 && shared.length >= Math.min(topicTokens.length, termTokens.length) * 0.5) {
        hit = true;
      }
    }

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
