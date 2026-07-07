/** 見出し同士の bigram 類似（バズ照合・クラスタ検証で共用） */

export const BUZZ_TITLE_SIMILARITY = 0.2;

function bigrams(text: string): Set<string> {
  const clean = text.replace(/\s+/g, "");
  const set = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function buzzTitleMatch(titles: string[], corpusTitles: string[]): boolean {
  if (titles.length === 0 || corpusTitles.length === 0) return false;
  const targetSets = titles.map(bigrams);
  for (const corpus of corpusTitles) {
    const corpusSet = bigrams(corpus);
    for (const t of targetSets) {
      if (jaccard(t, corpusSet) >= BUZZ_TITLE_SIMILARITY) return true;
    }
  }
  return false;
}

export { bigrams, jaccard };
