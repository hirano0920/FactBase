/**
 * REPORTED（報道ベース）争点の記事品質を上げるための報道本文の取得。
 *
 * Google News RSS の URL は news.google.com/articles/… のエンコード形式のため、
 * そのままでは本文が取れない。resolvePublisherUrl で出版社URLに解決してから取得する。
 * 取得失敗時は Tavily の content 抜粋をフォールバックに使う（キーがある場合）。
 */
import { fetchPageText } from "./primary-text";
import { resolvePublisherUrl, isGoogleNewsArticleUrl } from "./resolve-google-news-url";
import { searchTavily } from "../sources/tavily";

export interface ReportExcerpt {
  feed: string;
  title: string;
  url: string;
  text: string;
}

const MAX_OUTLETS = 6;
const MAX_CHARS_PER_OUTLET = 2000;
const MIN_EXCERPT_CHARS = 80;

/** ブラウザ寄りの UA（一部報道サイトは bot UA を弾く） */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function fetchNewsPageText(url: string, maxChars: number): Promise<string | null> {
  // primary-text の fetchPageText は FactBaseRadar UA。報道はブラウザ UA で再試行する
  const first = await fetchPageText(url, maxChars);
  if (first) return first;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) return null;
    const { stripHtmlToText } = await import("./primary-text");
    const text = stripHtmlToText(await res.text());
    return text.length >= MIN_EXCERPT_CHARS ? text.slice(0, maxChars) : null;
  } catch {
    return null;
  }
}

async function tavilyFallback(title: string, preferredUrl?: string): Promise<{ url: string; text: string } | null> {
  const results = await searchTavily(title, 4);
  if (results.length === 0) return null;

  if (preferredUrl) {
    const hit = results.find((r) => r.url === preferredUrl || preferredUrl.includes(new URL(r.url).hostname));
    if (hit?.content && hit.content.length >= MIN_EXCERPT_CHARS) {
      return { url: hit.url, text: hit.content.slice(0, MAX_CHARS_PER_OUTLET) };
    }
  }

  const best = results.find((r) => r.content.length >= MIN_EXCERPT_CHARS);
  if (!best) return null;
  return { url: best.url, text: best.content.slice(0, MAX_CHARS_PER_OUTLET) };
}

/**
 * ソース一覧から媒体（feed）ごとに最新1件ずつ、最大MAX_OUTLETS媒体分の本文抜粋を取得する。
 * 同一媒体を何件も取っても「食い違いの整理」には寄与しないため、媒体の多様性を優先する。
 */
export async function fetchReportExcerpts(
  sources: { title: string; url: string; feed: string }[],
): Promise<ReportExcerpt[]> {
  const byFeedLatest = new Map<string, { title: string; url: string; feed: string }>();
  for (const s of sources) byFeedLatest.set(s.feed, s);
  // 先頭寄り（新しい順で入っている想定）も拾えるよう、末尾だけでなく多様性を保つ
  const all = Array.from(byFeedLatest.values());
  const targets = all.slice(0, MAX_OUTLETS);

  const excerpts: ReportExcerpt[] = [];
  let resolved = 0;
  let fetched = 0;
  let tavilyHits = 0;

  for (const s of targets) {
    let publisherUrl = s.url;
    if (isGoogleNewsArticleUrl(s.url)) {
      const resolvedUrl = await resolvePublisherUrl(s.url);
      if (!resolvedUrl) {
        console.warn(`  ⚠️ report-text: Google News URL解決失敗 — ${s.feed} / ${s.title.slice(0, 40)}`);
        const fb = await tavilyFallback(s.title);
        if (fb) {
          tavilyHits++;
          excerpts.push({ feed: s.feed, title: s.title, url: fb.url, text: fb.text });
        }
        continue;
      }
      publisherUrl = resolvedUrl;
      resolved++;
    }

    const text = await fetchNewsPageText(publisherUrl, MAX_CHARS_PER_OUTLET);
    if (text) {
      fetched++;
      excerpts.push({ feed: s.feed, title: s.title, url: publisherUrl, text });
      continue;
    }

    console.warn(`  ⚠️ report-text: 本文取得失敗 — ${s.feed} / ${publisherUrl.slice(0, 80)}`);
    const fb = await tavilyFallback(s.title, publisherUrl);
    if (fb) {
      tavilyHits++;
      excerpts.push({ feed: s.feed, title: s.title, url: fb.url, text: fb.text });
    }
  }

  console.log(
    `  📰 report-text: 対象${targets.length}媒体 → 抜粋${excerpts.length}件` +
      `（GN解決${resolved} / 直接取得${fetched} / Tavily補完${tavilyHits}）`,
  );
  if (targets.length > 0 && excerpts.length === 0) {
    console.warn(`  ⚠️ report-text: ${targets.length}媒体すべて本文取得失敗（記事の数字・claims検証がほぼ落ちる）`);
  }

  return excerpts;
}
