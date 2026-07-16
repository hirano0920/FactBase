/**
 * detect.ts が Issue.title に使う文字列を決める。
 * 争点一覧の見出し＝一般読者が「自分ごと」と感じる具体タイトル（日本語）。
 * 抽象設問（「EU声明、妥当？」）や英語見出しそのままは禁止。
 */
import { composeIssueTitle, judgeIssueTitleQuality, type PrimaryExcerptForTitle } from "../../../src/lib/ai";
import { PRIMARY_SOURCE_FEED } from "../../../src/lib/radar";

export const MAX_ISSUE_TITLE_LEN = 55;

/** nano / テンプレが付けがちな、中身の分からない抽象タイトル */
const VAGUE_TITLE_PATTERNS = [
  /^(EU|政府|官公庁|省庁|国際機関|外務省|内閣).{0,16}(公式)?発表/u,
  /公式発表をどう/u,
  /をどう受け止める/u,
  /への対応をどう見る/u,
  /の最新声明/u,
  /政策声明[、,]/u,
];

const MONOTONOUS_QUESTION_PATTERNS = [
  /あなたはどう見る[？?]?$/,
  /をどう見る[？?]?$/,
  /をどう受け止める[？?]?$/,
  // 「自分が学生なら」「私が被害者なら」等、記事固有の内容が無くても
  // どんな話題にも使い回せる空虚な仮定フック（当事者性の"見せかけ"）
  /(自分|私|あなた)が.{0,12}(なら|だったら)/u,
];

/**
 * 具体性のシグナル（数字・法案・決定・政策キーワード等 + 展開の劇的さを示す語）。
 * 「一転」「二転三転」等は政策ジャーゴンではないが、具体的な事実の展開（前後関係が検証可能）を
 * 示す語なので、短い見出しでも中身のある具体性として扱う
 */
const CONCRETE_SIGNAL =
  /\d+[%％]?|案|法|条例|可決|成立|引き上げ|引き下げ|禁止|解除|制裁|条約|協定|目標|利上げ|利下げ|再エネ|投資|補助|予算|判決|判断|無効|有効|裁定|認定|辞任|選挙|空爆|地震|震度|津波|避難|決壊|封鎖|テロ|侵攻|一転|急転|二転三転|急展開|取消し|取り消し/u;

export function isVagueIssueTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 10) return true;
  return VAGUE_TITLE_PATTERNS.some((p) => p.test(t));
}

/**
 * 一般読者向けの「自分ごと」フック（生活・お金・安全等 + 人権・政治参加・不正告発等）
 * + 「意外性・展開の劇的さ」フック（一転・急転等）。後者は生活への直接影響が無い話題でも
 * 読者の好奇心を引く正当なフック種別なので、生活・お金系の語が無いというだけでdull扱いしない
 */
export const ENGAGEMENT_HOOK =
  /波及|影響|どうなる|変わる|下が|上が|高く|安く|負担|得する|損|リスク|生活|家庭|世帯|給料|賃金|物価|電気|ガソリン|光熱|税金|増税|減税|ローン|住宅|医療|保育|子ども|学校|命|安全|治安|仕事|雇用|貿易|輸出|輸入|円|為替|食料|年金|自由|人権|差別|排斥|抗議|デモ|追及|不正|汚職|告発|解雇|逮捕|起訴|安全保障|外交|防衛|同盟|軍事|衝突|核|ミサイル|紛争|停戦|封鎖|プライバシー|表現の自由|言論|エネルギー|原油|資源|供給網|物流|インフレ|株価|金利|不況|景気|一転|急転|二転三転|急展開|まさかの|一夜|避難|警戒|災害|被害|決壊|死者|犠牲|戦争|攻撃|空爆|疑問|正当化|批判|懸念|疑い|反発|波紋|物議|対立/u;

/** 「声明、妥当？」のようにカテゴリ語だけで中身が不明なタイトル */
export function isAbstractIssueTitle(title: string): boolean {
  const t = title.trim();
  if (isVagueIssueTitle(t)) return true;
  if (/声明|発表|公式/u.test(t) && /妥当|支持|賛成|どう見る/u.test(t) && !CONCRETE_SIGNAL.test(t)) {
    return true;
  }
  if (t.length <= 20 && !CONCRETE_SIGNAL.test(t)) return true;
  return false;
}

/**
 * wire見出しだけで「だから何？」が伝わらないタイトル。
 * 具体シグナル(CONCRETE_SIGNAL)が無くても、そもそもフックが無ければdull＝
 * 「具体性もフックも無い」が「具体性はあるがフックが無い」より良い、という判定にならないよう、
 * フックの有無だけを主判定にする（旧実装はCONCRETE_SIGNALが前提条件になっており、
 * 政策ジャーゴンを含まない話題＝人物スキャンダル等がすり抜けていた）。
 */
export function isDullIssueTitle(title: string): boolean {
  const t = title.trim();
  if (isAbstractIssueTitle(t)) return true;
  return !ENGAGEMENT_HOOK.test(t);
}

export function isMonotonousQuestion(title: string): boolean {
  return MONOTONOUS_QUESTION_PATTERNS.some((p) => p.test(title.trim()));
}

