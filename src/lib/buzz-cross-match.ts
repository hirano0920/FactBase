/**
 * バズ4ソースの横断一致。見出し全文の bigram だけでは「高市」「NATO」「トランプ」等が
 * ソース間で表記ゆれすると score=1 のままになるため、争点アンカー語で照合する。
 */
import { buzzTitleMatch } from "./buzz-title";
import { IN_SCOPE_BUZZ_HINTS } from "./buzz-scope";
import { RADAR } from "./constants";
import type { BuzzSourceHit, BuzzSourceInputs } from "./radar";
import type { BuzzTermInput } from "./buzz-prefilter";

const MATCH_STOPWORDS = new Set([
  "について",
  "による",
  "として",
  "ことが",
  "問題",
  "発言",
  "記者",
  "会見",
  "報道",
  "速報",
  "最新",
  "関連",
  "政府",
  "日本",
  "東京",
  "昨日",
  "今日",
  "明日",
  "首相",
  "大臣",
  "政権",
  "与党",
  "野党",
]);

const ENTITY_PATTERNS: RegExp[] = [
  /[一-龥々]{2,8}(?:首相|大臣|大統領|長官|総裁|王国)/g,
  /[一-龥々]{2,5}氏/g,
  /(?:米|中|日|韓|欧|英|露|印|独|仏)国/g,
  /\b[A-Za-z][A-Za-z0-9]{1,11}\b/g,
];

function normalizeToken(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toLowerCase();
}

function isStrongMatchToken(token: string): boolean {
  const t = token.trim();
  if (t.length < 2) return false;
  if (MATCH_STOPWORDS.has(t)) return false;
  if (/^[a-z0-9]{2,12}$/i.test(t)) return t.length >= 3;
  if (/氏$/.test(t)) return true;
  if (/(?:首相|大臣|大統領|長官|総裁|王国)$/.test(t)) return true;
  if (IN_SCOPE_BUZZ_HINTS.test(t)) return t.length >= 2;
  return t.length >= 4;
}

/** トピック/見出しからソース横断照合に使う語を抽出 */
export function extractBuzzMatchTokens(text: string): string[] {
  const t = text.trim();
  if (!t) return [];

  const found = new Set<string>();
  for (const pattern of ENTITY_PATTERNS) {
    pattern.lastIndex = 0;
    for (const m of t.matchAll(pattern)) {
      const tok = normalizeToken(m[0]);
      if (tok.length >= 2) found.add(tok);
    }
  }

  const hintRe = new RegExp(IN_SCOPE_BUZZ_HINTS.source, "gi");
  for (const m of t.matchAll(hintRe)) {
    const tok = normalizeToken(m[0]);
    if (tok.length >= 2) found.add(tok);
  }

  // 他のパターンで1トークンも抽出できなかった場合のみ、短い全文をそのままトークンとして使う。
  // これにより「北朝鮮労働者問題」が「北朝鮮」＋「労働」の2トークンとして抽出された場合に
  // 全文「北朝鮮労働者問題」が別トークンとして追加されるのを防ぎ、
  // 単一トークン「北朝鮮」との曖昧マッチを抑止する。
  if (found.size === 0 && t.length <= 24 && !/[「」『』]/.test(t)) {
    found.add(normalizeToken(t));
  }

  return [...found].filter(isStrongMatchToken);
}

export function buzzMatchesSearchTerms(topic: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const topicNorm = topic.trim();
  const topicTokens = extractBuzzMatchTokens(topicNorm);

  return terms.some((term) => {
    const t = term.trim();
    if (!t) return false;

    const termTokens = extractBuzzMatchTokens(t);

    // ① トークンレベルの一致（最も精度が高い）
    if (termTokens.length > 0 && topicTokens.length > 0) {
      const matched = topicTokens.filter((a) =>
        termTokens.some((b) => {
          if (a === b) return true;
          if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a)))
            return true;
          return false;
        }),
      );
      if (matched.length >= 2) return true;
      // 単一トークンしかない短いトピックなら許容（固有名詞の全文フォールバック）
      if (matched.length === 1 && topicTokens.length === 1) return true;
      // 一致したトークンが固有名詞パターン（氏名+役職、NATO等）なら確定的
      if (matched.length >= 1) {
        const isEntity = matched.some((a) =>
          ENTITY_PATTERNS.some((p) => {
            p.lastIndex = 0;
            return p.test(a);
          }),
        );
        if (isEntity) return true;
        // 一致が1トークンだけで固有名詞でもない → サブストリング確認で判断（②へフォールスルー）
      }
    }

    // ② サブストリング一致（広いトークンの偽陽性リスクを軽減）
    // トレンド語がトピックの一部分として含まれる場合、トレンド語の長さが
    // トピック全体の40%以上ある場合のみ真の一致とみなす。
    // 例: 「国旗損壊」(4文字) in 「国旗損壊罪」(5文字) → 80% → OK
    // 例: 「北朝鮮」(3文字) in 「北朝鮮労働者問題」(9文字) → 33% → 偽陽性
    if (topicNorm.includes(t)) {
      if (t.length >= topicNorm.length * 0.4 || topicNorm.length <= 6) return true;
      // 40%未満の短いサブストリングは偽陽性リスク大
      return false;
    }
    // トピック自体がトレンド語に含まれている → OK
    if (t.includes(topicNorm)) return true;

    return false;
  });
}

