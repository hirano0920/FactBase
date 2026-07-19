/**
 * 参議院 本会議投票結果（記名投票・押しボタン投票）のスクレイピング。
 * https://www.sangiin.go.jp/japanese/touhyoulist/
 *
 * 議案ごとの「どの政党が何人賛成/反対したか」という一次情報を取得する。
 * 国会会議録検索API（kokkai.ts）は発言記録のみで投票結果は持っていないため、
 * これは別ソース。正式なAPIは無く、公式サイトの規則的なHTML構造から抽出する
 * （yahoo-news-ranking.ts等、既存の他ソースと同じスクレイピング手法）。
 *
 * 対象は「記名投票及び押しボタン投票」のみ＝すでに公式サイト側で
 * 「賛否が割れて記録に残す価値がある採決」に絞られている（起立採決の全会一致案件は載らない）。
 * これはTwoSidesが欲しい「実際に対立があった」証拠そのものと相性が良い。
 *
 * 参議院のみ対応（衆議院は同等の規則的な公開ページが確認できなかったため見送り）。
 * 法案は参議院を通過して成立することが多く、最終盤の採決を拾えれば実用上十分。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { bigrams } from "../../../src/lib/radar";
import { matchDietVoteTitle } from "../../../src/lib/ai";
import { findRecentSpeakerPosition } from "./kokkai";

const BASE = "https://www.sangiin.go.jp/japanese/touhyoulist";
const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";
const CACHE_DIR = path.join(process.cwd(), ".cache", "diet-votes");

export interface PartyVoteBreakdown {
  /** 会派名（例: 立憲民主・無所属） */
  party: string;
  /** 会派の議席数（採決時点） */
  memberCount: number;
  for: number;
  against: number;
}

export type MemberVote = "for" | "against" | "abstain";

export interface DietVoteMember {
  name: string;
  party: string;
  vote: MemberVote;
}

/**
 * 党議に反して投票した議員（離反者）。
 * 会派の多数派方向（forの人数＞againstなら多数派=for）と逆に投票した個人を機械的に抽出したもの。
 * role は現職閣僚など、国会会議録から実際の発言記録で確認できた肩書のみを入れる
 * （党内の役職＝幹事長・政調会長等は会議録に載らないため確認できず、常にnull）。
 */
export interface DietVoteDefector {
  name: string;
  party: string;
  vote: MemberVote;
  /** 現職閣僚の肩書（例: "防衛大臣"）。確認できなければnull（憶測で埋めない） */
  role: string | null;
}

export interface DietVoteBreakdown {
  /** 議案名（公式表記） */
  billTitle: string;
  voteDate: string; // "令和08年7月17日" 形式（サイト表記そのまま）
  totalFor: number;
  totalAgainst: number;
  parties: PartyVoteBreakdown[];
  members: DietVoteMember[];
  /** 所属会派の多数派と逆に投票した議員（該当なければ空配列） */
  defectors: DietVoteDefector[];
  sourceUrl: string;
}

interface VoteIndexEntry {
  date: string;
  title: string;
  url: string;
}

