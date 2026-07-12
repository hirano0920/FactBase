/**
 * 長期争点（geopolitics / sustained）向けの過去報道バンドル。
 * 今日の速報6本だけでは「数ヶ月続く紛争」の記事が薄くなりHELDしやすいため、
 * 日付付きの過去記事を別枠で集め、タイムライン材料として Writer に渡す。
 */
import type { DebateType } from "../../../src/lib/debate-type";
import { searchNews, searchInternationalNews, type NewsItem } from "../sources/google-news";
import { searchTavily } from "../sources/tavily";
import { fetchReportExcerpts, type ReportExcerpt } from "./report-text";
import { buildInternationalNewsQueries } from "./research-queries";

export interface DatedExcerpt extends ReportExcerpt {
  /** ISO8601 またはパース可能な日付文字列。無い場合は空 */
  publishedAt: string;
}

const GEOPOLITICS_HINT =
  /イラン|ホルムズ|中東|ガザ|イスラエル|ウクライナ|ロシア|停戦|侵攻|ミサイル|制裁|封鎖|空爆|戦争|NATO|台湾|北朝鮮|米軍|軍事衝突/i;

const HISTORY_SUFFIXES_JA = ["停戦", "経緯", "攻撃", "制裁", "交渉", "封鎖"];
const HISTORY_SUFFIXES_EN = ["ceasefire", "timeline", "attack", "sanctions", "negotiation"];

const MAX_QUERIES = 6;
const MAX_CANDIDATE_ITEMS = 24;
const MAX_DATED_EXCERPTS = 16;
const MIN_AGE_HOURS_FOR_HISTORY = 36;

export function needsHistoricalEnrich(opts: {
  debateType?: DebateType | null;
  sustained?: boolean;
  topic: string;
}): boolean {
  if (opts.debateType === "geopolitics") return true;
  if (opts.sustained && GEOPOLITICS_HINT.test(opts.topic)) return true;
  return GEOPOLITICS_HINT.test(opts.topic);
}

export function shouldUseTimelineFirstMode(opts: {
  debateType?: DebateType | null;
  sustained?: boolean;
  reignite?: boolean;
  datedExcerptCount: number;
}): boolean {
  if (opts.datedExcerptCount < 3) return false;
  if (opts.debateType === "geopolitics") return true;
  if (opts.sustained || opts.reignite) return true;
  return false;
}

/** discover の sustained を記事側 reignite に繋ぐ（長期トレンド＝再燃型プロンプト） */
export function resolveReigniteFromSustained(opts: {
  debateType?: DebateType | null;
  sustained?: boolean;
  reignite?: boolean;
}): boolean {
  if (opts.reignite) return true;
  if (!opts.sustained) return false;
  return opts.debateType === "geopolitics" || opts.debateType === "policy" || opts.debateType == null;
}

export function buildHistoricalQueries(topic: string): string[] {
  const trimmed = topic.trim();
  const queries: string[] = [];
  const push = (q: string) => {
    const v = q.trim();
    if (v.length < 2) return;
    if (queries.some((x) => x === v || x.includes(v) || v.includes(x))) return;
    queries.push(v);
  };

  push(trimmed);
  for (const s of HISTORY_SUFFIXES_JA) {
    if (trimmed.includes(s)) continue;
    push(`${trimmed} ${s}`);
    if (queries.length >= MAX_QUERIES) break;
  }

  for (const en of buildInternationalNewsQueries(trimmed)) {
    push(en);
    for (const s of HISTORY_SUFFIXES_EN) {
      push(`${en} ${s}`);
      if (queries.length >= MAX_QUERIES) break;
    }
    if (queries.length >= MAX_QUERIES) break;
  }

  // Google News の相対期間フィルタ（ロケールによっては効く）
  if (trimmed.length >= 2) push(`${trimmed} when:1y`);

  return queries.slice(0, MAX_QUERIES);
}