export function buzzMatchesTitleCorpus(topic: string, corpusTitles: string[]): boolean {
  if (corpusTitles.length === 0) return false;
  const tokens = extractBuzzMatchTokens(topic).filter(
    (tok) =>
      tok.length >= 3 ||
      /氏$|大統領|首相|大臣/.test(tok) ||
      IN_SCOPE_BUZZ_HINTS.test(tok),
  );
  if (tokens.length === 0) return false;

  return corpusTitles.some((title) => {
    const titleNorm = title.trim();
    if (!titleNorm) return false;
    return tokens.some((tok) => {
      if (titleNorm.includes(tok)) return true;
      if (/^[a-z0-9]+$/i.test(tok)) {
        return titleNorm.toLowerCase().includes(tok.toLowerCase());
      }
      return false;
    });
  });
}

/**
 * buzzMatchesTitleCorpus の厳格版。2トークン以上マッチしないと偽陽性とみなす。
 * 「北朝鮮」だけで別の話題(北朝鮮ミサイル等)と誤マッチするのを防ぐため、
 * assembleBuzzScore のソース一致判定でのみ使う。
 * ニュースクラスタリング(countNewsClusterHeadlines)には使わない（緩いマッチのまま）。
 */
export function buzzMatchesStrictTitleCorpus(topic: string, corpusTitles: string[]): boolean {
  if (corpusTitles.length === 0) return false;
  const tokens = extractBuzzMatchTokens(topic).filter(
    (tok) =>
      tok.length >= 3 ||
      /氏$|大統領|首相|大臣/.test(tok) ||
      IN_SCOPE_BUZZ_HINTS.test(tok),
  );
  if (tokens.length === 0) return false;

  // 有意トークンが1つしかなければ従来挙動（単一トークンマッチでもOK）。
  // 「NATO」のような単一トピックは2トークン照合できないため緩いマッチが正しい。
  if (tokens.length === 1) return buzzMatchesTitleCorpus(topic, corpusTitles);

  return corpusTitles.some((title) => {
    const titleNorm = title.trim();
    if (!titleNorm) return false;
    const matched = tokens.filter((tok) => {
      if (titleNorm.includes(tok)) return true;
      if (/^[a-z0-9]+$/i.test(tok)) {
        return titleNorm.toLowerCase().includes(tok.toLowerCase());
      }
      return false;
    });
    // 最低2トークン一致 または トークンの過半数(50%超)がマッチ
    if (matched.length >= 2) return true;
    if (matched.length > tokens.length / 2) return true;
    return false;
  });
}

function titleMatchesBuzzTopic(topic: string, title: string): boolean {
  // クラスタリングは厳格マッチを優先するが、表記ゆれ対策のフォールバックとして
  // 緩いマッチも試す。厳格が false でも緩いが true ならカウント（+1ボーナスのみで
  // スコア決定には使わないため、偽陽性の影響は限定的）。
  return (
    buzzTitleMatch([topic], [title]) ||
    buzzMatchesStrictTitleCorpus(topic, [title]) ||
    buzzMatchesStrictTitleCorpus(title, [topic]) ||
    buzzMatchesTitleCorpus(topic, [title])
  );
}

/** ニュースランキング内で同一争点とみなせる見出し数 */
export function countNewsClusterHeadlines(topic: string, newsTitles: string[]): number {
  if (newsTitles.length === 0) return 0;
  return newsTitles.filter((title) => titleMatchesBuzzTopic(topic, title)).length;
}

