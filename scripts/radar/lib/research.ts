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
import { fetchWikipediaBackground, type WikipediaBackground } from "../sources/wikipedia";
import { searchEStatStats, type EStatItem } from "../sources/estat";
import { fetchTopicIndicators, type EStatIndicatorFigure } from "../sources/estat-indicators";
import { fetchDietVoteBreakdown, type DietVoteBreakdown } from "../sources/diet-votes";
import {
  matchYahooPoll,
  fetchYahooPollDetail,
  computeDivisionScore,
  type YahooPollListEntry,
  type YahooPollDetail,
} from "../sources/yahoo-polls";
import { fetchYahooArticleComments } from "../sources/yahoo-news-ranking";
import { computeCommentFrictionScore } from "./comment-friction";
import { assessCommentStanceSpread } from "../../../src/lib/ai";
import { PRIMARY_SOURCE_FEED } from "../../../src/lib/radar";
import { RADAR } from "../../../src/lib/constants";
import { resolveYahooArticleUrl } from "./resolve-google-news-url";

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
  estatStats?: EStatItem[]; // e-Stat政府統計（経済系トピックの数値一次情報・名称のみ）
  estatIndicators?: EStatIndicatorFigure[]; // e-Stat基幹指標の確定数値（CPI・失業率等・逐語引用用）
  dietVote?: DietVoteBreakdown; // 参議院本会議の政党別賛否内訳（法案系争点で実測の分断シグナル）
  pollingNews?: NewsItem[]; // 世論調査を報じたニュース（支持率・賛否割合等の具体的数値の裏取り材料）
  /**
   * Yahoo!ニュース「みんなの意見」で一致した設問（あれば）。コメント数（炎上の絶対量）と違い、
   * 選択肢別の実際の割合を持つため「意見がどれだけ拮抗しているか」をdivisionScoreで実測できる。
   * ただし編集部が設問を作り読者が投票するまでタイムラグがあり、投票数が少ないと統計的ノイズが
   * 大きいため、最低投票数(MIN_POLL_VOTES)未満なら「データ不足」としてundefinedのままにする。
   */
  externalPoll?: {
    question: string;
    url: string;
    choices: { choice: string; count: number; percent: number }[];
    divisionScore: number;
  };
  /**
   * externalPollがデータ不足（投票が見つからない/投票数が少なすぎる）の場合のフォールバック。
   * 記事公開直後から付く読者コメントの文面をnanoに読ませ、意見が実質的に二極化しているかを
   * 推定する（速報向けの分断シグナル。Yahoo投票よりタイムラグが無い代わりに精度は落ちるため
   * 補助シグナル止まりとし、confidenceも保持する）。
   */
  commentStanceSpread?: { split: boolean; confidence: number };
  /**
   * Yahoo!コメントの反応数（共感/うーん）から算術だけで求めた摩擦度（0〜1）。
   * commentStanceSpread（コメント文面のLLM判定）と違いAIを使わない実測値。
   * comment-friction.ts参照。反応データが無ければundefined。
   */
  commentFrictionScore?: number;
  /**
   * Yahoo!記事から取得したコメント本文（最大10件、反応数合計順）。軸ロック（lockedAxis抽出）で
   * 実際の読者の意見・対立構造をLLMに読ませるために保存する。スタンス推定だけで捨てない。
   */
  commentSamples?: { text: string; empathyCount: number; insightCount: number; negativeCount: number }[];
  gatheredAt: string;
}

/** これ未満の合計投票数はサンプルが少なすぎてdivisionScoreがノイズになるため「データ不足」扱いにする */
export const MIN_POLL_VOTES = 300;

/** 同一discover/promoteラン内で同じ投票詳細を二重取得しないためのキャッシュ */
export type PollDetailCache = Map<string, Promise<YahooPollDetail | null>>;

export function createPollDetailCache(): PollDetailCache {
  return new Map();
}

async function fetchYahooPollDetailCached(
  entry: YahooPollListEntry,
  cache?: PollDetailCache,
): Promise<YahooPollDetail | null> {
  if (!cache) return fetchYahooPollDetail(entry);
  const hit = cache.get(entry.url);
  if (hit) return hit;
  const pending = fetchYahooPollDetail(entry);
  cache.set(entry.url, pending);
  return pending;
}

