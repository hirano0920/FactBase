/**
 * バズ語の機械プリフィルタ（discover ①→② の間）。
 * スポーツ・芸能・天気ゴミを除き、争点候補は mini に任せる（News/RT はランキング/ジャンルを信頼）。
 */
import { isOutOfScopeTopic } from "./radar";
import { IN_SCOPE_BUZZ_HINTS, YAHOO_RT_NEWS_GENRE } from "./buzz-scope";

/** 単語だけのノイズ（国名・選手名・チーム名等） */
const SHORT_NOISE =
  /^(ベルギー|アメリカ|日本|韓国|ブラジル|ドイツ|フランス|イングランド|スペイン|イタリア|メッシ|ロナウド|大谷|WBC|UCL|Jリーグ)$/i;

export type BuzzTermSource = "trends" | "yahoo_rt" | "yahoo_news" | "youtube";

export interface BuzzTermInput {
  term: string;
  source: BuzzTermSource;
  /** Yahoo!リアルタイムの genre（例: ニュース / スポーツ） */
  genre?: string;
}

/** 争点になりにくいライフ・ゴシップ見出し */
const LIFESTYLE_HEADLINE =
  /育休|ご祝儀|ハラスメント騒動|不倫|熱愛|結婚式|離婚|ダイエット|レシピ|天気予報|週間天気|高校野球|SKハイニックス/i;

/** 政策角度のない天気・台風速報 alone */
const WEATHER_HEADLINE = /台風\d+号.*(?:進路|接近|影響)|猛烈な.*台風.*接近/i;

export function isBuzzGarbageTerm(term: string, genre?: string): boolean {
  const t = term.trim();
  if (t.length < 3) return true;
  if (genre && /スポーツ|エンタメ|ゲーム|アニメ|芸能|ライフ/i.test(genre)) return true;
  if (SHORT_NOISE.test(t)) return true;
  if (LIFESTYLE_HEADLINE.test(t)) return true;
  if (WEATHER_HEADLINE.test(t) && !IN_SCOPE_BUZZ_HINTS.test(t)) return true;
  return isOutOfScopeTopic(t, [t]);
}

/**
 * discover ② mini 前の機械判定。
 * - yahoo_news: 国内/経済/国際ランキング由来 — ゴミ除外のみ（争点判定は mini）
 * - youtube: News&Politics 収集源 — ゴミ除外のみ
 * - yahoo_rt: スポーツ genre 除外 + ニュース系 genre は通す + 争点語
 * - trends: 争点語ヒント or ゴミでなければ通す（スポーツ総合トレンド除去）
 */
export function shouldKeepBuzzTerm(input: BuzzTermInput): boolean {
  const t = input.term.trim();
  if (isBuzzGarbageTerm(t, input.genre)) return false;

  if (input.source === "youtube" || input.source === "yahoo_news") return true;

  if (IN_SCOPE_BUZZ_HINTS.test(t)) return true;

  if (input.source === "yahoo_rt") {
    if (input.genre && YAHOO_RT_NEWS_GENRE.test(input.genre) && t.length >= 4) return true;
    if (input.genre && /スポーツ|エンタメ|ゲーム|アニメ|芸能/i.test(input.genre)) return false;
    if (t.length >= 6) return true;
  }

  if (input.source === "trends" && t.length >= 4 && !isOutOfScopeTopic(t, [t])) return true;

  return false;
}

export function prefilterBuzzInputs(inputs: BuzzTermInput[]): BuzzTermInput[] {
  const seen = new Set<string>();
  const out: BuzzTermInput[] = [];
  for (const item of inputs) {
    const key = item.term.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    if (!shouldKeepBuzzTerm(item)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function prefilterBuzzTerms(terms: string[], source: BuzzTermSource): string[] {
  return prefilterBuzzInputs(terms.map((term) => ({ term, source }))).map((i) => i.term);
}
