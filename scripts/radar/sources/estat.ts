/**
 * e-Stat（政府統計の総合窓口）API — 無料の一次政府統計データを記事の根拠材料として取得。
 * https://api.e-stat.go.jp/
 *
 * 利用登録（無料）で取得した appId を ESTAT_APP_ID 環境変数にセットして使う。
 * キーが未設定の場合は空配列を返し、記事生成は他の材料で続行する。
 *
 * 主な用途: 経済系トピックで「物価は実際何%上昇したか」「失業率は何%か」等、
 * 伝聞ではなく一次の生データを記事に埋め込む。
 */

const ESTAT_API_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json";

export interface EStatItem {
  /** 統計表名 */
  statsName: string;
  /** 政府機関名 */
  govOrg: string;
  /** 統計表のe-StatページURL */
  statsDataUrl: string;
  /** 調査サイクル（年次/月次/etc） */
  surveyDate: string;
}

interface EStatListResult {
  GET_STATS_LIST?: {
    DATALIST_INF?: {
      // getStatsList の統計表レコードは TABLE_INF に入る（LIST_INF ではない）。
      TABLE_INF?: EStatRawItem | EStatRawItem[];
      NUMBER?: number;
    };
    RESULT?: { STATUS: number; ERROR_MSG?: string };
  };
}

interface EStatRawItem {
  "@id": string;
  STAT_NAME?: { "$": string };
  GOV_ORG?: { "$": string };
  MAIN_CATEGORY?: { "$": string };
  STATISTICS_NAME?: string;
  SURVEY_DATE?: string;
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * getStatsList を1回叩いて統計表を返す。extra で絞込パラメータ（updatedDate/collectArea等）を渡す。
 * 注意: statsCode は特定の政府統計コード（5/8桁）専用。全統計横断検索では付けてはいけない
 * （"00" 等を渡すと STATUS=102「statsCodeの値が正しくありません」で常に0件になる）。
 */
async function fetchStatsList(
  appId: string,
  term: string,
  limit: number,
  extra: Record<string, string>,
): Promise<EStatItem[]> {
  const params = new URLSearchParams({
    appId,
    lang: "J",
    searchWord: term,
    limit: String(limit * 3), // 後でフィルタするので多めに取る
    ...extra,
  });
  const res = await fetch(`${ESTAT_API_BASE}/getStatsList?${params.toString()}`, {
    // e-Stat の getStatsList は絞込なしだと遅い（実測12〜14秒）。updatedDate等で絞ると1〜3秒。
    // 余裕をもたせる。fail-softなので遅延は空配列で吸収。
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as EStatListResult;
  if (data?.GET_STATS_LIST?.RESULT?.STATUS !== 0) return []; // データなし or エラー
  const raw = data?.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF ?? [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items.slice(0, limit).map((item) => ({
    statsName: item.STATISTICS_NAME ?? item.STAT_NAME?.["$"] ?? "",
    govOrg: item.GOV_ORG?.["$"] ?? "",
    statsDataUrl: `https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&toukei=${item["@id"]}`,
    surveyDate: String(item.SURVEY_DATE ?? ""),
  }));
}

/**
 * トピック語でe-Stat統計一覧を検索する。
 * 経済・労働・物価など数値で裏取りできるトピックで、公式統計の存在と名称を記事に示す材料になる。
 * API呼び出しが失敗した場合は空配列を返す（記事生成は他の材料で続行）。
 *
 * 絞込（2026-07-18・実APIで検証）: updatedDate=直近2年 + collectArea=1(全国)。
 * 毎月更新のCPI・労働力調査等の現行統計が上位に来て、古い基準年の調査や地方単位のノイズが落ちる。
 * しかも絞込ありは高速（1〜3秒）。絞込なしの全文検索は12〜24秒かかり researchTopic の
 * Promise.all を律速するため使わない。
 *   例:「物価」→ 小売物価統計調査（総務省）、「賃金」→ 賃金構造基本統計調査（厚労省）
 * 直近更新の全国統計が無い語（「円安」「少子化」等、そもそも該当統計表が薄い）は0件になるが、
 * fail-soft で記事は他材料で続行する（遅い全文検索でパイプラインを止めるより優先）。
 */
export async function searchEStatStats(term: string, limit = 3): Promise<EStatItem[]> {
  const appId = process.env.ESTAT_APP_ID;
  if (!appId) return [];
  if (term.trim().length < 2) return [];

  try {
    const now = new Date();
    const from = new Date(now);
    from.setFullYear(from.getFullYear() - 2);
    return await fetchStatsList(appId, term, limit, {
      updatedDate: `${yyyymmdd(from)}-${yyyymmdd(now)}`,
      collectArea: "1", // 全国
    });
  } catch (e) {
    console.warn(`  ⚠️ e-Stat (${term}): 取得失敗 (${e})`);
    return [];
  }
}
