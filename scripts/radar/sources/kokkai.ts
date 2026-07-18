/**
 * 国会会議録検索システム API（国立国会図書館、無料・APIキー不要）。
 * https://kokkai.ndl.go.jp/api.html
 *
 * Radarの「能動調査」の中核。バズ検知したトピック語（例:「国旗損壊罪」）で発言を全文検索し、
 * 「その争点が国会でどこまで審議されているか」「誰が何を発言したか」という一次情報を取りにいく。
 * RSSを待ち受ける従来設計と違い、トピックを起点に能動的に叩く点が新パイプラインの肝。
 *
 * 発言単位(/api/speech)を新しい順に取得する。会議名・院・日付・発言者・発言抜粋・原文URLを返し、
 * これがそのまま「時系列で何が議論されてきたか」の材料になる。
 */
const SPEECH_API = "https://kokkai.ndl.go.jp/api/speech";
const UA = "FactBaseRadar/1.0 (+https://factbase.tokyo)";

export interface DietSpeech {
  date: string;
  house: string; // 衆議院 / 参議院
  meeting: string; // 会議名（内閣委員会 等）
  session: string; // 国会回次
  speaker: string;
  speakerGroup: string; // 会派
  snippet: string; // 発言抜粋
  url: string; // 会議録原文URL
}

/** "None" 文字列（APIが null をこう返す）や空白を正規化する */
function clean(value: unknown): string {
  const s = String(value ?? "").trim();
  return s === "None" ? "" : s;
}

/**
 * トピック語で国会発言を全文検索し、新しい順に最大 limit 件返す。
 * 取得失敗・0件は空配列にフォールバック（能動調査全体を止めない）。
 */
export async function searchDietSpeeches(term: string, limit = 5): Promise<DietSpeech[]> {
  if (term.trim().length < 2) return [];
  try {
    const params = new URLSearchParams({
      any: term,
      recordPacking: "json",
      maximumRecords: String(Math.min(limit, 10)),
    });
    const res = await fetch(`${SPEECH_API}?${params.toString()}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { speechRecord?: Record<string, unknown>[] };
    const records = Array.isArray(data.speechRecord) ? data.speechRecord : [];

    return records
      .map((r) => ({
        date: clean(r.date),
        house: clean(r.nameOfHouse),
        meeting: clean(r.nameOfMeeting),
        session: clean(r.session),
        speaker: clean(r.speaker),
        speakerGroup: clean(r.speakerGroup),
        snippet: clean(r.speech).slice(0, 300),
        url: clean(r.speechURL) || clean(r.meetingURL),
      }))
      .filter((s) => s.url && s.snippet)
      // 会議日付の新しい順（APIは関連度順で返すため、時系列材料として並べ替える）
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  } catch (e) {
    console.warn(`  ⚠️ kokkai (${term}): 取得失敗 (${e})`);
    return [];
  }
}

/**
 * 指定した氏名の直近の発言記録から speakerPosition（国務大臣等の肩書。API側が実際の会議録に
 * 記載された肩書として返す一次情報）を取得する。幹事長・政調会長等の党内役職は会議録に
 * 記載されないため取得できない（憶測で埋めず null を返す）。
 *
 * 古い在任時の肩書を「現職」として誤表示しないよう、直近 maxAgeDays 以内の発言のみを見る
 * （内閣改造で肩書が変わった後も過去の発言記録にはその時点の肩書が残るため）。
 */
export async function findRecentSpeakerPosition(
  name: string,
  maxAgeDays = 90,
): Promise<string | null> {
  if (name.trim().length < 2) return null;
  try {
    const params = new URLSearchParams({
      speaker: name,
      recordPacking: "json",
      maximumRecords: "3",
    });
    const res = await fetch(`${SPEECH_API}?${params.toString()}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { speechRecord?: Record<string, unknown>[] };
    const records = Array.isArray(data.speechRecord) ? data.speechRecord : [];
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60_000;
    for (const r of records) {
      const date = clean(r.date);
      const position = clean(r.speakerPosition);
      if (!date || !position) continue;
      const t = new Date(date).getTime();
      if (Number.isFinite(t) && t >= cutoff) return position;
    }
    return null;
  } catch (e) {
    console.warn(`  ⚠️ kokkai speakerPosition (${name}): 取得失敗 (${e})`);
    return null;
  }
}