function parsePublishedAt(raw: string | undefined): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isHistoricalEnough(publishedAt: string, now = new Date()): boolean {
  const d = parsePublishedAt(publishedAt);
  if (!d) return false;
  const ageHours = (now.getTime() - d.getTime()) / 3_600_000;
  return ageHours >= MIN_AGE_HOURS_FOR_HISTORY;
}

/**
 * Google News + Tavily で日付付き候補を集め、本文抜粋を最大 MAX_DATED_EXCERPTS 件返す。
 * 直近36時間以内の速報は除外（reportExcerpts 側の担当）。
 */
export async function fetchHistoricalDatedExcerpts(topic: string): Promise<DatedExcerpt[]> {
  const queries = buildHistoricalQueries(topic);
  const seen = new Set<string>();
  const candidates: { title: string; url: string; feed: string; publishedAt: string }[] = [];

  const newsBatches = await Promise.all(
    queries.flatMap((q) => [searchNews(q, 6), searchInternationalNews(q, 5)]),
  );
  for (const batch of newsBatches) {
    for (const n of batch as NewsItem[]) {
      if (!n.url || seen.has(n.url)) continue;
      if (!isHistoricalEnough(n.pubDate)) continue;
      seen.add(n.url);
      candidates.push({
        title: n.title,
        url: n.url,
        feed: n.source || "google-news",
        publishedAt: n.pubDate,
      });
    }
  }

  // Tavily: 403で落ちやすい国際ソースの穴埋め（要約付きで候補を増やす）
  const tavilyQueries = queries.slice(0, 3);
  const tavilyBatches = await Promise.all(
    tavilyQueries.map((q) => searchTavily(q, 6, { days: 365 })),
  );
  for (const results of tavilyBatches) {
    for (const r of results) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      // Tavily は日付が無いことが多い → 履歴クエリ由来なので候補に入れ、後で本文取得時に残す
      candidates.push({
        title: r.title,
        url: r.url,
        feed: "tavily",
        publishedAt: "",
      });
    }
  }

  const targets = candidates.slice(0, MAX_CANDIDATE_ITEMS);
  if (targets.length === 0) return [];

  const excerpts = await fetchReportExcerpts(targets);
  const byUrl = new Map(targets.map((t) => [t.url, t]));
  // Tavily フォールバックで URL が変わっていることがあるので title でも照合
  const byTitle = new Map(targets.map((t) => [t.title, t]));

  const dated: DatedExcerpt[] = [];
  for (const e of excerpts) {
    const meta = byUrl.get(e.url) ?? byTitle.get(e.title);
    const publishedAt = meta?.publishedAt ?? "";
    // 日付が取れたものだけタイムライン材料に（日付不明の Tavily は背景用に少し残す）
    if (publishedAt && !isHistoricalEnough(publishedAt)) continue;
    dated.push({
      ...e,
      feed: meta?.feed || e.feed,
      publishedAt,
    });
    if (dated.length >= MAX_DATED_EXCERPTS) break;
  }

  // 日付ありを優先して並べ替え（古い→新しい）
  dated.sort((a, b) => {
    const ta = parsePublishedAt(a.publishedAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    const tb = parsePublishedAt(b.publishedAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  console.log(
    `  📚 historical-enrich: クエリ${queries.length} → 候補${candidates.length} → 抜粋${dated.length}件` +
      `（日付あり${dated.filter((d) => d.publishedAt).length}）`,
  );
  return dated;
}

export function formatDatedExcerptsBlock(excerpts: DatedExcerpt[]): string {
  if (excerpts.length === 0) return "";
  return `\n\n# 過去報道抜粋（タイムライン専用・${excerpts.length}件）
「これまでの流れ」セクションの材料。日付付きの確認済み経緯だけに使う。
直近24時間の速報の断定には使わない。各項目は媒体名＋日付の帰属付きで書くこと。
${excerpts
  .map(
    (e, i) =>
      `【過去${i + 1}: ${e.feed}${e.publishedAt ? ` / ${e.publishedAt}` : ""}】${e.title}\n${e.url}\n${e.text}`,
  )
  .join("\n---\n")}`;
}