export function isMostlyEnglish(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const latin = (t.match(/[a-zA-Z]/g) ?? []).length;
  const ja = (t.match(/[\u3040-\u9fff]/g) ?? []).length;
  return latin >= 8 && latin > ja;
}

function hasJapanese(text: string): boolean {
  return /[\u3040-\u9fff]/.test(text);
}

export function clampIssueTitle(title: string): string {
  const t = title.trim();
  if (t.length <= MAX_ISSUE_TITLE_LEN) return t;
  return `${t.slice(0, MAX_ISSUE_TITLE_LEN - 1)}…`;
}

function isUsableAsIs(question: string): boolean {
  const q = question.trim();
  return (
    q.length >= 10 &&
    hasJapanese(q) &&
    !isMostlyEnglish(q) &&
    !isMonotonousQuestion(q) &&
    !isDullIssueTitle(q)
  );
}

function needsTitleRefresh(input: IssueTitleInput): boolean {
  if (input.primaryExcerpts && input.primaryExcerpts.length > 0) return true;
  const q = input.question.trim();
  if (!q) return true;
  if (isDullIssueTitle(q)) return true;
  if (isMostlyEnglish(q)) return true;
  if (isMonotonousQuestion(q)) return true;
  const best = pickBestSourceTitle(input.sources);
  if (best && isMostlyEnglish(best) && !hasJapanese(q)) return true;
  return false;
}

function pickBestSourceTitle(sources: { title: string; feed: string }[]): string | null {
  if (sources.length === 0) return null;
  const officials = sources.filter((s) => PRIMARY_SOURCE_FEED.test(s.feed));
  const pool = officials.length > 0 ? officials : sources;
  return pool.reduce((best, s) => (s.title.length > best.title.length ? s : best)).title;
}

/** 日本語で具体性のある clusterTitle / question だけを同期フォールバックに使う */
function concreteTopicFallback(input: IssueTitleInput): string | null {
  for (const candidate of [input.clusterTitle, input.question]) {
    const t = candidate.trim().replace(/[？?]+$/, "");
    if (t.length >= 10 && hasJapanese(t) && !isDullIssueTitle(t) && CONCRETE_SIGNAL.test(t)) {
      return clampIssueTitle(t);
    }
  }
  return null;
}

export interface IssueTitleInput {
  question: string;
  clusterTitle: string;
  sources: { title: string; feed: string }[];
  confirmation: "OFFICIAL" | "REPORTED";
  classification?: string;
  category?: string;
  primaryExcerpts?: PrimaryExcerptForTitle[];
}

/**
 * composeIssueTitleが返す複数案から、無料の一次フィルタ(空虚な仮定フック・英語見出し)を
 * 通ったものだけをnano選抜(judgeIssueTitleQuality)に回し、最良の1つを返す。
 * isDullIssueTitleは新規の見出し選抜には使わない（regex語彙リストの繰り返しの誤検知を受けて、
 * 具体性・自然さの判定はnanoに寄せる方針。2026-07-15）。
 * 全滅（空虚フック・英語ばかり）ならnullを返し、呼び出し側のフォールバックに委ねる。
 */
export async function pickBestIssueTitle(candidates: string[]): Promise<string | null> {
  const filtered = candidates
    .map((t) => t.trim())
    .filter((t) => t.length >= 10 && hasJapanese(t) && !isMostlyEnglish(t) && !isMonotonousQuestion(t));
  if (filtered.length === 0) return null;
  if (filtered.length === 1) return clampIssueTitle(filtered[0]);
  const { best } = await judgeIssueTitleQuality(filtered);
  return clampIssueTitle(best || filtered[0]);
}

/** 争点ページタイトル。具体性不足なら null（公開見送り） */
export async function resolveIssueTitle(input: IssueTitleInput): Promise<string | null> {
  const question = input.question.trim();
  if (isUsableAsIs(question)) return clampIssueTitle(question);

  if (needsTitleRefresh(input)) {
    try {
      const candidates = await composeIssueTitle({
        clusterTitle: input.clusterTitle,
        question: input.question,
        sourceTitles: input.sources.map((s) => s.title),
        classification: input.classification ?? "report",
        category: input.category ?? "politics",
        primaryExcerpts: input.primaryExcerpts,
      });
      const picked = await pickBestIssueTitle(candidates);
      if (picked) return picked;
    } catch (e) {
      console.warn(`  ⚠️ composeIssueTitle失敗: ${e}`);
    }
  }

  return concreteTopicFallback(input);
}

/** @deprecated resolveIssueTitle を使うこと */
export function deriveIssueTitle(input: IssueTitleInput): string | null {
  const question = input.question.trim();
  if (isUsableAsIs(question)) return clampIssueTitle(question);
  return concreteTopicFallback(input);
}

// テスト互換のエクスポート（旧テンプレート系）
export function applyVariedQuestion(topic: string, _classification: string, _seed: string): string {
  return clampIssueTitle(topic);
}

export function fallbackIssueTitle(input: IssueTitleInput): string | null {
  return concreteTopicFallback(input);
}
