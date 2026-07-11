/**
 * YouTubeでバズっているニュース動画のトピックから、放送局公式サイトの関連記事を探す。
 *
 * researchTopic()の一般Google News検索は正規化されたトピック語で幅広く検索するが、
 * YouTube発の話題は「テレビで放送された内容」が本体であることが多く、放送局自身の
 * Web版記事（本文が fetchReportExcerpts で取得できる）を優先的に拾えると記事の厚みが増す。
 * 動画の文字起こし・字幕取得は行わない（コスト・複雑さに見合わないため、既存のGoogle News
 * 検索インフラをそのまま再利用する）。
 */
import { searchNews, type NewsItem } from "../sources/google-news";

/** 主要放送局のWeb版ドメイン（site:検索の絞り込み対象） */
export const BROADCASTER_DOMAINS = [
  "www3.nhk.or.jp",
  "news.tv-asahi.co.jp",
  "news.tbs.co.jp",
  "www.fnn.jp",
  "news.ntv.co.jp",
  "www.yomiuri.co.jp",
  "www.asahi.com",
  "mainichi.jp",
  "www.sankei.com",
  "www.nikkei.com",
] as const;

export interface BroadcastMatch {
  topic: string;
  article: NewsItem;
}

/**
 * トピック語を主要放送局ドメイン限定でGoogle News検索し、最初に見つかった記事を返す。
 * 見つからなければnull（researchTopicの一般検索・他媒体の報道に任せる。ここは補完枠）。
 */
export async function matchBroadcastArticle(topic: string): Promise<BroadcastMatch | null> {
  const query = topic.replace(/[「」『』【】[\]]/g, "").trim();
  if (query.length < 4) return null;

  const siteFilter = BROADCASTER_DOMAINS.map((d) => `site:${d}`).join(" OR ");
  const results = await searchNews(`${query} (${siteFilter})`, 3);
  const first = results[0];
  return first ? { topic, article: first } : null;
}

/**
 * newsに放送局記事を1件マージする（既に同一URLがあれば何もしない）。
 * upsertCandidate側のsourceUrls構築にそのまま乗り、fetchReportExcerptsが本文を取りに行く。
 */
export function mergeBroadcastMatch(news: NewsItem[], match: BroadcastMatch | null): NewsItem[] {
  if (!match) return news;
  if (news.some((n) => n.url === match.article.url)) return news;
  return [...news, match.article];
}
