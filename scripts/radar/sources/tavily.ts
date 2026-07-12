/**
 * Tavily検索API — LLMエージェント向けに設計された軽量Web検索（無料枠あり・APIキー必須）。
 *
 * 発見（search）に加え、直接 fetch が 401/403 の海外メディア向けに extract も提供する。
 * TAVILY_API_KEY未設定時は空配列/nullを返し、既存ソースだけで調査を続行する。
 */
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

export interface TavilyResult {
  title: string;
  url: string;
  /** Tavilyが抽出したページ抜粋（本文全体ではない。品質の目安程度に留める） */
  content: string;
}

export interface TavilySearchOptions {
  /** 直近N日に限定（Tavily days パラメータ）。長期経緯用に 365 等 */
  days?: number;
  /** 特定ドメインを優先（例: apnews.com）。403で落ちた本体の代替に使う */
  includeDomains?: string[];
  searchDepth?: "basic" | "advanced";
}

export async function searchTavily(
  query: string,
  maxResults = 6,
  options: TavilySearchOptions = {},
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || query.trim().length < 2) return [];
  try {
    const body: Record<string, unknown> = {
      api_key: apiKey,
      query,
      search_depth: options.searchDepth ?? "basic",
      max_results: maxResults,
    };
    if (typeof options.days === "number" && options.days > 0) body.days = options.days;
    if (options.includeDomains && options.includeDomains.length > 0) {
      body.include_domains = options.includeDomains;
    }
    const res = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (data.results ?? [])
      .map((r) => ({
        title: String(r.title ?? "").trim(),
        url: String(r.url ?? "").trim(),
        content: String(r.content ?? "").trim(),
      }))
      .filter((r) => r.title && r.url);
  } catch (e) {
    console.warn(`  ⚠️ tavily(${query}): 取得失敗 (${e})`);
    return [];
  }
}

/**
 * 直接 fetch が弾かれる URL（Reuters 401 等）から本文を取る。
 * ナビだらけの薄い結果は呼び出し側で弾く。
 */
export async function extractTavily(urls: string[]): Promise<{ url: string; title: string; text: string }[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  const cleaned = urls.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
  if (!apiKey || cleaned.length === 0) return [];
  try {
    const res = await fetch(TAVILY_EXTRACT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, urls: cleaned.slice(0, 5) }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      results?: { url?: string; title?: string; raw_content?: string }[];
    };
    return (data.results ?? [])
      .map((r) => ({
        url: String(r.url ?? "").trim(),
        title: String(r.title ?? "").trim(),
        text: String(r.raw_content ?? "").trim(),
      }))
      .filter((r) => r.url && r.text.length >= 80);
  } catch (e) {
    console.warn(`  ⚠️ tavily-extract: 取得失敗 (${e})`);
    return [];
  }
}
