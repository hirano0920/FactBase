/** SummaryCard 用の純粋なテキスト整形（UIコンポーネントから分離してテスト可能にする） */

export interface ParsedBullet {
  label: string | null;
  text: string;
}

/** bulletsは "ラベル: 本文" 形式。ラベルと本文を分離する */
export function parseBullet(bullet: string): ParsedBullet {
  const match = bullet.match(/^([^：:]{1,20})[：:]\s*([\s\S]+)$/);
  if (!match) return { label: null, text: bullet };
  return { label: match[1].trim(), text: match[2].trim() };
}

/**
 * 長い一文ブロックを「芯の主張」＋「根拠・詳細」に分ける。
 * 読者がまず対立の軸を掴めるようにする。
 */
export function splitClaimAndPoints(text: string): { claim: string; points: string[] } {
  const sentences = text
    .split(/(?<=[。．！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return { claim: text, points: [] };
  if (sentences.length === 1) {
    if (sentences[0].length > 90) {
      const mid = sentences[0].indexOf("、", Math.floor(sentences[0].length * 0.35));
      if (mid > 20) {
        return {
          claim: `${sentences[0].slice(0, mid)}。`,
          points: [sentences[0].slice(mid + 1).trim()],
        };
      }
    }
    return { claim: sentences[0], points: [] };
  }
  return { claim: sentences[0], points: sentences.slice(1) };
}
