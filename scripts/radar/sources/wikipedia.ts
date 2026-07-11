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

/** 完全一致ページが無い場合、全文検索で最も近いタイトルを複数件引く（関連度フィルタで足切りするため） */
async function searchTitles(term: string, limit = 3): Promise<string[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: term,
    format: "json",
    srlimit: String(limit),
  });
  const res = await fetch(`${SEARCH_API}?${params.toString()}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { query?: { search?: { title?: string }[] } };
  return (data.query?.search ?? []).map((s) => s.title ?? "").filter(Boolean);
}

/** 助詞等、関連度判定のノイズになる文字（比較前に除く） */
const PARTICLE_CHARS = new Set([..."のとにをはがでへやも、。・ "]);

function meaningfulChars(s: string): Set<string> {
  return new Set([...s].filter((c) => !PARTICLE_CHARS.has(c)));
}

/**
 * 全文検索は「一番近そうな1件」を機械的に返すため、争点語と全く無関係な同音・多義語の
 * ページを拾うことがある（辞書定義混入の一因）。「日の丸」→「日本の国旗」のような
 * 同義語的な表記ゆれは通したいので、部分文字列一致に加えて意味のある文字の共有率でも判定する
 * （2文字以上共有、または争点語の意味文字の3割以上を共有していれば関連ありとみなす緩い足切り）。
 */
function isRelevantTitle(term: string, title: string): boolean {
  const t = term.trim();
  const ti = title.trim();
  if (!t || !ti) return false;
  if (ti.includes(t) || t.includes(ti)) return true;

  const termChars = meaningfulChars(t);
  const titleChars = meaningfulChars(ti);
  if (termChars.size === 0) return false;
  let shared = 0;
  for (const c of termChars) if (titleChars.has(c)) shared++;
  return shared >= Math.min(2, termChars.size) || shared / termChars.size >= 0.3;
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

    const candidates = await searchTitles(term);
    const matchedTitle = candidates.find((title) => isRelevantTitle(term, title));
    if (!matchedTitle) return null;
    return await fetchSummary(matchedTitle);
  } catch (e) {
    console.warn(`  ⚠️ wikipedia (${term}): 取得失敗 (${e})`);
    return null;
  }
}
