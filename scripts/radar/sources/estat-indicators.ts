/**
 * e-Stat 確定指標（getStatsData で実数値を逐語取得する版）。
 *
 * getStatsList（estat.ts）が「関連統計が存在する」ことを名前で示すだけなのに対し、
 * こちらは「消費者物価指数(総合)は前年同月比+1.5%」のような**政府の確定数値そのもの**を記事に載せる。
 *
 * 安全設計（数値の取り違え・hallucination を原理的に防ぐ）:
 *   - 汎用検索はしない。キュレーションした基幹指標だけを、statsDataId とセル座標
 *     （cdTab/cdCat.../cdArea）をハードコードで固定して取得する。全て実APIで検証済み。
 *   - 数値抽出は LLM ではなく決定的なコードで行い、最新時点の値・単位・時点ラベルを組み立てる。
 *   - Writer には完成済みの逐語文字列を渡し「そのまま引用・改変/再計算禁止」とする（radar-article.ts）。
 *   - 月次更新の指標なので日次ファイルキャッシュ（.cache/estat-indicators/）で critical path から外す。
 *
 * 指標を増やすには INDICATORS に1エントリ足すだけ（statsDataId とセル座標を getMetaInfo で確認して固定）。
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ESTAT_API_BASE = "https://api.e-stat.go.jp/rest/3.0/app/json";
const CACHE_DIR = path.join(process.cwd(), ".cache", "estat-indicators");
const CACHE_TTL_MS = 24 * 60 * 60_000; // 月次指標なので1日1回で十分

/** 値の種類。表示文言の組み立てに使う。 */
type IndicatorKind = "yoy_pct" | "rate";

interface EStatIndicator {
  /** 内部キー（キャッシュファイル名にも使う） */
  key: string;
  /** 表示名 */
  label: string;
  /** 政府統計の作成機関 */
  govOrg: string;
  /** 調査名（帰属表示用） */
  survey: string;
  /** getStatsData の統計表ID（実APIで検証済み） */
  statsDataId: string;
  /** セル座標。単一系列に絞り込むためのコード（cdTab / cdCat01 / cdArea 等）。 */
  codes: Record<string, string>;
  kind: IndicatorKind;
  /** このトピックに該当したら発火するキーワード（いずれか一致で発火） */
  keywords: RegExp;
}

/**
 * 確定指標ホワイトリスト（全て 2026-07-18 に実APIで数値取得を検証）。
 * codes は getMetaInfo で各次元のコードを確認して固定している。
 */
const INDICATORS: EStatIndicator[] = [
  {
    key: "cpi_all",
    label: "消費者物価指数（総合）",
    govOrg: "総務省",
    survey: "消費者物価指数（2020年基準）",
    statsDataId: "0003427113",
    // tab=3:前年同月比 / cat01=0001:総合 / area=00000:全国
    codes: { cdTab: "3", cdCat01: "0001", cdArea: "00000" },
    kind: "yoy_pct",
    keywords: /物価|インフレ|値上げ|消費者物価|物価高|デフレ|CPI/i,
  },
  {
    key: "cpi_core",
    label: "消費者物価指数（生鮮食品を除く総合）",
    govOrg: "総務省",
    survey: "消費者物価指数（2020年基準）",
    statsDataId: "0003427113",
    // tab=3:前年同月比 / cat01=0161:生鮮食品を除く総合 / area=00000:全国
    codes: { cdTab: "3", cdCat01: "0161", cdArea: "00000" },
    kind: "yoy_pct",
    keywords: /物価|インフレ|値上げ|コアCPI|日銀|金融政策|利上げ|物価高/i,
  },
  {
    key: "unemployment",
    label: "完全失業率",
    govOrg: "総務省",
    survey: "労働力調査",
    statsDataId: "0003005865",
    // tab=02:率 / cat01=000:全産業 / cat02=08:完全失業者 / cat03=0:総数 / area=00000:全国
    codes: { cdTab: "02", cdCat01: "000", cdCat02: "08", cdCat03: "0", cdArea: "00000" },
    kind: "rate",
    keywords: /失業|雇用|働き口|リストラ|求職|失業率/,
  },
];

export interface EStatIndicatorFigure {
  key: string;
  label: string;
  /** 実数値（例: "1.5"） */
  value: string;
  /** 単位（例: "%"） */
  unit: string;
  /** 時点ラベル（例: "2026年5月"） */
  timeLabel: string;
  govOrg: string;
  survey: string;
  /** 統計表の参照URL */
  sourceUrl: string;
  /** Writer にそのまま渡す逐語文字列（改変・再計算禁止） */
  text: string;
}

/** e-Stat 月次時間軸コード（"2026000505"）→ "2026年5月"。想定外形式は null。 */
function parseMonthlyTimeLabel(code: string): string | null {
  // 10桁: YYYY + "00" + MM + <期別2桁>。年は先頭4桁、月は7〜8桁目。
  const m = /^(\d{4})\d{2}(\d{2})\d{2}$/.exec(code);
  if (!m) return null;
  const year = m[1];
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return `${year}年${month}月`;
}