function externalPollFromDetail(
  detail: YahooPollDetail,
): EvidenceBundle["externalPoll"] | undefined {
  const pollVoteTotal = detail.choices.reduce((sum, c) => sum + c.count, 0);
  if (pollVoteTotal < MIN_POLL_VOTES) return undefined;
  return {
    question: detail.question,
    url: detail.url,
    choices: detail.choices,
    divisionScore: computeDivisionScore(detail.choices),
  };
}

/**
 * Yahoo投票 / コメント分断シグナルだけを再取得する（promote直前の鮮度更新用）。
 * 本文取得や国会検索はやり直さない。投票が取れればコメントnanoは呼ばない。
 */
export async function refreshDivisionSignals(opts: {
  topic: string;
  newsUrls: string[];
  yahooPolls: YahooPollListEntry[];
  pollDetailCache?: PollDetailCache;
}): Promise<{
  externalPoll?: EvidenceBundle["externalPoll"];
  commentStanceSpread?: EvidenceBundle["commentStanceSpread"];
  commentFrictionScore?: number;
}> {
  const matchedPoll = matchYahooPoll(opts.topic, opts.yahooPolls);
  if (matchedPoll) {
    const pollDetail = await fetchYahooPollDetailCached(matchedPoll, opts.pollDetailCache);
    if (pollDetail) {
      const externalPoll = externalPollFromDetail(pollDetail);
      if (externalPoll) return { externalPoll };
      const pollVoteTotal = pollDetail.choices.reduce((sum, c) => sum + c.count, 0);
      console.log(
        `  📊 [分断再取得] Yahoo!投票は一致したが投票数不足（${pollVoteTotal}票 < ${MIN_POLL_VOTES}票）: ${opts.topic}`,
      );
    }
  }

  const yahooArticleUrl = await resolveYahooArticleUrl(opts.newsUrls);
  if (!yahooArticleUrl) return {};
  const comments = await fetchYahooArticleComments(yahooArticleUrl);
  if (comments.length === 0) return {};
  // 反応数からの摩擦度はAI不使用の実測値なので常に計算する（コストゼロ）。
  // LLM判定（commentStanceSpread）は、反応データが薄すぎて摩擦度が判断不能（undefined）な
  // 場合の最終手段としてのみ呼ぶ（resolveDivisionScoreの優先順位上、frictionScoreが取れる限り
  // LLM判定は使われないため、無条件に呼ぶとコストを払うだけで結果が反映されなかった）。
  const commentFrictionScore = computeCommentFrictionScore(comments);
  const commentStanceSpread =
    commentFrictionScore === undefined
      ? await assessCommentStanceSpread(comments.map((c) => c.text))
      : undefined;
  return { commentStanceSpread, commentFrictionScore };
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

export async function researchTopic(
  term: string,
  limits: ResearchLimits,
  prisma: PrismaClient,
  yahooPolls: YahooPollListEntry[] = [],
  pollDetailCache?: PollDetailCache,
): Promise<EvidenceBundle> {
  const queries = buildDomesticResearchQueries(term);
  const intlQueries = buildInternationalNewsQueries(term);
  const perQueryNews = Math.max(2, Math.ceil(limits.newsRecords / Math.max(queries.length, 1)));
  const perQueryIntl = Math.max(2, Math.ceil(limits.internationalNewsRecords / Math.max(intlQueries.length, 1)));

  const [dietSpeeches, laws, background, officialEvents, cjkNews, estatStats, estatIndicators, dietVote, pollingNewsRaw, ...newsBatches] =
    await Promise.all([
      searchDietSpeeches(term, limits.kokkaiRecords),
      searchLaws(term, limits.lawRecords),
      fetchWikipediaBackground(term),
      matchOfficialEvents(prisma, queries),
      searchCJKNews(term, 3),
      searchEStatStats(term, 3),
      // 確定指標（CPI・失業率等）はキーワード非該当なら即[]、該当時のみ日次キャッシュ/APIで最新値。
      fetchTopicIndicators(term),
      // 参議院本会議の政党別賛否。bigramプリフィルタで無関係トピックは即null（nano呼ばない）。
      fetchDietVoteBreakdown(term),
      searchNews(buildPollingQuery(term), POLLING_NEWS_LIMIT),
      ...queries.map((q) => searchNews(q, perQueryNews)),
      ...intlQueries.map((q) => searchInternationalNews(q, perQueryIntl)),
    ]);

  const domesticChunks = newsBatches.slice(0, queries.length) as NewsItem[][];
  const intlChunks = newsBatches.slice(queries.length) as NewsItem[][];
  const domesticFromGoogle = dedupeNewsByUrl(domesticChunks.flat());
  const intlFromGoogle = dedupeNewsByUrl([...intlChunks.flat(), ...cjkNews]);

  const news = domesticFromGoogle.slice(0, limits.newsRecords);
  const internationalNews = intlFromGoogle.slice(0, limits.internationalNewsRecords);

  const pollingNews = dedupeNewsByUrl(pollingNewsRaw as NewsItem[]);

  const matchedPoll = matchYahooPoll(term, yahooPolls);
  const pollDetail = matchedPoll ? await fetchYahooPollDetailCached(matchedPoll, pollDetailCache) : null;
  const pollVoteTotal = pollDetail?.choices.reduce((sum, c) => sum + c.count, 0) ?? 0;
  const externalPoll = pollDetail ? externalPollFromDetail(pollDetail) : undefined;
  if (pollDetail && !externalPoll) {
    console.log(
      `  📊 Yahoo!投票は一致したが投票数不足（${pollVoteTotal}票 < ${MIN_POLL_VOTES}票）→ データ不足扱い: ${term}`,
    );
  }

  // 摩擦度（commentFrictionScore）はAI不使用の実測値なので、コメントさえ取れれば
  // externalPollの有無に関わらず常に計算する（コストゼロ）。
  // LLM判定（commentStanceSpread）は、externalPollが無く、かつ反応データが薄すぎて
  // 摩擦度が判断不能（undefined）な場合の最終手段としてのみ呼ぶ（resolveDivisionScoreの
  // 優先順位上、frictionScoreが取れる限りLLM判定は使われないため、無条件に呼ぶと
  // コストを払うだけで結果が反映されなかった）。
  let commentStanceSpread: { split: boolean; confidence: number } | undefined;
  let commentFrictionScore: number | undefined;
  let commentSamples: EvidenceBundle["commentSamples"];
  const yahooArticleUrl = await resolveYahooArticleUrl(
    [...news, ...internationalNews].map((n) => n.url),
  );
  if (yahooArticleUrl) {
    const comments = await fetchYahooArticleComments(yahooArticleUrl);
    if (comments.length > 0) {
      commentFrictionScore = computeCommentFrictionScore(comments);
      if (!externalPoll && commentFrictionScore === undefined) {
        commentStanceSpread = await assessCommentStanceSpread(comments.map((c) => c.text));
      }
      // 上位10件のコメント本文＋反応数を保存（軸ロックで実際の読者の意見を読ませるため）
      commentSamples = [...comments]
        .sort((a, b) => (b.empathyCount + b.negativeCount + b.insightCount) - (a.empathyCount + a.negativeCount + a.insightCount))
        .slice(0, 10);
    }
  }

  return {
    topic: term,
    dietSpeeches,
    laws,
    news,
    internationalNews,
    background,
    officialEvents,
    estatStats: (estatStats as EStatItem[]).length > 0 ? (estatStats as EStatItem[]) : undefined,
    estatIndicators:
      (estatIndicators as EStatIndicatorFigure[]).length > 0
        ? (estatIndicators as EStatIndicatorFigure[])
        : undefined,
    dietVote: (dietVote as DietVoteBreakdown | null) ?? undefined,
    pollingNews: pollingNews.length > 0 ? pollingNews : undefined,
    externalPoll,
    commentSamples,
    commentStanceSpread,
    commentFrictionScore,
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
