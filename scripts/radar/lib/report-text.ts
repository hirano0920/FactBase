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
 *   2) Tavily extract（同一URLの本文）
 *   3) Jina Reader（NYT等で有効）
 *   4) Tavily search（URLスラッグの英語クエリ + AP/BBC/AlJazeera等の代替ドメイン）
 */
import { stripHtmlToText } from "./primary-text";
import { resolvePublisherUrl, isGoogleNewsArticleUrl } from "./resolve-google-news-url";
import { extractTavily, searchTavily } from "../sources/tavily";

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
 * （実例: 韓国メディア「디지털투데이」を引用した文が「ディ지털투데이が伝えています」になった）。
 * 英字（Bloomberg等）・漢字仮名は日本語の文中でもそのまま読めるため対象外。
 */
const NON_JA_SCRIPT = /[가-힣ᄀ-ᇿ㄰-㆏Ѐ-ӿ฀-๿؀-ۿऀ-ॿ]/;

function normalizeFeedName(feed: string): string {
  return NON_JA_SCRIPT.test(feed) ? "海外メディア" : feed;
}

const MAX_OUTLETS = 6;
const MAX_CHARS_PER_OUTLET = 2000;
const MIN_EXCERPT_CHARS = 80;
/** extract/Jina がナビだけ返す場合を弾く最低本文長 */
const MIN_SUBSTANTIVE_CHARS = 280;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** 直接 fetch がほぼ確実に弾かれるホスト（bot/ブラウザUAとも） */
export const HARD_BLOCKED_HOST =
  /(?:^|\.)(?:reuters\.com|nytimes\.com|thehill\.com|wsj\.com|ft\.com|bloomberg\.com|economist\.com)$/i;

/** 代替として本文が取れるオープン寄りの海外メディア */
const MIRROR_DOMAINS = [
  "apnews.com",
  "www.bbc.com",
  "www.aljazeera.com",
  "www.theguardian.com",
  "news.yahoo.com",
  "news.yahoo.co.jp",
  "www.asiaone.com",
  "www.iranintl.com",
];

const HOST_MIRROR_PREFERENCE: Record<string, string[]> = {
  "www.reuters.com": MIRROR_DOMAINS,
  "reuters.com": MIRROR_DOMAINS,
  "www.nytimes.com": ["apnews.com", "www.bbc.com", "www.theguardian.com", "www.aljazeera.com"],
  "nytimes.com": ["apnews.com", "www.bbc.com", "www.theguardian.com", "www.aljazeera.com"],
  "thehill.com": ["apnews.com", "www.bbc.com", "news.yahoo.com"],
  "www.thehill.com": ["apnews.com", "www.bbc.com", "news.yahoo.com"],
};

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

/**
 * 英語スラッグから検索クエリを作る（日本語見出しだと海外ミラーがヒットしないため）。
 * 例: /iran-oil-stuck-sea-surges-...-2026-07-10/ → "iran oil stuck sea surges ..."
 */
export function englishQueryFromUrl(url: string, fallbackTitle: string): string {
  try {
    const path = new URL(url).pathname;
    const slug = path.split("/").filter(Boolean).pop() ?? "";
    const fromSlug = slug
      .replace(/\.html?$/i, "")
      .replace(/-\d{4}-\d{2}-\d{2}$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (fromSlug.length >= 12 && /[a-z]/i.test(fromSlug)) return fromSlug;
  } catch {
    // ignore
  }
  return fallbackTitle.trim();
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
  return true;
}

async function fetchWithBrowserUa(
  url: string,
  maxChars: number,
): Promise<{ text: string | null; status: number | null }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
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
      text: text.length >= MIN_EXCERPT_CHARS ? text.slice(0, maxChars) : null,
      status: res.status,
    };
  } catch {
    return { text: null, status: null };
  }
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
    // soft-block / captcha pages
    if (/Just a moment|Attention Required|Enable JavaScript|captcha/i.test(text) && text.length < 800) {
      return null;
    }
    return text.slice(0, maxChars);
  } catch {
    return null;
  }
}

