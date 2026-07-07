/**
 * FactBase Radar 能動調査（③）— 1トピックについて一次情報・関連報道・背景解説を「取りにいく」。
 *
 * 従来の受け身型（固定RSSを待つ）と逆で、バズ検知したトピック語を起点に
 * 国会会議録・法令・関連ニュース・背景解説・官庁一次情報を横断的に叩き、1つの証拠バンドルに束ねる。
 * この束が「いつ・どこで・何が起きて、今どこまで進んでいるか」を整理する材料になる。
 *
 * 国会会議録・法令は法案系の話題にしか強くヒットせず、戦争・歴史問題・為替のような話題では
 * 常に空になりがち。それを「証拠が薄い」と機械的に切り捨てないよう、
 * 全トピック共通で効くGoogle News（異なる媒体数）を主軸に、他は加点材料として扱う
 * （evidenceSufficiency参照）。
 *
 * 外部API 4種は互いに独立なので Promise.all で並列取得。個々の失敗は各クライアント側で
 * 空配列/nullにフォールバック済みなので、一部が落ちても残りの証拠で調査は続行する。
 * 官庁一次情報のみ、既存detect.tsが90本RSSから既にDBに集めているSourceEventを
 * 再利用する（新規にRSSを叩き直さない）。
 */
import type { PrismaClient } from "@prisma/client";
import {
  buildResearchSearchTerms as buildDomesticResearchQueries,
  buildInternationalNewsQueries,
} from "./research-queries";
import { searchDietSpeeches, type DietSpeech } from "../sources/kokkai";
import { searchLaws, type LawInfo } from "../sources/egov-law";
import { searchNews, searchInternationalNews, searchCJKNews, type NewsItem } from "../sources/google-news";
import { searchTavily, type TavilyResult } from "../sources/tavily";
import { fetchWikipediaBackground, type WikipediaBackground } from "../sources/wikipedia";
import { searchEStatStats, type EStatItem } from "../sources/estat";
import { PRIMARY_SOURCE_FEED } from "../../../src/lib/radar";
import { RADAR } from "../../../src/lib/constants";
import { isTrustedTavilyUrl, loadDomainTrustDenylist } from "./domain-trust";

export { buildResearchSearchTerms, buildInternationalNewsQueries } from "./research-queries";

export interface OfficialEvent {
  title: string;
  url: string;
  feed: string;
  publishedAt: string;
}

export interface EvidenceBundle {
  topic: string;
  dietSpeeches: DietSpeech[]; // 国会での審議・発言（法案系のみ強い）
  laws: LawInfo[]; // 成立済み関連法令（法案系のみ強い）
  news: NewsItem[]; // 国内メディア報道（全トピック共通で効く主軸ソース）
  internationalNews: NewsItem[]; // 海外/英字メディア報道（日本メディアとの報道比較・国際的な視点に使う）
  background: WikipediaBackground | null; // 背景解説（歴史・人権・国際等で必須）
  officialEvents: OfficialEvent[]; // 既存90本RSSの官庁一次情報との一致（既存DBの再利用）
  estatStats?: EStatItem[]; // e-Stat政府統計（経済系トピックの数値一次情報）
  pollingNews?: NewsItem[]; // 世論調査を報じたニュース（支持率・賛否割合等の具体的数値の裏取り材料）
  gatheredAt: string;
}

export interface ResearchLimits {
  kokkaiRecords: number;
  lawRecords: number;
  newsRecords: number;
  internationalNewsRecords: number;
}

/** 直近officialEvents検索の対象期間（既存SourceEventの保持期間内） */
const OFFICIAL_EVENT_LOOKBACK_DAYS = 14;
const OFFICIAL_EVENT_LIMIT = 5;

/** 世論調査報道の検索語。トピック語に「世論調査」を足すだけで、NHK・時事等の定例調査記事が拾える */
function buildPollingQuery(topic: string): string {
  return `${topic} 世論調査`;
}
const POLLING_NEWS_LIMIT = 3;

function dedupeNewsByUrl(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((n) => {
    if (!n.url || seen.has(n.url)) return false;
    seen.add(n.url);
    return true;
  });
}

/** 日本のドメインらしさの粗い判定（Tavily結果を国内/海外どちらの枠で競わせるかの振り分けにのみ使う） */
const JP_DOMAIN_HINT = /\.(?:jp|co\.jp|ne\.jp|go\.jp|or\.jp|ac\.jp)$/i;

