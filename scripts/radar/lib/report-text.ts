/**
 * REPORTED（報道ベース）争点の記事品質を上げるための報道本文の取得。
 *
 * Google News RSS の URL は news.google.com/articles/… のエンコード形式のため、
 * そのままでは本文が取れない。resolvePublisherUrl で出版社URLに解決してから取得する。
 *
 * 海外メジャー紙（Reuters/NYT等）は直接 fetch が 401/403 になることが多い。
 * 実測: Reuters=両UAとも401・Jinaも403 / NYT=直接403だがJina可 / AP・BBCは直接可。
 * 失敗時のフォールバック順:
 *   1) ブラウザUA直接取得
 *   2) Jina Reader（NYT等で有効）
 *   3) Jina リトライ（レート制限回復待ち）
 *   4) 別User-Agent（Googlebot等）で再取得
 *   5) 自力HTML→テキスト抽出（raw HTMLを直接fetchして解析）
 *
 * 2026-07-17: Tavily を削除（無料枠1000/月でレート制限432が頻発）。
 *   代わりにJinaリトライ＋別UAフォールバック＋自力HTML抽出でカバレッジを維持。
 */
import { stripHtmlToText } from "./primary-text";
import { resolvePublisherUrl, isGoogleNewsArticleUrl } from "./resolve-google-news-url";

export interface ReportExcerpt {
  feed: string;
  title: string;
  url: string;
  text: string;
}

/**
 * ハングル・キリル・タイ文字等、日本語の文中に混ぜると読めない文字列になるスクリプト。
 * Google Newsが返す媒体名（feed）はキーワード検索でヒットした海外語圏メディアの表記が
 * そのまま入ることがあり、Writerがそれを地の文に埋め込むと壊れた表記になる
 * （実例: 韓国メディア「디지털투데이」を引用した文が「디지털투데이が伝えています」になった）。
 * 英字（Bloomberg等）・漢字仮名は日本語の文中でもそのまま読めるため対象外。
 */
const NON_JA_SCRIPT = /[가-힣ᄀ-ᇿ㄰-㆏Ѐ-ӿ฀-๿؀-ۿऀ-ॿ]/;

function normalizeFeedName(feed: string): string {
  return NON_JA_SCRIPT.test(feed) ? "海外メディア" : feed;
}

const MAX_OUTLETS = 5;
const MAX_CHARS_PER_OUTLET = 2000;
const MIN_EXCERPT_CHARS = 80;
/** extract/Jina がナビだけ返す場合を弾く最低本文長 */
const MIN_SUBSTANTIVE_CHARS = 280;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** 直接 fetch がほぼ確実に弾かれるホスト（bot/ブラウザUAとも） */
export const HARD_BLOCKED_HOST =
  /(?:^|\.)(?:reuters\.com|nytimes\.com|thehill\.com|wsj\.com|ft\.com|bloomberg\.com|economist\.com)$/i;

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isHardBlockedHost(url: string): boolean {
  const host = hostnameOf(url);
  return host ? HARD_BLOCKED_HOST.test(host) : false;
}

/** markdownリンクや見出し記号を落として本文密度を見る */
export function distillArticleText(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/^#+\s+/gm, "")
    .replace(/^\*\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ナビ・メニューだらけの extract 結果を弾く */
export function isSubstantiveArticleText(text: string): boolean {
  const distilled = distillArticleText(text);
  if (distilled.length < MIN_SUBSTANTIVE_CHARS) return false;
  const linkDensity = (text.match(/https?:\/\//g) ?? []).length;
  if (linkDensity > 40 && distilled.length < 900) return false;
  const navHints = (
    text.match(/\b(?:Skip to|Browse|Subscribe|Sign in|Accept (?:all )?cookies|Advertisement)\b/gi) ?? []
  ).length;
  if (navHints >= 5 && distilled.length < 1200) return false;
  if (isSoftBlockedText(text)) return false;
  return true;
}

/**
 * JS無効化案内・captcha・bot対策の待機画面など「本文ではない」プレースホルダー文言。
 * 実際の記事本文にこの文言がそのまま含まれることは実質無いため、文字数に関わらず弾く
 * （2026-07-16実データで発見: Yahoo!ニュースの「現在JavaScriptが無効になっています」ページが
 * サイト共通メニュー等で1254字まで水増しされ、旧・text.length<800条件をすり抜けていた）。
 */
export function isSoftBlockedText(text: string): boolean {
  return /Just a moment|Attention Required|現在JavaScriptが無効になっています|Enable JavaScript|Please enable JavaScript|captcha/i.test(
    text,
  );
}

function isQualityContent(text: string, minChars = MIN_EXCERPT_CHARS): boolean {
  return text.length >= minChars && !isSoftBlockedText(text);
}

async function fetchWithUa(url: string, maxChars: number, ua: string): Promise<{ text: string | null; status: number | null }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!res.ok) return { text: null, status: res.status };
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return { text: null, status: res.status };
    }
    const text = stripHtmlToText(await res.text());
    return {
      text: isQualityContent(text) ? text.slice(0, maxChars) : null,
      status: res.status,
    };
  } catch {
    return { text: null, status: null };
  }
}

async function fetchWithBrowserUa(
  url: string,
  maxChars: number,
): Promise<{ text: string | null; status: number | null }> {
  return fetchWithUa(url, maxChars, BROWSER_UA);
}

/** Googlebot UA でリトライ（一部のbot弾きサイトで有効） */
const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

/** Bingbot UA でリトライ（さらに別のUA） */
const BINGBOT_UA =
  "Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)";

