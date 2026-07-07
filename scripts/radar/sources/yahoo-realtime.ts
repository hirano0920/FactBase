/**
 * Yahoo!リアルタイム検索の急上昇ワード（X＝旧Twitterの投稿量ベース、無料・APIキー不要）。
 * Google Trends（検索行動）と違い、実際にSNS上で投稿されている量を反映するため
 * 「他プラットフォームでバズっている」ユーザー体感に一番近い無料シグナル。
 *
 * ページはNext.jsでSSRされ、トレンド一覧はHTMLをスクレイピングせずとも
 * <script id="__NEXT_DATA__">内のJSONにそのまま構造化データとして埋め込まれている
 * （props.pageProps.pageData.buzzTrend.items / otherItems）ため、
 * courts.tsのような不安定な正規表現DOMパースより壊れにくい。
 * ただしNext.jsのpageData構造自体が変わればここも壊れるため、取得0件は静かにスキップする。
 */
import { shouldKeepBuzzTerm } from "../../../src/lib/buzz-prefilter";

const TREND_URL = "https://search.yahoo.co.jp/realtime/trend";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

export interface YahooBuzzTerm {
  term: string;
  tweetCount: number;
  /** Yahoo側のジャンル分類（"ニュース"等）。空文字のことも多い */
  genre: string;
}

interface BuzzTrendItem {
  query?: string;
  tweetCount?: number;
  genre?: string;
}

export async function fetchYahooRealtimeBuzz(): Promise<YahooBuzzTerm[]> {
  try {
    const res = await fetch(TREND_URL, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const m = html.match(/__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return [];
    const data = JSON.parse(m[1]) as {
      props?: {
        pageProps?: { pageData?: { buzzTrend?: { items?: BuzzTrendItem[]; otherItems?: BuzzTrendItem[] } } };
      };
    };
    const buzzTrend = data.props?.pageProps?.pageData?.buzzTrend;
    const raw = [...(buzzTrend?.items ?? []), ...(buzzTrend?.otherItems ?? [])];

    return raw
      .filter((i): i is Required<BuzzTrendItem> => typeof i.query === "string" && i.query.trim().length >= 2)
      .map((i) => ({ term: i.query.trim(), tweetCount: i.tweetCount ?? 0, genre: i.genre ?? "" }));
  } catch (e) {
    console.warn(`  ⚠️ yahoo-realtime: 取得失敗 (${e})`);
    return [];
  }
}

/** discover 用: スポーツ・エンタメ genre と政治圏プリフィルタを適用 */
export async function fetchYahooRealtimeBuzzPolitics(): Promise<YahooBuzzTerm[]> {
  const all = await fetchYahooRealtimeBuzz();
  return all.filter((b) => shouldKeepBuzzTerm({ term: b.term, source: "yahoo_rt", genre: b.genre }));
}
