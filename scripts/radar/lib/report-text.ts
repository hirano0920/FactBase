/**
 * REPORTED（報道ベース）争点の記事品質を上げるための報道本文の取得。
 *
 * 従来は見出しとURLだけを入力にしており、「どの媒体が何を報じているか」「各社の報道が
 * どこで食い違っているか」を書く材料が無く、見出しの言い換えにしかならなかった。
 * 媒体ごとに1件ずつ本文抜粋を取得し、記事側では「〜と報じています」という帰属付きの
 * 引用としてのみ使う（事実として断定しない原則は radar-article.ts のSYSTEMプロンプトで維持）。
 *
 * 一次資料（primary-text.ts）と違い官公庁限定ではなく報道機関のページも対象にするため、
 * 取得件数・保持文字数はやや控えめにして「事実の断定」ではなく「論調の把握」に留める。
 */
import { fetchPageText } from "./primary-text";

export interface ReportExcerpt {
  feed: string;
  title: string;
  url: string;
  text: string;
}

const MAX_OUTLETS = 5;
const MAX_CHARS_PER_OUTLET = 1500;

/**
 * ソース一覧から媒体（feed）ごとに最新1件ずつ、最大MAX_OUTLETS媒体分の本文抜粋を取得する。
 * 同一媒体を何件も取っても「食い違いの整理」には寄与しないため、媒体の多様性を優先する。
 * 取得失敗・短すぎる本文は黙ってスキップ（記事生成自体は止めない）。
 */
export async function fetchReportExcerpts(
  sources: { title: string; url: string; feed: string }[],
): Promise<ReportExcerpt[]> {
  const byFeedLatest = new Map<string, { title: string; url: string; feed: string }>();
  for (const s of sources) byFeedLatest.set(s.feed, s); // 後勝ちで各feedの最新分だけ残す
  const targets = Array.from(byFeedLatest.values()).slice(-MAX_OUTLETS);

  const excerpts: ReportExcerpt[] = [];
  for (const s of targets) {
    const text = await fetchPageText(s.url, MAX_CHARS_PER_OUTLET);
    if (text) excerpts.push({ feed: s.feed, title: s.title, url: s.url, text });
  }
  return excerpts;
}