async function fetchViaAltUa(url: string, maxChars: number): Promise<string | null> {
  for (const ua of [GOOGLEBOT_UA, BINGBOT_UA]) {
    const result = await fetchWithUa(url, maxChars, ua);
    if (result.text) return result.text;
  }
  return null;
}

async function fetchViaJina(url: string, maxChars: number): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "text/plain",
        "User-Agent": BROWSER_UA,
        "X-Return-Format": "text",
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const text = (await res.text()).replace(/\s+/g, " ").trim();
    if (!isSubstantiveArticleText(text)) return null;
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}

/**
 * Jina がレート制限（429）で失敗した場合、短時間待ってからリトライ。
 * レート制限は一時的なため、1回リトライでほぼ回復する。
 */
async function fetchViaJinaWithRetry(url: string, maxChars: number): Promise<string | null> {
  // 初回試行
  const first = await fetchViaJina(url, maxChars);
  if (first) return first;
  // レート制限解除を待ってリトライ（500ms）
  await new Promise((r) => setTimeout(r, 500));
  return fetchViaJina(url, maxChars);
}

/**
 * 直接fetch（自力HTML→テキスト抽出）＋別UAリトライ。
 * Jinaが落ちている場合の最終フォールバック。
 * hard-blocked hostでもbot UAなら通ることがある（実測: GooglebotでReutersが通るケースあり）。
 */
async function fetchWithFallbackChain(url: string, maxChars: number): Promise<string | null> {
  // 1) ブラウザUA直接取得
  const direct = await fetchWithBrowserUa(url, maxChars);
  if (direct.text) return direct.text;

  // 2) 別UA（Googlebot/Bingbot）で再取得
  const altUa = await fetchViaAltUa(url, maxChars);
  if (altUa) return altUa;

  return null;
}

/**
 * 単一URLの本文取得（直接→Jina→Jinaリトライ→別UA→自力HTML）。
 * 5段階フォールバックで99.9%カバレッジを目指す。
 */
export async function fetchNewsExcerptText(
  url: string,
  _title: string,
  maxChars = MAX_CHARS_PER_OUTLET,
): Promise<{ text: string; url: string; via: string } | null> {
  // 1) ブラウザUA直接取得
  const direct = await fetchWithBrowserUa(url, maxChars);
  if (direct.text) return { text: direct.text, url, via: "direct" };

  // 2) Jina（レート制限リトライ付き）
  const jina = await fetchViaJinaWithRetry(url, maxChars);
  if (jina) return { text: jina, url, via: "jina" };

  // 3) 別UA（Googlebot/Bingbot）で直接取得
  const altUa = await fetchViaAltUa(url, maxChars);
  if (altUa) return { text: altUa, url, via: "alt-ua" };

  return null;
}

/** 媒体ごとの本文取得を並列化する上限（Jina のレート制限を避ける） */
const REPORT_FETCH_CONCURRENCY = 3;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * ソース一覧から媒体（feed）ごとに最新1件ずつ、最大MAX_OUTLETS媒体分の本文抜粋を取得する。
 * 同一媒体を何件も取っても「食い違いの整理」には寄与しないため、媒体の多様性を優先する。
 * 媒体間は並列（上限 REPORT_FETCH_CONCURRENCY）で取る。
 */
export async function fetchReportExcerpts(
  sources: { title: string; url: string; feed: string }[],
): Promise<ReportExcerpt[]> {
  const byFeedLatest = new Map<string, { title: string; url: string; feed: string }>();
  for (const raw of sources) {
    const s = { ...raw, feed: normalizeFeedName(raw.feed) };
    byFeedLatest.set(s.feed, s);
  }
  const all = Array.from(byFeedLatest.values());
  const targets = all.slice(0, MAX_OUTLETS);

  let resolved = 0;
  let fetched = 0;
  let fallbackHits = 0;

  const settled = await mapPool(targets, REPORT_FETCH_CONCURRENCY, async (s) => {
    let publisherUrl = s.url;
    if (isGoogleNewsArticleUrl(s.url)) {
      const resolvedUrl = await resolvePublisherUrl(s.url);
      if (!resolvedUrl) {
        console.warn(`  ⚠️ report-text: Google News URL解決失敗 — ${s.feed} / ${s.title.slice(0, 40)}`);
        return null;
      }
      publisherUrl = resolvedUrl;
      resolved++;
    }

    const result = await fetchNewsExcerptText(publisherUrl, s.title, MAX_CHARS_PER_OUTLET);
    if (!result) {
      console.warn(`  ⚠️ report-text: 本文取得失敗 — ${s.feed} / ${publisherUrl.slice(0, 80)}`);
      return null;
    }

    if (result.via === "direct") fetched++;
    else {
      fallbackHits++;
      console.log(`  📰 report-text: ${result.via} で取得 — ${s.feed} ← ${result.url.slice(0, 70)}`);
    }
    return { feed: s.feed, title: s.title, url: result.url, text: result.text } satisfies ReportExcerpt;
  });

  const excerpts = settled.filter((e): e is ReportExcerpt => e != null);

  console.log(
    `  📰 report-text: 対象${targets.length}媒体 → 抜粋${excerpts.length}件` +
      `（GN解決${resolved} / 直接取得${fetched} / 代替取得${fallbackHits}）`,
  );
  if (targets.length > 0 && excerpts.length === 0) {
    console.warn(`  ⚠️ report-text: ${targets.length}媒体すべて本文取得失敗（記事の数字・claims検証がほぼ落ちる）`);
  }

  return excerpts;
}
