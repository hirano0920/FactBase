/**
 * Yahoo!ニュース アクセスランキング。
 * Yahoo に「社会」カテゴリは無い（/society は 404）。
 * 国内・経済・国際に加え、声明対立・社会炎上の受け皿としてエンタメを取る。
 * スポーツは試合結果ノイズが多いので入れない。総合は政治以外が混ざるが、
 * エンタメ上位の取りこぼし防止には domestic/entertainment で足りる。
 */
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

/**
 * ランキング見出し抽出。Yahoo のマークアップはカテゴリで揺れ、
 * 昔は div、エンタメ等は p タグ。埋め込み JSON の headline もフォールバック。
 */
const TITLE_FROM_LINK_DIV =
  /<a href="https:\/\/news\.yahoo\.co\.jp\/articles\/[a-f0-9]+"[^>]*>[\s\S]{0,2500}?<div class="[^"]+">([^<]{6,120})<\/div>/g;
const TITLE_FROM_LINK_P =
  /<a href="https:\/\/news\.yahoo\.co\.jp\/articles\/[a-f0-9]+"[^>]*>[\s\S]{0,2500}?<p class="[^"]+">([^<]{6,160})<\/p>/g;
/** 埋め込み JSON（ヤフコメ/アクセス双方の list[].headline） */
const TITLE_FROM_JSON_HEADLINE = /"headline":"((?:\\.|[^"\\]){6,160})"/g;

/** TwoSides の火種領域に対応するカテゴリ（Yahoo 実在パスのみ） */
const RANKING_PATHS = [
  "/ranking/access/news/domestic", // 国内（政治・社会事件）
  "/ranking/access/news/business", // 経済・金融
  "/ranking/access/news/world", // 国際
  "/ranking/access/news/entertainment", // エンタメ（声明対立・炎上の本丸）
] as const;

/**
 * Yahoo!ニュース コメントランキング。「読まれた」ではなく「コメントが多い＝賛否が割れて
 * 議論になっている」の直接シグナル。アクセスランキングと違い、炎上・賛否分裂の実測値として使う。
 */
const COMMENT_RANKING_PATHS = [
  "/ranking/comment/domestic",
  "/ranking/comment/business",
  "/ranking/comment/world",
  "/ranking/comment/entertainment",
] as const;

function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\"/g, '"').replace(/\\u([\dA-Fa-f]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
  }
}

export function extractYahooRankingTitles(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length < 6 || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  for (const m of html.matchAll(TITLE_FROM_LINK_DIV)) push(m[1]);
  for (const m of html.matchAll(TITLE_FROM_LINK_P)) push(m[1]);
  for (const m of html.matchAll(TITLE_FROM_JSON_HEADLINE)) push(decodeJsonString(m[1]));

  return out;
}

export interface YahooRankingEntry {
  title: string;
  url: string;
}

/** <a>ブロック単位でtitle/urlを対応付ける（記事別のコメント数取得に使う） */
const ANCHOR_BLOCK =
  /<a href="(https:\/\/news\.yahoo\.co\.jp\/articles\/[a-f0-9]+)"[^>]*>([\s\S]{0,2500}?)<\/a>/g;

function extractTitleFromAnchorContent(html: string): string | null {
  const div = html.match(/<div class="[^"]+">([^<]{6,120})<\/div>/);
  if (div) return div[1].trim();
  const p = html.match(/<p class="[^"]+">([^<]{6,160})<\/p>/);
  if (p) return p[1].trim();
  return null;
}

/** ランキングのtitle/urlペアを抽出（記事URLごとにコメント数を取得するための対応付け） */
export function extractYahooRankingEntries(html: string): YahooRankingEntry[] {
  const out: YahooRankingEntry[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(ANCHOR_BLOCK)) {
    const url = m[1];
    if (seen.has(url)) continue;
    const title = extractTitleFromAnchorContent(m[2]);
    if (!title) continue;
    seen.add(url);
    out.push({ title, url });
  }
  return out;
}

async function fetchRankingHtml(path: string): Promise<string> {
  const res = await fetch(`https://news.yahoo.co.jp${path}`, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.text();
}

async function fetchRankingPage(path: string): Promise<string[]> {
  return extractYahooRankingTitles(await fetchRankingHtml(path));
}

async function fetchRankingTitles(paths: readonly string[], label: string): Promise<string[]> {
  try {
    const batches = await Promise.all(
      paths.map(async (path) => {
        try {
          return await fetchRankingPage(path);
        } catch (e) {
          console.warn(`  ⚠️ ${label}: ${path} 取得失敗 (${e})`);
          return [];
        }
      }),
    );
    return Array.from(new Set(batches.flat()));
  } catch (e) {
    console.warn(`  ⚠️ ${label}: 取得失敗 (${e})`);
    return [];
  }
}

export async function fetchYahooNewsRankingTitles(): Promise<string[]> {
  return fetchRankingTitles(RANKING_PATHS, "yahoo-news-ranking");
}

/** コメント数ランキングの見出し。「賛否が割れて議論になっている」の実測シグナル。 */
export async function fetchYahooCommentRankingTitles(): Promise<string[]> {
  return fetchRankingTitles(COMMENT_RANKING_PATHS, "yahoo-comment-ranking");
}

/** コメント数ランキングのtitle/urlペア。個別記事のコメント数（炎上の強度）を取得する起点になる */
export async function fetchYahooCommentRankingEntries(): Promise<YahooRankingEntry[]> {
  try {
    const batches = await Promise.all(
      COMMENT_RANKING_PATHS.map(async (path) => {
        try {
          return extractYahooRankingEntries(await fetchRankingHtml(path));
        } catch (e) {
          console.warn(`  ⚠️ yahoo-comment-ranking-entries: ${path} 取得失敗 (${e})`);
          return [];
        }
      }),
    );
    const seen = new Set<string>();
    const out: YahooRankingEntry[] = [];
    for (const entry of batches.flat()) {
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);
      out.push(entry);
    }
    return out;
  } catch (e) {
    console.warn(`  ⚠️ yahoo-comment-ranking-entries: 取得失敗 (${e})`);
    return [];
  }
}

const COMMENT_COUNT_PATTERN = /"totalCommentCount":(\d+)/;

/**
 * Yahoo!ニュース記事個別ページの総コメント数を取得する。
 * 「賛否分裂の実測（炎上強度）」の絶対値・時系列差分を得るための1記事1リクエスト。
 * researchTopic対象（1実行あたり最大十数件）にのみ使い、収集フェーズでは呼ばない。
 */
export async function fetchYahooArticleCommentCount(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(COMMENT_COUNT_PATTERN);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