export function assembleBuzzScore(topic: string, sources: BuzzSourceInputs): BuzzSourceHit {
  const inGoogleTrends = buzzMatchesSearchTerms(topic, sources.googleTerms);
  const inYahooRealtime = buzzMatchesSearchTerms(topic, sources.yahooRealtimeTerms);
  const inNewsRanking =
    buzzTitleMatch([topic], sources.newsRankingTitles) ||
    buzzMatchesStrictTitleCorpus(topic, sources.newsRankingTitles);
  const inYouTubeTrending =
    buzzTitleMatch([topic], sources.youtubeTrendingTitles) ||
    buzzMatchesStrictTitleCorpus(topic, sources.youtubeTrendingTitles);
  const tvNewsTitles = sources.tvNewsTitles ?? [];
  const inTVNews =
    tvNewsTitles.length > 0 &&
    (buzzTitleMatch([topic], tvNewsTitles) ||
      buzzMatchesStrictTitleCorpus(topic, tvNewsTitles));
  const commentRankingTitles = sources.commentRankingTitles ?? [];
  const inCommentRanking =
    commentRankingTitles.length > 0 &&
    (buzzTitleMatch([topic], commentRankingTitles) ||
      buzzMatchesStrictTitleCorpus(topic, commentRankingTitles));
  // 5ソース素点
  const score =
    Number(inGoogleTrends) +
    Number(inYahooRealtime) +
    Number(inNewsRanking) +
    Number(inYouTubeTrending) +
    Number(inTVNews);

  const newsClusterCount = countNewsClusterHeadlines(topic, sources.newsRankingTitles);
  const inNewsCluster = newsClusterCount >= RADAR.minNewsClusterHeadlines;
  // YouTube + Yahoo RT の両方にヒット = テレビ各社がニュース配信 + 実際にツイートあり
  // これは「本物のバズ」の最も信頼できる指標（単一ソースだけのヒットは偽陽性の可能性大）
  const youtubeYahooVerified = inYouTubeTrending && inYahooRealtime;
  // TVニュース + Yahoo RT = 放送各社が報じている ＋ 実際にツイートで話題
  // テレビニュースは「読まれた」ではなく「放送局が報じる価値ありと判断した」事実のシグナル
  const tvYahooVerified = inTVNews && inYahooRealtime;
  // コメントランキング一致は「賛否が割れている」の直接シグナルなので、他5ソースの合算とは
  // 別枠でボーナスを乗せる（読まれただけの record と区別するため newsCluster と同じ+1扱い）。
  // 検証ボーナス: YouTube+YahooRT同時ヒットは +1、TV+YahooRT同時ヒットも +1。
  const effectiveScore = Math.min(
    5,
    score + (inNewsCluster ? 1 : 0) + (inCommentRanking ? 1 : 0) + (youtubeYahooVerified ? 1 : 0) + (tvYahooVerified ? 1 : 0),
  );

  return {
    inGoogleTrends,
    inYahooRealtime,
    inNewsRanking,
    inYouTubeTrending,
    inTVNews,
    inNewsCluster,
    inCommentRanking,
    youtubeYahooVerified,
    tvYahooVerified,
    score,
    effectiveScore: Math.min(5, effectiveScore),
    newsClusterCount,
  };
}

export interface BuzzAnchorCandidate {
  anchor: string;
  variants: string[];
  hit: BuzzSourceHit;
  /** promote/深掘り優先用 effectiveScore */
  score: number;
  inputCount: number;
}

function pickRepresentativeAnchor(token: string, variants: string[]): string {
  const withToken = variants.filter((v) => v.includes(token) || token.includes(v));
  const pool = withToken.length > 0 ? withToken : variants;
  return pool.sort((a, b) => b.length - a.length)[0] ?? token;
}

export function buildBuzzAnchorCandidates(
  inputs: BuzzTermInput[],
  sources: BuzzSourceInputs,
): BuzzAnchorCandidate[] {
  const tokenToVariants = new Map<string, Set<string>>();

  for (const input of inputs) {
    const tokens = extractBuzzMatchTokens(input.term);
    const keys =
      tokens.filter(isStrongMatchToken).length > 0
        ? tokens.filter(isStrongMatchToken)
        : input.term.trim().length >= 6
          ? [input.term.trim()]
          : [];

    for (const key of keys) {
      const norm = normalizeToken(key);
      if (!tokenToVariants.has(norm)) tokenToVariants.set(norm, new Set());
      tokenToVariants.get(norm)!.add(input.term);
    }
  }

  const candidates: BuzzAnchorCandidate[] = [];
  for (const [token, variantSet] of tokenToVariants) {
    const variants = [...variantSet];
    const anchor = pickRepresentativeAnchor(token, variants);
    const hit = assembleBuzzScore(anchor, sources);
    candidates.push({
      anchor,
      variants,
      hit,
      score: hit.effectiveScore,
      inputCount: variants.length,
    });
  }

  const byAnchor = new Map<string, BuzzAnchorCandidate>();
  for (const c of candidates) {
    const key = normalizeToken(c.anchor);
    const prev = byAnchor.get(key);
    if (
      !prev ||
      c.score > prev.score ||
      (c.score === prev.score && c.inputCount > prev.inputCount)
    ) {
      byAnchor.set(key, c);
    }
  }

  return [...byAnchor.values()].sort(
    (a, b) => b.score - a.score || b.inputCount - a.inputCount || a.anchor.localeCompare(b.anchor, "ja"),
  );
}
