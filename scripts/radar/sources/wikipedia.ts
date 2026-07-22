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

export interface WikipediaProfile extends WikipediaBackground {
  /** サムネイル画像URL（page/summaryのthumbnailフィールド。無ければnull） */
  thumbnailUrl: string | null;
}

async function fetchSummaryWithThumbnail(
  title: string,
): Promise<{ title: string; extract: string; url: string; thumbnailUrl: string | null } | null> {
  const res = await fetch(`${SUMMARY_API}/${encodeURIComponent(title)}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    title?: string;
    extract?: string;
    thumbnail?: { source?: string };
    content_urls?: { desktop?: { page?: string } };
  };
  const extract = String(data.extract ?? "").trim();
  if (!extract) return null;
  return {
    title: String(data.title ?? title).trim(),
    extract,
    url: data.content_urls?.desktop?.page ?? `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    thumbnailUrl: data.thumbnail?.source ?? null,
  };
}

/**
 * 政治家プロフィール取得（summary＝写真・経歴のみ）。
 * 政治家名は参議院名簿由来だと「姓 名」のように半角スペース区切りだが、日本語版Wikipediaの
 * 人物記事タイトルは通常スペース無し（例:「青木愛」）なので、まずスペース除去した表記で試し、
 * 見つからなければ元の表記→全文検索（fetchWikipediaBackgroundと同じ緩い関連度判定）の順に緩める。
 */
export async function fetchWikipediaPoliticianProfile(name: string): Promise<WikipediaProfile | null> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null;
  try {
    const noSpace = trimmed.replace(/\s+/g, "");
    let summary = await fetchSummaryWithThumbnail(noSpace).catch(() => null);
    if (!summary && noSpace !== trimmed) {
      summary = await fetchSummaryWithThumbnail(trimmed).catch(() => null);
    }
    if (!summary) {
      const candidates = await searchTitles(trimmed);
      const matchedTitle = candidates.find((title) => isRelevantTitle(noSpace, title));
      if (!matchedTitle) return null;
      summary = await fetchSummaryWithThumbnail(matchedTitle).catch(() => null);
    }
    if (!summary) return null;

    return summary;
  } catch (e) {
    console.warn(`  ⚠️ wikipedia politician profile (${name}): 取得失敗 (${e})`);
    return null;
  }
}
