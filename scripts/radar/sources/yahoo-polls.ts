/**
 * Yahoo!ニュース「みんなの意見」(/polls) — 実測の意見分布データ（無料・APIキー不要）。
 *
 * コメント数（fetchYahooArticleCommentCount）は「議論が沸騰しているか」の絶対量シグナルだが、
 * 「賛否が拮抗しているか」までは分からない（片方に9割偏っていても件数は多くなる）。
 * こちらは実際の投票結果（選択肢ごとの票数・割合）が読者にそのまま提示されている一次データなので、
 * 上位2選択肢の割合差から「意見がどれだけ割れているか」を実測できる。
 *
 * 一覧ページ(/polls, /polls?page=N)はSSRされた素のHTMLで、質問文とURLの対（percentは含まない）
 * のみ拾える。マッチした設問だけ個別ページ(/polls/{id})を取得し、埋め込みJSON
 * (`"choices":[{"choice","count","percent","value"}]`)から内訳を取る。
 */
import { buzzMatchesTitleCorpus } from "../../../src/lib/buzz-cross-match";

const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";
const POLLS_LIST_URL = "https://news.yahoo.co.jp/polls";

/** 新着順一覧の直近何ページを見るか。政治的に旬な設問は大抵ここに出る（全17,000件超を全走査はしない） */
const POLLS_LIST_PAGES = 3;

export interface YahooPollListEntry {
  url: string;
  question: string;
}

/** <a href=".../polls/{id}">…<p class="...">{question}</p> のペアを抽出する */
const POLL_LINK_WITH_QUESTION =
  /<a href="(https:\/\/news\.yahoo\.co\.jp\/polls\/\d+)"[^>]*>[\s\S]{0,2500}?<p class="[^"]+">([^<]{6,120})<\/p>/g;

export function extractYahooPollListEntries(html: string): YahooPollListEntry[] {
  const out: YahooPollListEntry[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(POLL_LINK_WITH_QUESTION)) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, question: m[2].trim() });
  }
  return out;
}

async function fetchPollsListPage(page: number): Promise<string> {
  const url = page <= 1 ? POLLS_LIST_URL : `${POLLS_LIST_URL}?page=${page}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** 新着順一覧（直近POLLS_LIST_PAGESページ分）の質問一覧。discover 1実行につき1回だけ呼び、全トピックで使い回す */
export async function fetchRecentYahooPolls(): Promise<YahooPollListEntry[]> {
  try {
    const pages = await Promise.all(
      Array.from({ length: POLLS_LIST_PAGES }, (_, i) => i + 1).map((p) =>
        fetchPollsListPage(p).catch((e) => {
          console.warn(`  ⚠️ yahoo-polls: page=${p} 取得失敗 (${e})`);
          return "";
        }),
      ),
    );
    const seen = new Set<string>();
    const out: YahooPollListEntry[] = [];
    for (const html of pages) {
      for (const entry of extractYahooPollListEntries(html)) {
        if (seen.has(entry.url)) continue;
        seen.add(entry.url);
        out.push(entry);
      }
    }
    return out;
  } catch (e) {
    console.warn(`  ⚠️ yahoo-polls: 一覧取得失敗 (${e})`);
    return [];
  }
}

export interface YahooPollChoice {
  choice: string;
  count: number;
  percent: number;
}

export interface YahooPollDetail {
  url: string;
  question: string;
  choices: YahooPollChoice[];
}

const CHOICES_JSON_PATTERN = /"choices":(\[\{.*?\}\])/;

/** 個別投票ページから選択肢別の票数・割合を取得する */
export async function fetchYahooPollDetail(entry: YahooPollListEntry): Promise<YahooPollDetail | null> {
  try {
    const res = await fetch(entry.url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(CHOICES_JSON_PATTERN);
    if (!m) return null;
    const choices = JSON.parse(m[1]) as YahooPollChoice[];
    if (!Array.isArray(choices) || choices.length < 2) return null;
    return { url: entry.url, question: entry.question, choices };
  } catch (e) {
    console.warn(`  ⚠️ yahoo-polls: 詳細取得失敗 ${entry.url} (${e})`);
    return null;
  }
}

/**
 * 上位2選択肢の割合差から「意見がどれだけ拮抗しているか」を0〜1で返す。
 * 差0（完全拮抗）→1、差100（一方的）→0。3択以上の設問でも上位2つの競り合いを見る
 * （「わからない」等の消極選択肢が3位以下に沈んでいても実質2択の対立度は測れる）。
 */
export function computeDivisionScore(choices: YahooPollChoice[]): number {
  if (choices.length < 2) return 0;
  const sorted = [...choices].sort((a, b) => b.percent - a.percent);
  const margin = sorted[0].percent - sorted[1].percent;
  return Math.max(0, Math.min(1, 1 - margin / 100));
}

/** 一覧からトピック語に一致する設問を探す（同一トピックに複数一致時は先頭＝新しい方を採用） */
export function matchYahooPoll(topic: string, list: YahooPollListEntry[]): YahooPollListEntry | null {
  return list.find((e) => buzzMatchesTitleCorpus(topic, [e.question])) ?? null;
}
