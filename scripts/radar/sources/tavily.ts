/**
 * Tavily検索API — LLMエージェント向けに設計された軽量Web検索（無料枠あり・APIキー必須）。
 *
 * 役割は「発見」だけに絞る。ページ本文の取得は既存の fetchPageText 系
 * （primary-text.ts / report-text.ts）に任せ、ここではtitle/urlだけを返す。
 * 検索エンジン（発見担当）と編集デスク（執筆担当）を分離することで、
 * 既に磨き込んだ執筆プロンプト・断定表現チェック・claims裏取り検証をそのまま活かせる。
 *
 * TAVILY_API_KEY未設定時は空配列を返し、既存ソース（官公庁RSS・Google News等）だけで
 * 調査を続行する（Radar全体を止めない・段階的導入を可能にする）。
 * 発見範囲が広がる分の品質担保は、Writer/Verify間の主張裏取り検証（radar-article.ts）が担う。
 */
const TAVILY_URL = "https://api.tavily.com/search";

export interface TavilyResult {
  title: string;
  url: string;
  /** Tavilyが抽出したページ抜粋（本文全体ではない。品質の目安程度に留める） */
  content: string;
}

export async function searchTavily(query: string, maxResults = 6): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey || query.trim().length < 2) return [];
  try {
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: maxResults,
      }),
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