function readTextCache(file: string, ttlMs: number): string | null {
  if (process.env.VITEST) return null;
  try {
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > ttlMs) return null;
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

function writeTextCache(file: string, text: string): void {
  if (process.env.VITEST) return;
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, text, "utf-8");
  } catch {
    // キャッシュ失敗は無視（機能低下しない）
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function stripToLines(html: string): string[] {
  const body = html.slice(html.indexOf("<body"));
  let text = body.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<[^>]+>/g, "\n");
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * 現在の国会回次を判定する。トップページの一覧は新しい順に並んでいるため先頭を取る。
 * 6時間キャッシュ（頻繁に変わらないので毎回叩かない）。
 */
export async function getCurrentSangiinSession(): Promise<number | null> {
  const cacheFile = path.join(CACHE_DIR, "current-session.txt");
  const cached = readTextCache(cacheFile, 6 * 60 * 60_000);
  if (cached) {
    const n = parseInt(cached, 10);
    if (Number.isFinite(n)) return n;
  }
  try {
    const html = await fetchText(`${BASE}/touhyoulist.html`);
    const m = /\/japanese\/touhyoulist\/(\d+)\/vote_ind\.htm/.exec(html);
    if (!m) return null;
    const session = parseInt(m[1], 10);
    writeTextCache(cacheFile, String(session));
    return session;
  } catch (e) {
    console.warn(`  ⚠️ diet-votes: 国会回次の取得失敗 (${e})`);
    return null;
  }
}

/**
 * 指定回次の投票一覧（案件名・日付・詳細ページURL）を取得する。
 * サイトのHTMLは日付をrowspanでまとめる不規則な表なので、直前に見た日付を引き継いで割り当てる。
 * 3時間キャッシュ（開会中は数日おきに数件ずつ追加される程度）。
 */
export async function fetchSangiinVoteIndex(session: number): Promise<VoteIndexEntry[]> {
  const cacheFile = path.join(CACHE_DIR, `index-${session}.html`);
  let html = readTextCache(cacheFile, 3 * 60 * 60_000);
  if (!html) {
    try {
      html = await fetchText(`${BASE}/${session}/vote_ind.htm`);
      writeTextCache(cacheFile, html);
    } catch (e) {
      console.warn(`  ⚠️ diet-votes: 投票一覧の取得失敗 session=${session} (${e})`);
      return [];
    }
  }
  const entries: VoteIndexEntry[] = [];
  const rowRe = /<TR>\s*(?:<TH[^>]*class="touhyo_date"[^>]*>([^<]*)<\/TH>\s*)?<TD><A HREF="([^"]+)">([^<]*)<\/A><\/TD>\s*<\/TR>/gi;
  let m: RegExpExecArray | null;
  let lastDate = "";
  while ((m = rowRe.exec(html)) !== null) {
    const date = (m[1] ?? "").trim() || lastDate;
    lastDate = date;
    const href = m[2].trim();
    const title = m[3].trim();
    if (!href || !title) continue;
    const url = href.startsWith("http") ? href : `${BASE}/${session}/${href}`;
    entries.push({ date, title, url });
  }
  return entries;
}

/**
 * party行「立憲民主・無所属( 40名)」と直後の「賛成票   0　　　反対票  40」をペアで抽出し、
 * 続く個人票（ラベル行→氏名行の順で繰り返す。ラベルは「賛成」「反対」または2行の「投票」「なし」）も
 * 一緒に抽出する。ラベルとして解釈できない行に当たったら、そのブロックは終了（次のparty行のはず）。
 *
 * ★実データで確認済みの並び順: ラベルが先、氏名が後（例:「賛成」→「青木　一彦」で青木さんが賛成）。
 * 逆順にすると個人の賛否を取り違える（実害の大きい誤帰属）ので、変更時は必ず実データで確認すること。
 */
function parsePartyBreakdown(lines: string[]): { parties: PartyVoteBreakdown[]; members: DietVoteMember[] } {
  const parties: PartyVoteBreakdown[] = [];
  const members: DietVoteMember[] = [];
  const headerRe = /^(.+?)\(\s*(\d+)名\)$/;
  const countRe = /賛成票\s*(\d+)\s*反対票\s*(\d+)/;
  let i = 0;
  while (i < lines.length - 1) {
    const h = headerRe.exec(lines[i]);
    if (!h) {
      i++;
      continue;
    }
    const c = countRe.exec(lines[i + 1]);
    if (!c) {
      i++;
      continue;
    }
    const party = h[1].trim();
    parties.push({
      party,
      memberCount: parseInt(h[2], 10),
      for: parseInt(c[1], 10),
      against: parseInt(c[2], 10),
    });
    i += 2;
    // このparty配下の個人票を、次のparty行に当たるまで読み進める
    while (i < lines.length) {
      const label = lines[i];
      let vote: MemberVote | null = null;
      let consumed = 0;
      if (label === "賛成") {
        vote = "for";
        consumed = 1;
      } else if (label === "反対") {
        vote = "against";
        consumed = 1;
      } else if (label === "投票" && lines[i + 1] === "なし") {
        vote = "abstain";
        consumed = 2;
      } else {
        break; // ラベルとして解釈できない＝次のparty行（外側ループが処理する）
      }
      const name = lines[i + consumed];
      if (!name) break;
      members.push({ name: name.trim(), party, vote });
      i += consumed + 1;
    }
  }
  return { parties, members };
}

/**
 * 会派の多数派方向（forの人数＞againstなら多数派=for）と逆に投票した個人を抽出する。
 * 「各派に属しない議員」（無所属の集合。政党の党議拘束が無いので離反という概念が成立しない）は対象外。
 * for/againstが同数（真の拮抗）で多数派を判定できない会派も対象外にする（誤って離反者扱いしないため）。
 */