async function fetchViaTavilyExtract(url: string, maxChars: number): Promise<string | null> {
  const results = await extractTavily([url]);
  const hit = results.find((r) => r.url === url) ?? results[0];
  if (!hit || !isSubstantiveArticleText(hit.text)) return null;
  // ナビ付き raw から本文寄りのテキストに整える
  const distilled = distillArticleText(hit.text);
  return (distilled.length >= MIN_SUBSTANTIVE_CHARS ? distilled : hit.text).slice(0, maxChars);
}

async function fetchViaTavilySearch(
  title: string,
  preferredUrl: string,
  maxChars: number,
): Promise<{ url: string; text: string } | null> {
  const host = hostnameOf(preferredUrl);
  const mirrors = host ? (HOST_MIRROR_PREFERENCE[host] ?? MIRROR_DOMAINS) : MIRROR_DOMAINS;
  const enQuery = englishQueryFromUrl(preferredUrl, title);

  const attempts: { query: string; includeDomains?: string[]; depth?: "basic" | "advanced" }[] = [
    // 同一URLが search インデックスにあれば content 付きで返る（Reuters 実測で成功）
    { query: enQuery, depth: "advanced" },
    { query: enQuery, includeDomains: mirrors, depth: "advanced" },
    { query: `${enQuery} AP OR Reuters OR BBC`, includeDomains: mirrors, depth: "basic" },
  ];
  if (title !== enQuery && title.trim().length >= 4) {
    attempts.push({ query: title, includeDomains: mirrors, depth: "basic" });
    attempts.push({ query: title, depth: "basic" });
  }

  for (const attempt of attempts) {
    const results = await searchTavily(attempt.query, 6, {
      includeDomains: attempt.includeDomains,
      searchDepth: attempt.depth ?? "basic",
    });
    if (results.length === 0) continue;

    // 同一ホスト or 同一記事を最優先
    const same =
      results.find((r) => r.url === preferredUrl) ??
      results.find((r) => {
        try {
          return host != null && new URL(r.url).hostname.toLowerCase() === host;
        } catch {
          return false;
        }
      });
    if (same?.content && same.content.length >= MIN_EXCERPT_CHARS) {
      return { url: same.url, text: same.content.slice(0, maxChars) };
    }

    const best = results.find((r) => r.content.length >= MIN_EXCERPT_CHARS);
    if (best) return { url: best.url, text: best.content.slice(0, maxChars) };
  }

  return null;
}

/**
 * 単一URLの本文取得（直接→extract→Jina→search代替）。テスト・デバッグ用に公開。
 */
export async function fetchNewsExcerptText(
  url: string,
  title: string,
  maxChars = MAX_CHARS_PER_OUTLET,
): Promise<{ text: string; url: string; via: string } | null> {
  const blocked = isHardBlockedHost(url);

  if (!blocked) {
    const direct = await fetchWithBrowserUa(url, maxChars);
    if (direct.text) return { text: direct.text, url, via: "direct" };
  }

  // ブロック系は search の方が本文スニペットが綺麗（extract はナビ混入が多い）
  const searched = await fetchViaTavilySearch(title, url, maxChars);
  if (searched) return { text: searched.text, url: searched.url, via: "tavily-search" };

  const extracted = await fetchViaTavilyExtract(url, maxChars);
  if (extracted) return { text: extracted, url, via: "tavily-extract" };

  const jina = await fetchViaJina(url, maxChars);
  if (jina) return { text: jina, url, via: "jina" };

  // 非ブロックで direct 失敗した場合の最後の手段
  if (!blocked) {
    const searched2 = await fetchViaTavilySearch(title, url, maxChars);
    if (searched2) return { text: searched2.text, url: searched2.url, via: "tavily-search" };
  }

  return null;
}

/** 媒体ごとの本文取得を並列化する上限（Tavily/Jina のレート制限を避ける） */
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
        const fb = await fetchViaTavilySearch(s.title, s.url, MAX_CHARS_PER_OUTLET);
        if (fb) {
          fallbackHits++;
          return { feed: s.feed, title: s.title, url: fb.url, text: fb.text } satisfies ReportExcerpt;
        }
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