function buildText(ind: EStatIndicator, value: string, unit: string, timeLabel: string): string {
  const attribution = `${timeLabel}・${ind.govOrg}「${ind.survey}」`;
  if (ind.kind === "yoy_pct") {
    // 符号を明示（+/−）。APIの値は "1.5" / "-0.2" 形式。
    const num = parseFloat(value);
    const signed = Number.isFinite(num) ? (num > 0 ? `+${value}` : value) : value;
    return `${ind.label}は前年同月比${signed}${unit}（${attribution}）`;
  }
  // rate（失業率など）
  return `${ind.label}は${value}${unit}（${attribution}）`;
}

const cachePath = (key: string) => path.join(CACHE_DIR, `${key}.json`);

function readCache(key: string): EStatIndicatorFigure | null {
  if (process.env.VITEST) return null;
  try {
    const file = cachePath(key);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (Date.now() - data.ts > CACHE_TTL_MS) return null;
    return data.figure as EStatIndicatorFigure;
  } catch {
    return null;
  }
}

function writeCache(key: string, figure: EStatIndicatorFigure): void {
  if (process.env.VITEST) return;
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cachePath(key), JSON.stringify({ ts: Date.now(), figure }), "utf-8");
  } catch {
    // キャッシュ失敗は無視
  }
}

/** getStatsData を叩いて、固定セル系列の最新値を1点返す。失敗・不正時は null。 */
async function fetchLatest(ind: EStatIndicator): Promise<EStatIndicatorFigure | null> {
  const appId = process.env.ESTAT_APP_ID;
  if (!appId) return null;
  const params = new URLSearchParams({
    appId,
    lang: "J",
    statsDataId: ind.statsDataId,
    metaGetFlg: "N",
    cntGetFlg: "N",
    ...ind.codes,
  });
  const res = await fetch(`${ESTAT_API_BASE}/getStatsData?${params.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as EStatDataResult;
  if (data?.GET_STATS_DATA?.RESULT?.STATUS !== 0) return null;
  const raw = data?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE ?? [];
  const values = Array.isArray(raw) ? raw : [raw];
  if (values.length === 0) return null;
  // 最新時点（@time が最大）を取る
  let latest = values[0];
  for (const v of values) {
    if ((v["@time"] ?? "") > (latest["@time"] ?? "")) latest = v;
  }
  const value = String(latest["$"] ?? "").trim();
  const unit = String(latest["@unit"] ?? "").trim();
  const timeLabel = parseMonthlyTimeLabel(String(latest["@time"] ?? ""));
  // 値・単位・時点のいずれかが欠けたら安全側で使わない（不正確な数値は載せない）
  if (!value || !unit || !timeLabel || !/^-?\d/.test(value)) return null;
  const sourceUrl = `https://www.e-stat.go.jp/dbview?sid=${ind.statsDataId}`;
  return {
    key: ind.key,
    label: ind.label,
    value,
    unit,
    timeLabel,
    govOrg: ind.govOrg,
    survey: ind.survey,
    sourceUrl,
    text: buildText(ind, value, unit, timeLabel),
  };
}

/** 1指標分の確定数値を取得（キャッシュ優先）。取得失敗は null で握りつぶす（fail-soft）。 */
async function getIndicatorFigure(ind: EStatIndicator): Promise<EStatIndicatorFigure | null> {
  const cached = readCache(ind.key);
  if (cached) return cached;
  try {
    const figure = await fetchLatest(ind);
    if (figure) writeCache(ind.key, figure);
    return figure;
  } catch {
    return null;
  }
}

/**
 * トピック語に該当する確定指標の逐語数値を返す。
 * - キーワード非該当なら即 []（API を叩かない）。
 * - 該当時のみ、日次キャッシュ or getStatsData で最新値を取得する。
 * 記事側はここで返った figure.text を「逐語引用・改変禁止」で使う。
 */
export async function fetchTopicIndicators(topic: string): Promise<EStatIndicatorFigure[]> {
  if (!process.env.ESTAT_APP_ID) return [];
  const t = topic ?? "";
  const matched = INDICATORS.filter((ind) => ind.keywords.test(t));
  if (matched.length === 0) return [];
  const figures = await Promise.all(matched.map((ind) => getIndicatorFigure(ind)));
  return figures.filter((f): f is EStatIndicatorFigure => f !== null);
}

// テスト・保守用に内部定義を公開する
export const __INDICATORS = INDICATORS;
export { parseMonthlyTimeLabel, buildText };

interface EStatValue {
  "@time"?: string;
  "@unit"?: string;
  $?: string;
}
interface EStatDataResult {
  GET_STATS_DATA?: {
    RESULT?: { STATUS: number; ERROR_MSG?: string };
    STATISTICAL_DATA?: {
      DATA_INF?: { VALUE?: EStatValue | EStatValue[] };
    };
  };
}
