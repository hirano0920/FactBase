/**
 * detect.ts が Issue.title に使う文字列を決める。
 * 争点一覧の見出し＝一般読者が「自分ごと」と感じる具体タイトル（日本語）。
 * 抽象設問（「EU声明、妥当？」）や英語見出しそのままは禁止。
 */
import { composeIssueTitle, type PrimaryExcerptForTitle } from "../../../src/lib/ai";
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
];

/** 具体性のシグナル（数字・法案・決定・政策キーワード等） */
const CONCRETE_SIGNAL =
  /\d+[%％]?|案|法|条例|可決|成立|引き上げ|引き下げ|禁止|解除|制裁|条約|協定|目標|利上げ|利下げ|再エネ|投資|補助|予算|判決|辞任|選挙|空爆|地震|震度|津波|避難|テロ|侵攻/u;

export function isVagueIssueTitle(title: string): boolean {
  const t = title.trim();
  if (t.length < 10) return true;
  return VAGUE_TITLE_PATTERNS.some((p) => p.test(t));
}

/** 一般読者向けの「自分ごと」フック（生活・お金・安全等） */
export const ENGAGEMENT_HOOK =
  /波及|影響|どうなる|変わる|下が|上が|高く|安く|負担|得する|損|リスク|生活|家庭|世帯|給料|賃金|物価|電気|ガソリン|光熱|税金|ローン|住宅|医療|保育|子ども|学校|命|安全|治安|仕事|雇用|貿易|輸出|輸入|円|為替|食料|年金/u;

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

/** wire見出しだけで「だから何？」が伝わらないタイトル */
export function isDullIssueTitle(title: string): boolean {
  const t = title.trim();
  if (isAbstractIssueTitle(t)) return true;
  if (CONCRETE_SIGNAL.test(t) && !ENGAGEMENT_HOOK.test(t)) return true;
  return false;
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

/** 争点ページタイトル。具体性不足なら null（公開見送り） */
export async function resolveIssueTitle(input: IssueTitleInput): Promise<string | null> {
  const question = input.question.trim();
  if (isUsableAsIs(question)) return clampIssueTitle(question);

  if (needsTitleRefresh(input)) {
    try {
      const composed = await composeIssueTitle({
        clusterTitle: input.clusterTitle,
        question: input.question,
        sourceTitles: input.sources.map((s) => s.title),
        classification: input.classification ?? "report",
        category: input.category ?? "politics",
        primaryExcerpts: input.primaryExcerpts,
      });
      if (composed.length >= 10 && hasJapanese(composed) && !isDullIssueTitle(composed)) {
        return clampIssueTitle(composed);
      }
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
