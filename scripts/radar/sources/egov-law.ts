/**
 * e-Gov法令検索 API v2（デジタル庁、無料・APIキー不要）。
 * https://laws.e-gov.go.jp/api/2/swagger-ui/
 */
const LAWS_API = "https://laws.e-gov.go.jp/api/2/laws";
const KEYWORD_API = "https://laws.e-gov.go.jp/api/2/keyword";
const UA = "FactBaseRadar/1.0 (+https://factbase.tokyo)";

/**
 * law_titleはタイトル文字列に対する検索のため、「消費税減税」のような政策的な言い回しは
 * 実在の法令名（例:「消費税法」）に一致せず0件になりやすい（実データで確認済み: 「消費税減税」0件/
 * 「消費税」5件ヒット）。よくある政策動詞・語尾を機械的に剥がして検索語を増やすことで、
 * 「消費税」のような核となる名詞だけを別クエリとしても試せるようにする。
 */
const POLICY_SUFFIXES =
  /(減税|増税|引き上げ|引き下げ|改正|見直し|強化|規制|義務化|撤廃|廃止|凍結|導入|骨抜き|緩和|拡充|創設|新設)+$/;

/** よくある表記ゆれ・略称と法令名の対応（e-Gov検索で0件になりやすい代表例のみ、軽量に維持） */
const LAW_SYNONYMS: Record<string, string> = {
  夫婦別姓: "民法",
  選択的夫婦別姓: "民法",
  入管法: "出入国管理及び難民認定法",
  入管難民法: "出入国管理及び難民認定法",
  労働者派遣: "労働者派遣事業の適正な運営の確保及び派遣労働者の保護等に関する法律",
  マイナンバー: "行政手続における特定の個人を識別するための番号の利用等に関する法律",
  国旗損壊: "刑法",
};

/**
 * 検索対象語のバリエーションを生成する（元語→語尾を剥がした核語→核語+「法」→既知の同義語）。
 * 重複は除く。呼び出し側は先頭から順に試し、ヒットがあれば以降は補完のみに使う。
 */
export function buildLawSearchTerms(topic: string): string[] {
  const term = topic.trim();
  if (!term) return [];
  const stripped = term.replace(POLICY_SUFFIXES, "").trim();
  const candidates = [
    term,
    LAW_SYNONYMS[term],
    stripped,
    LAW_SYNONYMS[stripped],
    stripped && !stripped.endsWith("法") ? `${stripped}法` : undefined,
  ].filter((t): t is string => typeof t === "string" && t.length >= 2);
  return [...new Set(candidates)];
}

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

async function fetchLawsByTitle(titleQuery: string, limit: number): Promise<Omit<LawInfo, "articleSnippets">[]> {
  const params = new URLSearchParams({ law_title: titleQuery, limit: String(Math.min(limit, 10)) });
  const res = await fetch(`${LAWS_API}?${params.toString()}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { laws?: RawLaw[] };
  const laws = Array.isArray(data.laws) ? data.laws : [];

  return laws
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
      };
    })
    .filter((l) => l.lawTitle && l.url && l.lawId);
}

/**
 * 「消費税減税」のような政策語がそのまま実在法令名に一致しないケースを
 * buildLawSearchTerms（語尾剥がし・同義語）の複数バリエーションで拾う。
 * 元語で十分ヒットすればそれ以降のバリエーションは試さない（API呼び出しを抑える）。
 */
export async function searchLaws(term: string, limit = 3): Promise<LawInfo[]> {
  if (term.trim().length < 2) return [];
  const candidates = buildLawSearchTerms(term);
  const byLawId = new Map<string, Omit<LawInfo, "articleSnippets">>();

  for (const candidate of candidates) {
    if (byLawId.size >= limit) break;
    try {
      const found = await fetchLawsByTitle(candidate, limit);
      for (const l of found) if (!byLawId.has(l.lawId)) byLawId.set(l.lawId, l);
    } catch (e) {
      console.warn(`  ⚠️ egov-law (${candidate}): 取得失敗 (${e})`);
    }
  }

  const base = [...byLawId.values()].slice(0, limit);
  if (base.length === 0) return [];

  const snippetMap = await fetchKeywordSnippetsByLawId(term, new Set(base.map((l) => l.lawId)));
  return base.map((l) => ({
    ...l,
    articleSnippets: snippetMap.get(l.lawId) ?? [],
  }));
}
