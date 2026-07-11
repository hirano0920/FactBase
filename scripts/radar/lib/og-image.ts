/**
 * 記事カードのサムネイル取得（og:image）。
 *
 * 方針（ユーザー合意済み）:
 *   - リンクプレビューとしての小さな表示に限定する（Slack/Twitter/LINEのOGPプレビューと同じ発想）
 *   - 自前サーバーに画像を保存・再配布しない。<img src>で出典URLの画像を直接参照するだけ
 *   - 出典（元記事URL・媒体名）を必ず併記する
 *   - 取得できない/拒否された場合は静かにフォールバック（呼び出し側でnull扱い）
 *
 * 「確実に」取得するため、1候補で失敗しても諦めず複数の出典を順に試す。
 * fetchReportExcerpts等で既に本文取得に成功したURL（＝生きていて読める記事）を候補にすれば、
 * 無駄打ち（リンク切れ・パースエラー）を減らせる。
 */
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";

const OG_IMAGE_PATTERNS = [
  /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
  /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
];

/** サイト共通のロゴ・デフォルト画像によくあるファイル名（記事固有でない画像を弾く） */
const GENERIC_IMAGE_PATTERN = /(logo|default[-_]?image|noimage|no[-_]image|ogp[-_]?default|placeholder|favicon)/i;

/** HTML中のog:image（無ければtwitter:image）を抜く。記事固有でなさそうな画像はnull扱い */
export function extractOgImageUrl(html: string): string | null {
  for (const pattern of OG_IMAGE_PATTERNS) {
    const m = html.match(pattern);
    if (!m) continue;
    const url = m[1].trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (GENERIC_IMAGE_PATTERN.test(url)) continue;
    return url;
  }
  return null;
}

export interface ThumbnailCandidate {
  url: string;
  feed: string;
}

export interface ThumbnailResult {
  thumbnailUrl: string;
  thumbnailSourceUrl: string;
  thumbnailSourceFeed: string;
}

/**
 * 候補記事を順に試し、最初に取れたog:imageを採用する。
 * 個々の失敗（HTTPエラー・タイムアウト・og:image無し）は次の候補に進むだけで、
 * 全滅してもnullを返すだけで記事生成・公開自体は止めない。
 */
export async function fetchArticleThumbnail(
  candidates: ThumbnailCandidate[],
  maxAttempts = 4,
): Promise<ThumbnailResult | null> {
  for (const c of candidates.slice(0, maxAttempts)) {
    try {
      const res = await fetch(c.url, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const thumbnailUrl = extractOgImageUrl(html);
      if (thumbnailUrl) {
        return { thumbnailUrl, thumbnailSourceUrl: c.url, thumbnailSourceFeed: c.feed };
      }
    } catch {
      // 次の候補へ（1件の失敗で諦めない）
    }
  }
  return null;
}