export function findDefectors(parties: PartyVoteBreakdown[], members: DietVoteMember[]): DietVoteMember[] {
  const majorityByParty = new Map<string, MemberVote>();
  for (const p of parties) {
    if (p.party === "各派に属しない議員") continue;
    if (p.for === p.against) continue;
    majorityByParty.set(p.party, p.for > p.against ? "for" : "against");
  }
  return members.filter((m) => {
    const majority = majorityByParty.get(m.party);
    if (!majority) return false;
    return m.vote !== "abstain" && m.vote !== majority;
  });
}

/**
 * 投票結果の詳細ページを取得し、党派別の賛否内訳を返す。
 * 一度確定した過去の採決結果は変わらないので長期キャッシュ（30日）。
 */
export async function fetchSangiinVoteDetail(entry: VoteIndexEntry): Promise<DietVoteBreakdown | null> {
  const cacheKey = entry.url.split("/").pop() ?? entry.url;
  const cacheFile = path.join(CACHE_DIR, `detail-${cacheKey}.html`);
  let html = readTextCache(cacheFile, 30 * 24 * 60 * 60_000);
  if (!html) {
    try {
      html = await fetchText(entry.url);
      writeTextCache(cacheFile, html);
    } catch (e) {
      console.warn(`  ⚠️ diet-votes: 投票詳細の取得失敗 (${entry.url}) (${e})`);
      return null;
    }
  }
  const lines = stripToLines(html);
  // ページ内で最初に出現する「賛成票X 反対票Y」が投票総数（会派別の内訳行はこの後に続く）
  const totalLine = lines.find((l) => /賛成票\s*\d+\s*反対票\s*\d+/.test(l));
  const totalMatch = totalLine ? /賛成票\s*(\d+)\s*反対票\s*(\d+)/.exec(totalLine) : null;
  const { parties, members } = parsePartyBreakdown(lines);
  if (!totalMatch || parties.length === 0) return null;

  // 離反者は通常ごく少数（0〜数名）なので、肩書照合（kokkai API）をこの人数分だけ行う
  // （全議員分は呼ばない＝コスト・レイテンシを抑える）。
  const rawDefectors = findDefectors(parties, members);
  const defectors: DietVoteDefector[] = await Promise.all(
    rawDefectors.map(async (d) => ({
      ...d,
      role: await findRecentSpeakerPosition(d.name),
    })),
  );

  return {
    billTitle: entry.title.replace(/^日程第[０-９0-9]+\s*/, "").trim(),
    voteDate: entry.date,
    totalFor: parseInt(totalMatch[1], 10),
    totalAgainst: parseInt(totalMatch[2], 10),
    parties,
    members,
    defectors,
    sourceUrl: entry.url,
  };
}

/**
 * トピック語（「国旗損壊罪」等の通称）と議案の正式名称（「国旗の損壊等の処罰に関する法律案」等）は
 * 字面が大きく異なることが多いため、bigram1つでも共有していれば候補として残す
 * 緩いプリフィルタ（コスト抑制用。最終判定はnanoに委ねる）。
 */
function prefilterCandidates(topic: string, index: VoteIndexEntry[]): VoteIndexEntry[] {
  const topicBigrams = bigrams(topic);
  if (topicBigrams.size === 0) return [];
  return index.filter((e) => {
    for (const bg of bigrams(e.title)) {
      if (topicBigrams.has(bg)) return true;
    }
    return false;
  });
}

/**
 * トピック語（法案名の一部・通称等）に対応する参議院の投票結果を検索して返す。
 * 一致する採決が見つからない・記名投票が行われていない議案は null（fail-soft）。
 *
 * 議案の正式名称は通称と字面が大きく異なるため、bigram共有によるプリフィルタで
 * 候補を絞ってから、最終判定はnano（matchDietVoteTitle）に委ねる
 * （プリフィルタ0件ならnanoを呼ばずコストゼロで抜ける）。
 */
export async function fetchDietVoteBreakdown(topic: string): Promise<DietVoteBreakdown | null> {
  if (!topic || topic.trim().length < 2) return null;
  try {
    const session = await getCurrentSangiinSession();
    if (!session) return null;
    const index = await fetchSangiinVoteIndex(session);
    if (index.length === 0) return null;
    const candidates = prefilterCandidates(topic, index).slice(0, 20);
    if (candidates.length === 0) return null;
    const idx = await matchDietVoteTitle(
      topic,
      candidates.map((c) => c.title),
    );
    if (idx === null) return null;
    return await fetchSangiinVoteDetail(candidates[idx]);
  } catch (e) {
    console.warn(`  ⚠️ diet-votes (${topic}): 取得失敗 (${e})`);
    return null;
  }
}
