/**
 * e-Gov法令検索 API v2（デジタル庁、無料・APIキー不要）。
 * https://laws.e-gov.go.jp/api/2/swagger-ui/
 */
const LAWS_API = "https://laws.e-gov.go.jp/api/2/laws";
const KEYWORD_API = "https://laws.e-gov.go.jp/api/2/keyword";
const UA = "FactBaseRadar/1.0 (+https://factbase.tokyo)";

export interface LawArticleSnippet {
  /** mainprovision 等 */
  position: string;
  text: string;
}

export interface LawInfo {
  lawTitle: string;
  lawNum: string;
  promulgationDate: string;
  category: string;
  repealStatus: string;
  url: string;
  lawId: string;
  /** keyword API から取得した関連条文抜粋（最大2件/法令） */
  articleSnippets: LawArticleSnippet[];
}

interface RawLaw {
  law_info?: { law_id?: string; law_num?: string; promulgation_date?: string };
  revision_info?: { law_title?: string; category?: string; repeal_status?: string };
}

interface KeywordItem {
  law_info?: { law_id?: string };
  sentences?: Array<{ position?: string; text?: string }>;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, "").trim();
}

function truncate(text: string, max = 280): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

async function fetchKeywordSnippetsByLawId(
  keyword: string,
  lawIds: Set<string>,
): Promise<Map<string, LawArticleSnippet[]>> {
  const out = new Map<string, LawArticleSnippet[]>();
  if (keyword.trim().length < 2 || lawIds.size === 0) return out;

  try {
    const params = new URLSearchParams({ keyword: keyword.trim(), limit: "20" });
    const res = await fetch(`${KEYWORD_API}?${params.toString()}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { items?: KeywordItem[] };
    for (const item of data.items ?? []) {
      const lawId = String(item.law_info?.law_id ?? "").trim();
      if (!lawId || !lawIds.has(lawId)) continue;
      const snippets: LawArticleSnippet[] = [];
      for (const s of item.sentences ?? []) {
        const text = truncate(stripHtml(String(s.text ?? "")));
        if (text.length < 8) continue;
        snippets.push({ position: String(s.position ?? "mainprovision"), text });
        if (snippets.length >= 2) break;
      }
      if (snippets.length > 0) out.set(lawId, snippets);
    }
  } catch (e) {
    console.warn(`  ⚠️ egov-law keyword (${keyword}): 条文抜粋取得失敗 (${e})`);
  }
  return out;
}

export async function searchLaws(term: string, limit = 3): Promise<LawInfo[]> {
  if (term.trim().length < 2) return [];
  try {
    const params = new URLSearchParams({ law_title: term, limit: String(Math.min(limit, 10)) });
    const res = await fetch(`${LAWS_API}?${params.toString()}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { laws?: RawLaw[] };
    const laws = Array.isArray(data.laws) ? data.laws : [];

    const base = laws
      .map((l) => {
        const lawId = String(l.law_info?.law_id ?? "").trim();
        return {
          lawTitle: String(l.revision_info?.law_title ?? "").trim(),
          lawNum: String(l.law_info?.law_num ?? "").trim(),
          promulgationDate: String(l.law_info?.promulgation_date ?? "").trim(),
          category: String(l.revision_info?.category ?? "").trim(),
          repealStatus: String(l.revision_info?.repeal_status ?? "").trim(),
          url: lawId ? `https://laws.e-gov.go.jp/law/${lawId}` : "",
          lawId,
          articleSnippets: [] as LawArticleSnippet[],
        };
      })
      .filter((l) => l.lawTitle && l.url && l.lawId);

    const snippetMap = await fetchKeywordSnippetsByLawId(term, new Set(base.map((l) => l.lawId)));
    return base.map((l) => ({
      ...l,
      articleSnippets: snippetMap.get(l.lawId) ?? [],
    }));
  } catch (e) {
    console.warn(`  ⚠️ egov-law (${term}): 取得失敗 (${e})`);
    return [];
  }
}