export function classifyTavilyRegion(url: string): "domestic" | "international" {
  try {
    return JP_DOMAIN_HINT.test(new URL(url).hostname) ? "domestic" : "international";
  } catch {
    return "international";
  }
}

/**
 * Tavily検索結果を既存のNewsItem形式に変換する（発見専用。本文はここでは取得しない）。
 * Google Newsのクロス検索で拾えない一次情報・専門メディア・海外報道の穴を埋め、
 * 既存のnews/internationalNews枠内でGoogle News由来の結果と競わせる（url重複は自動排除）。
 */
export function tavilyResultsToNewsItems(results: TavilyResult[]): NewsItem[] {
  return results.map((r) => {
    let source = "tavily";
    try {
      source = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      // ホスト名が取れない場合はsource="tavily"のまま
    }
    return { title: r.title, source, url: r.url, pubDate: "", region: classifyTavilyRegion(r.url) };
  });
}

/**
 * 官庁・国会・裁判所等（PRIMARY_SOURCE_FEED）由来のSourceEventから、
 * 検索語いずれかをタイトルに含む直近の一致を探す。
 */
async function matchOfficialEvents(prisma: PrismaClient, searchTerms: string[]): Promise<OfficialEvent[]> {
  if (searchTerms.length === 0) return [];
  const since = new Date(Date.now() - OFFICIAL_EVENT_LOOKBACK_DAYS * 24 * 60 * 60_000);
  const rows = await prisma.sourceEvent.findMany({
    where: {
      createdAt: { gte: since },
      OR: searchTerms.map((term) => ({ title: { contains: term } })),
    },
    orderBy: { createdAt: "desc" },
    take: OFFICIAL_EVENT_LIMIT * 3,
  });
  return rows
    .filter((r) => PRIMARY_SOURCE_FEED.test(r.feedName))
    .slice(0, OFFICIAL_EVENT_LIMIT)
    .map((r) => ({ title: r.title, url: r.url, feed: r.feedName, publishedAt: r.publishedAt.toISOString() }));
}

/**
 * Google Newsで見つかった件数がこれ未満ならTavilyで補う。
 * 十分見つかっているトピックにまでTavilyを叩くのはコストの無駄（Google Newsだけで
 * 「錯綜整理」に足る媒体数は確保できているため）。
 */
const TAVILY_SUPPLEMENT_THRESHOLD = 4;

export async function researchTopic(
  term: string,
  limits: ResearchLimits,
  prisma: PrismaClient,
): Promise<EvidenceBundle> {
  const queries = buildDomesticResearchQueries(term);
  const intlQueries = buildInternationalNewsQueries(term);
  const perQueryNews = Math.max(2, Math.ceil(limits.newsRecords / Math.max(queries.length, 1)));
  const perQueryIntl = Math.max(2, Math.ceil(limits.internationalNewsRecords / Math.max(intlQueries.length, 1)));

  const [dietSpeeches, laws, background, officialEvents, cjkNews, estatStats, pollingNewsRaw, ...newsBatches] =
    await Promise.all([
      searchDietSpeeches(term, limits.kokkaiRecords),
      searchLaws(term, limits.lawRecords),
      fetchWikipediaBackground(term),
      matchOfficialEvents(prisma, queries),
      searchCJKNews(term, 3),
      searchEStatStats(term, 3),
      searchNews(buildPollingQuery(term), POLLING_NEWS_LIMIT),
      ...queries.map((q) => searchNews(q, perQueryNews)),
      ...intlQueries.map((q) => searchInternationalNews(q, perQueryIntl)),
    ]);

  const domesticChunks = newsBatches.slice(0, queries.length) as NewsItem[][];
  const intlChunks = newsBatches.slice(queries.length) as NewsItem[][];
  const domesticFromGoogle = dedupeNewsByUrl(domesticChunks.flat());
  const intlFromGoogle = dedupeNewsByUrl([...intlChunks.flat(), ...cjkNews]);

  // Tavilyは「Google Newsだけでは足りていないトピック」だけの補完枠にする（呼び出し回数の絞り込み）
  // 複数クエリを使うことで、単語変化による発見漏れを減らす（最大2クエリ並列）
  const needsTavily = domesticFromGoogle.length + intlFromGoogle.length < TAVILY_SUPPLEMENT_THRESHOLD;
  const tavilyQueries = queries.slice(0, 2);
  const perTavilyQuery = Math.ceil(RADAR.tavilyResultsPerTopic / Math.max(tavilyQueries.length, 1));
  const tavilyRaw = needsTavily
    ? await (async () => {
        const [rawBatches, denylist] = await Promise.all([
          Promise.all(tavilyQueries.map((q) => searchTavily(q ?? term, perTavilyQuery))),
          loadDomainTrustDenylist(prisma),
        ]);
        return rawBatches.flat().filter((r) => isTrustedTavilyUrl(r.url, denylist));
      })()
    : [];
  const tavilyNews = tavilyResultsToNewsItems(tavilyRaw);

  const news = dedupeNewsByUrl([
    ...domesticFromGoogle,
    ...tavilyNews.filter((n) => n.region === "domestic"),
  ]).slice(0, limits.newsRecords);
  const internationalNews = dedupeNewsByUrl([
    ...intlFromGoogle,
    ...tavilyNews.filter((n) => n.region === "international"),
  ]).slice(0, limits.internationalNewsRecords);

  const pollingNews = dedupeNewsByUrl(pollingNewsRaw as NewsItem[]);

  return {
    topic: term,
    dietSpeeches,
    laws,
    news,
    internationalNews,
    background,
    officialEvents,
    estatStats: (estatStats as EStatItem[]).length > 0 ? (estatStats as EStatItem[]) : undefined,
    pollingNews: pollingNews.length > 0 ? pollingNews : undefined,
    gatheredAt: new Date().toISOString(),
  };
}

