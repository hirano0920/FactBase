/**
 * Wikipedia日本語版 REST API（無料・APIキー不要）。
 * https://ja.wikipedia.org/api/rest_v1/
 *
 * Radarの能動調査（③）が国会会議録・法令・時事ニュースだけでは埋められない穴を埋める。
 * 歴史問題・人権問題・外国人問題・国際情勢のような「そもそもこれは何か」という
 * 背景解説が必須の争点は、ニュース速報だけでは書けない。Wikipedia要約はこの土台を
 * 即座に無料で提供できる唯一のソース。
 *
 * まず完全一致のsummaryを試し、404なら検索APIでタイトルを引いてから再取得する
 * （バズ語は正式名称と表記ゆれがあるため）。
 */
const SUMMARY_API = "https://ja.wikipedia.org/api/rest_v1/page/summary";
const SEARCH_API = "https://ja.wikipedia.org/w/api.php";
const UA = "FactBaseRadar/1.0 (+https://factbase.tokyo)";

export interface WikipediaBackground {
  title: string;
  extract: string; // 要約本文
  url: string;
}

async function fetchSummary(title: string): Promise<WikipediaBackground | null> {
  const res = await fetch(`${SUMMARY_API}/${encodeURIComponent(title)}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
  const extract = String(data.extract ?? "").trim();
  if (!extract) return null;
  return {
    title: String(data.title ?? title).trim(),
    extract,
    url: data.content_urls?.desktop?.page ?? `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

/** 完全一致ページが無い場合、全文検索で最も近いタイトルを1件引く */
async function searchTitle(term: string): Promise<string | null> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: term,
    format: "json",
    srlimit: "1",
  });
  const res = await fetch(`${SEARCH_API}?${params.toString()}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { query?: { search?: { title?: string }[] } };
  return data.query?.search?.[0]?.title ?? null;
}

/**
 * トピック語の背景解説を取得する。完全一致→検索フォールバックの2段構え。
 * 取得失敗・該当なしは null（能動調査全体を止めない）。
 */
export async function fetchWikipediaBackground(term: string): Promise<WikipediaBackground | null> {
  if (term.trim().length < 2) return null;
  try {
    const exact = await fetchSummary(term);
    if (exact) return exact;

    const matchedTitle = await searchTitle(term);
    if (!matchedTitle) return null;
    return await fetchSummary(matchedTitle);
  } catch (e) {
    console.warn(`  ⚠️ wikipedia (${term}): 取得失敗 (${e})`);
    return null;
  }
}
