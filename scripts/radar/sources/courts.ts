/**
 * 裁判所は公式RSSがないためHTML差分監視で補う。
 * 「お知らせ」ページは構造化されたリストなので項目単位で抽出、
 * 「最高裁開廷期日情報」ページは表組みが複雑で項目分解が壊れやすいため
 * ページ全体の指紋(先頭の短いハッシュ)をタイトルに埋め込み、内容が変わった時だけ
 * 新しいSourceEventとして検知させる（既存のfeedName+titleハッシュ重複排除に自然に乗る）。
 */
import { createHash } from "node:crypto";
import { parseJapaneseDate, isWithinDays, type FeedItem } from "./common";

const NEWS_URL = "https://www.courts.go.jp/news/index.html";
const KIJITSU_URL = "https://www.courts.go.jp/saikosai/kengaku/saikousai_kijitsu/index.html";
const UA = "FactBaseRadar/1.0 (+https://factbase.tokyo)";

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.warn(`  ⚠️ courts (${url}): 取得失敗 (${e})`);
    return null;
  }
}

/** 「お知らせ」一覧を項目単位で抽出（直近30日のみ・バックログ流入防止） */
export async function fetchCourtsNews(): Promise<FeedItem[]> {
  const html = await fetchText(NEWS_URL);
  if (!html) return [];

  const items: FeedItem[] = [];
  const pattern =
    /<span class="module-news-pub-time">([\s\S]*?)<\/span>[\s\S]*?<a title="([^"]*)" href="([^"]*)"/g;

  for (const m of html.matchAll(pattern)) {
    const dateText = m[1].replace(/\s+/g, "");
    const title = m[2].trim();
    const href = m[3].trim();
    if (!title || !href) continue;

    const publishedAt = parseJapaneseDate(dateText) ?? new Date();
    if (!isWithinDays(publishedAt, 30)) continue;

    let url: string;
    try {
      url = new URL(href, NEWS_URL).toString();
    } catch {
      continue;
    }

    items.push({ feedName: "courts-news", trust: 95, title, url, publishedAt });
  }
  return items;
}

/** 開廷期日情報ページの指紋監視（構造が複雑なため項目分解せず変更検知のみ） */
export async function fetchCourtsKijitsu(lastFingerprint?: string | null): Promise<FeedItem[]> {
  const html = await fetchText(KIJITSU_URL);
  if (!html) return [];

  const bodyMatch = html.match(
    /<div class="module-sub-page-parts-default-5">([\s\S]*?)<\/div>\s*<\/div>/,
  );
  const body = (bodyMatch?.[1] ?? html).replace(/\s+/g, " ").trim();
  const fingerprint = createHash("sha256").update(body).digest("hex").slice(0, 10);

  if (lastFingerprint && lastFingerprint === fingerprint) return [];

  return [
    {
      feedName: "courts-kijitsu",
      trust: 90,
      title: `最高裁判所開廷期日情報が更新されました (fp:${fingerprint})`,
      url: KIJITSU_URL,
      publishedAt: new Date(),
    },
  ];
}

/** courts-kijitsu タイトルから指紋を取り出す */
export function extractCourtsKijitsuFingerprint(title: string): string | null {
  return title.match(/fp:([a-f0-9]{10})/)?.[1] ?? null;
}
