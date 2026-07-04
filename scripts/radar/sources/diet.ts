/**
 * 衆参両院は公式RSSがないため、SmartNews Media Research Institute (SMRI) が
 * 公開している議案データベース(CSV由来のJSON、MITライセンス系OSS)を利用する。
 * https://github.com/smartnews-smri/house-of-representatives
 * https://github.com/smartnews-smri/house-of-councillors
 *
 * データは「行=議案」の全量スナップショット（数千〜1万件超、過去の国会分すべて含む）。
 * 今の国会（最新セッション番号）の行だけに絞り、審議状況の文字列をタイトルに埋め込むことで、
 * 「同じ議案でも状況が変わったら新しいタイトル→新しいSourceEvent」という形で
 * 既存のfeedName+titleハッシュ重複排除にそのまま乗せる（専用の差分ストレージ不要）。
 */
import type { FeedItem } from "./common";

const UA = "FactBaseRadar/1.0 (+https://factbase.tokyo)";
const SHUGIIN_URL =
  "https://raw.githubusercontent.com/smartnews-smri/house-of-representatives/main/data/gian.json";
const SANGIIN_URL =
  "https://raw.githubusercontent.com/smartnews-smri/house-of-councillors/main/data/gian.json";

async function fetchJson(url: string): Promise<unknown[][] | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as unknown[][];
    return Array.isArray(data) && data.length > 1 ? data : null;
  } catch (e) {
    console.warn(`  ⚠️ diet (${url}): 取得失敗 (${e})`);
    return null;
  }
}

/** 衆議院: 掲載回次(index0)を国会回次として使う。最新行が最新国会。 */
export async function fetchShugiinBills(): Promise<FeedItem[]> {
  const rows = await fetchJson(SHUGIIN_URL);
  if (!rows) return [];
  const data = rows.slice(1); // 0行目はヘッダー

  const currentSession = Math.max(...data.map((r) => Number(r[0]) || 0));
  const items: FeedItem[] = [];

  for (const r of data) {
    if (Number(r[0]) !== currentSession) continue;
    const title = String(r[5] ?? "").trim();
    const status = String(r[6] ?? "").trim();
    const url = String(r[8] || r[10] || "").trim();
    if (!title || !url) continue;

    items.push({
      feedName: "shugiin-gian",
      trust: 95,
      title: `衆議院第${currentSession}回: 「${title}」${status ? `→ ${status}` : ""}`,
      url,
      publishedAt: new Date(),
    });
  }
  return items;
}

/** 参議院: 審議回次(index0)を国会回次として使う。議決状況は複数列から合成。 */
export async function fetchSangiinBills(): Promise<FeedItem[]> {
  const rows = await fetchJson(SANGIIN_URL);
  if (!rows) return [];
  const data = rows.slice(1);

  const currentSession = Math.max(...data.map((r) => Number(r[0]) || 0));
  const items: FeedItem[] = [];

  for (const r of data) {
    if (Number(r[0]) !== currentSession) continue;
    const title = String(r[4] ?? "").trim();
    const url = String(r[5] ?? "").trim();
    if (!title || !url) continue;

    // 参議院本会議議決(21) > 衆議院本会議議決(31) > 参議院委員会議決(19) の優先順で状況を合成
    const status =
      String(r[21] || r[31] || r[19] || "").trim() || "審議中";

    items.push({
      feedName: "sangiin-gian",
      trust: 95,
      title: `参議院第${currentSession}回: 「${title}」→ ${status}`,
      url,
      publishedAt: new Date(),
    });
  }
  return items;
}
