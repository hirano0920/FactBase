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
      LIST_INF?: EStatRawItem | EStatRawItem[];
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

/**
 * トピック語でe-Stat統計一覧を検索する。
 * 経済・労働・物価など数値で裏取りできるトピックで、公式統計の存在と名称を記事に示す材料になる。
 * API呼び出しが失敗した場合は空配列を返す（記事生成は他の材料で続行）。
 */
export async function searchEStatStats(term: string, limit = 3): Promise<EStatItem[]> {
  const appId = process.env.ESTAT_APP_ID;
  if (!appId) return [];
  if (term.trim().length < 2) return [];

  try {
    const params = new URLSearchParams({
      appId,
      lang: "J",
      searchWord: term,
      limit: String(limit * 3), // 後でフィルタするので多めに取る
      statsCode: "00", // 全統計
    });
    const res = await fetch(`${ESTAT_API_BASE}/getStatsList?${params.toString()}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as EStatListResult;

    const result = data?.GET_STATS_LIST?.RESULT;
    if (result?.STATUS !== 0) {
      // STATUS=0 以外はデータなし or エラー（よくあるので警告不要）
      return [];
    }

    const raw = data?.GET_STATS_LIST?.DATALIST_INF?.LIST_INF ?? [];
    const items = Array.isArray(raw) ? raw : [raw];

    return items.slice(0, limit).map((item) => ({
      statsName: item.STATISTICS_NAME ?? item.STAT_NAME?.["$"] ?? "",
      govOrg: item.GOV_ORG?.["$"] ?? "",
      statsDataUrl: `https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&toukei=${item["@id"]}`,
      surveyDate: String(item.SURVEY_DATE ?? ""),
    }));
  } catch (e) {
    console.warn(`  ⚠️ e-Stat (${term}): 取得失敗 (${e})`);
    return [];
  }
}
