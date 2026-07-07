/**
 * discover/research 用の検索語生成（国内深掘り・海外News）。
 */
import { extractBuzzMatchTokens } from "../../../src/lib/buzz-cross-match";
import { IN_SCOPE_BUZZ_HINTS } from "../../../src/lib/buzz-scope";

const MAX_DOMESTIC_QUERIES = 5;
const MAX_INTL_QUERIES = 5;

/** 海外News向けの英語エンティティ（日本語トピックから追加クエリ） */
const INTL_ENTITY_EN: Record<string, string> = {
  台湾: "Taiwan",
  中国: "China",
  対中: "China relations",
  ウクライナ: "Ukraine",
  ロシア: "Russia",
  イラン: "Iran",
  イスラエル: "Israel",
  北朝鮮: "North Korea",
  韓国: "South Korea",
  中東: "Middle East",
  台湾海峡: "Taiwan Strait",
  ウクライナ侵攻: "Ukraine invasion",
  ガザ: "Gaza",
  ハマス: "Hamas",
  台湾問題: "Taiwan issue",
};

const FINANCE_HINTS = /為替|円高|円安|金利|日銀|FRB|ECB|株|インフレ|デフレ|金融|ビットコイン|ウォール街|ダウ/i;
const WAR_HINTS = /戦争|侵攻|ミサイル|軍事|空爆|紛争|開戦|砲撃|テロ/i;

function pushUnique(queries: string[], value: string): void {
  const v = value.trim();
  if (v.length < 2) return;
  if (queries.some((q) => q === v || q.includes(v) || v.includes(q))) return;
  queries.push(v);
}

/** 深掘り用の国内検索語（国会・法令・Google News 国内） */
export function buildResearchSearchTerms(topic: string): string[] {
  const trimmed = topic.trim();
  const queries: string[] = [];
  if (trimmed.length >= 2) pushUnique(queries, trimmed);

  for (const tok of extractBuzzMatchTokens(trimmed)) {
    if (queries.length >= MAX_DOMESTIC_QUERIES) break;
    if (tok.length < 3 && !IN_SCOPE_BUZZ_HINTS.test(tok)) continue;
    pushUnique(queries, tok);
  }

  if (FINANCE_HINTS.test(trimmed) && queries.length < MAX_DOMESTIC_QUERIES) {
    pushUnique(queries, "為替 円");
    pushUnique(queries, "日銀 政策");
  }
  if (WAR_HINTS.test(trimmed) && queries.length < MAX_DOMESTIC_QUERIES) {
    pushUnique(queries, "安全保障");
  }

  return queries.slice(0, MAX_DOMESTIC_QUERIES);
}

/** 海外/英字 Google News 用（英語クエリを追加） */
export function buildInternationalNewsQueries(topic: string): string[] {
  const trimmed = topic.trim();
  const queries: string[] = [];
  if (trimmed.length >= 2) pushUnique(queries, trimmed);

  for (const [ja, en] of Object.entries(INTL_ENTITY_EN)) {
    if (trimmed.includes(ja)) pushUnique(queries, en);
  }

  for (const tok of extractBuzzMatchTokens(trimmed)) {
    if (queries.length >= MAX_INTL_QUERIES) break;
    const en = INTL_ENTITY_EN[tok];
    if (en) pushUnique(queries, en);
    if (/^[a-z0-9]{3,}$/i.test(tok)) pushUnique(queries, tok);
  }

  if (FINANCE_HINTS.test(trimmed)) {
    pushUnique(queries, "Japan yen exchange rate");
    pushUnique(queries, "Bank of Japan policy");
  }
  if (WAR_HINTS.test(trimmed)) {
    pushUnique(queries, "Japan security conflict");
  }

  return queries.slice(0, MAX_INTL_QUERIES);
}