/** 証拠が実質空（何も取れなかった）かどうか */
export function isEmptyEvidence(b: EvidenceBundle): boolean {
  return (
    b.dietSpeeches.length === 0 &&
    b.laws.length === 0 &&
    b.news.length === 0 &&
    b.internationalNews.length === 0 &&
    !b.background &&
    b.officialEvents.length === 0
  );
}

export interface EvidenceSufficiency {
  /** 主基準: 国内+海外メディアで異なる媒体からの報道が何件あるか（全トピック共通で公平に効く） */
  distinctNewsOutlets: number;
  /** 加点材料（法案系・背景解説・官庁一次情報・海外報道のいずれかがあるボーナス） */
  bonusSignals: string[];
  /** 記事化に足る証拠が揃っているか */
  sufficient: boolean;
}

/** これだけ異なる媒体の報道があれば「錯綜の整理」記事が書けると判断する主基準の閾値 */
const MIN_DISTINCT_NEWS_OUTLETS = 2;

function measureEvidence(b: EvidenceBundle): Omit<EvidenceSufficiency, "sufficient"> {
  const distinctNewsOutlets = new Set(
    [...b.news, ...b.internationalNews].map((n) => n.source || n.url).filter(Boolean),
  ).size;
  const bonusSignals: string[] = [];
  if (b.dietSpeeches.length > 0) bonusSignals.push("diet");
  if (b.laws.length > 0) bonusSignals.push("law");
  if (b.background) bonusSignals.push("background");
  if (b.officialEvents.length > 0) bonusSignals.push("official");
  if (b.internationalNews.length > 0) bonusSignals.push("international");
  return { distinctNewsOutlets, bonusSignals };
}

/** discover ログ用。背景/Wikipedia 単独でも「調査は進んだ」とみなす。 */
export function evaluateEvidenceSufficiency(b: EvidenceBundle): EvidenceSufficiency {
  const m = measureEvidence(b);
  const sufficient = m.distinctNewsOutlets >= MIN_DISTINCT_NEWS_OUTLETS || m.bonusSignals.length > 0;
  return { ...m, sufficient };
}

/**
 * promote（バズ記事）用。Wikipedia 背景だけで通さない（法案・背景偏重を防ぐ）。
 * 複数報道が主役。報道1件でも国会/法令/官庁一次情報があれば可。
 */
export function evaluateBuzzPromoteSufficiency(b: EvidenceBundle): EvidenceSufficiency {
  const m = measureEvidence(b);
  const sufficient =
    m.distinctNewsOutlets >= MIN_DISTINCT_NEWS_OUTLETS ||
    (m.distinctNewsOutlets >= 1 &&
      (b.dietSpeeches.length > 0 || b.laws.length > 0 || b.officialEvents.length > 0));
  return { ...m, sufficient };
}
