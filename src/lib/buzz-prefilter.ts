/**
 * バズ語の機械プリフィルタ（discover ①→② の間）。
 * 試合結果・熱愛・天気・広告など「賛否が取れないゴミ」だけ落とし、火種候補は mini に任せる。
 * 政治ヒント必須にはしない（TwoSides: 社会炎上・生活争点も通す）。
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

/**
 * 賛否が取れないライフ・ゴシップ見出し。
 * 「不倫」「ハラスメント騒動」は声明対立型のこともあるため、対立マーカー無しの慶事・色恋だけ弾く。
 * 最終判断は filterRelevantTopics（AI）に委ねる。
 */
const LIFESTYLE_HEADLINE =
  /ご祝儀|熱愛|結婚式|ダイエット|レシピ|天気予報|週間天気|高校野球|SKハイニックス|(?:商品)?セール|クーポン|ポイント還元/i;

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
 * - yahoo_news / youtube: ソース由来を信頼 — ゴミ除外のみ
 * - yahoo_rt / trends: ゴミでなければ通す（政治ヒントは必須ではない。あれば加点的に通す）
 */
export function shouldKeepBuzzTerm(input: BuzzTermInput): boolean {
  const t = input.term.trim();
  if (isBuzzGarbageTerm(t, input.genre)) return false;

  if (input.source === "youtube" || input.source === "yahoo_news") return true;

  if (IN_SCOPE_BUZZ_HINTS.test(t)) return true;

  if (input.source === "yahoo_rt") {
    if (input.genre && /スポーツ|エンタメ|ゲーム|アニメ|芸能/i.test(input.genre)) return false;
    if (input.genre && YAHOO_RT_NEWS_GENRE.test(input.genre) && t.length >= 4) return true;
    if (t.length >= 6) return true;
  }

  // Trends: ゴミでなければ mini に渡す（政治語ヒント必須にしない）
  if (input.source === "trends" && t.length >= 4) return true;

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
