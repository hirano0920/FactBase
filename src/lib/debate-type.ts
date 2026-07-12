/**
 * TwoSides 争点タイプ（promote 本線）。
 * 軸が立つ型だけ記事化・スプリットする。速報未確定・SEOまとめは対象外。
 *
 * 1 declaration / 2 policy(+reignite) / 3 org_response / 4 norm_flare /
 * 5 indicator / 6 geopolitics
 */
import { looksLikeDeclarationConflict } from "./radar";

export const DEBATE_TYPES = [
  "declaration",
  "policy",
  "org_response",
  "norm_flare",
  "indicator",
  "geopolitics",
] as const;

export type DebateType = (typeof DEBATE_TYPES)[number];

/** promote 本線に載せる型（これ以外は記事化しない） */
export const PROMOTABLE_DEBATE_TYPES: ReadonlySet<DebateType> = new Set(DEBATE_TYPES);

const DEBATE_TYPE_SET = new Set<string>(DEBATE_TYPES);

export function isDebateType(value: unknown): value is DebateType {
  return typeof value === "string" && DEBATE_TYPE_SET.has(value);
}

export function parseDebateType(value: unknown): DebateType | null {
  return isDebateType(value) ? value : null;
}

export function isPromotableDebateType(value: unknown): value is DebateType {
  return isDebateType(value) && PROMOTABLE_DEBATE_TYPES.has(value);
}

const INDICATOR_HINT =
  /金利|物価|インフレ|デフレ|為替|円高|円安|GDP|日銀|政策金利|失業率|賃金統計|世論調査|支持率|株価|指数/i;

const ORG_RESPONSE_HINT =
  /謝罪|処分|懲戒|値上げ|改悪|対応|不祥事|リコール|サービス停止|規約変更|返金|補償|会見|社長辞任|会長辞任|更迭/i;

const GEOPOLITICS_HINT =
  /停戦|制裁|関税|侵攻|ミサイル|台湾|安保|NATO|国連安保理|外交|米中|ロシア|ウクライナ|イスラエル|ガザ/i;

/** 法案・制度の賛否争点。反対「声明」が付いても declaration に落とさない */
const POLICY_BILL_HINT =
  /法案|改正案|新設罪|条例案|条約批准|予算案|減税|増税|規制強化|規制緩和|制度改正|損壊罪|毀損罪/i;

function debateTypeBlob(input: InferDebateTypeInput): string {
  return [input.topic, input.title, input.voteQuestion, ...(input.newsTitles ?? [])]
    .filter(Boolean)
    .join("\n");
}

function looksLikePolicyBill(input: InferDebateTypeInput): boolean {
  return POLICY_BILL_HINT.test(debateTypeBlob(input));
}

export interface InferDebateTypeInput {
  topic: string;
  category?: string | null;
  title?: string | null;
  voteQuestion?: string | null;
  newsTitles?: string[];
  /** 継続的に話題 → policy の再燃フラグ候補 */
  sustained?: boolean;
}

export interface ResolvedDebateType {
  debateType: DebateType;
  /** policy のスローバーン再燃（型10）。記事はきっかけ先頭＋定番両論 */
  reignite: boolean;
}

/**
 * AI が付けた debateType を優先し、欠落・不正時は機械推定。
 * 推定不能なら null（promote 対象外）。
 */
export function resolveDebateType(
  input: InferDebateTypeInput & { debateType?: unknown; reignite?: unknown },
): ResolvedDebateType | null {
  const parsed = parseDebateType(input.debateType);
  if (parsed) {
    // 法案賛否を「反対声明」キーワードで declaration に誤分類しやすい → policy に矯正
    const debateType =
      parsed === "declaration" && looksLikePolicyBill(input) ? "policy" : parsed;
    return {
      debateType,
      reignite: debateType === "policy" && (input.reignite === true || input.sustained === true),
    };
  }
  const inferred = inferDebateType(input);
  if (!inferred) return null;
  return {
    debateType: inferred,
    reignite: inferred === "policy" && input.sustained === true,
  };
}

/**
 * 旧 PENDING・法案・引き取り用の機械推定。
 * 迷う速報・薄い話題は null（出さない）。
 */
export function inferDebateType(input: InferDebateTypeInput): DebateType | null {
  const blob = debateTypeBlob(input);
  const category = (input.category ?? "").toLowerCase();

  if (category === "international" || GEOPOLITICS_HINT.test(blob)) return "geopolitics";
  if (category === "finance" || INDICATOR_HINT.test(blob)) return "indicator";
  // org_response を declaration より先に（謝罪・処分は両方にヒットしうる）
  if (ORG_RESPONSE_HINT.test(blob)) return "org_response";
  // 法案賛否を「反対声明」で declaration に落とさない（policy を声明対立より先に）
  if (POLICY_BILL_HINT.test(blob) || /改正|予算|規制|制度|国会|選挙/i.test(blob)) {
    return "policy";
  }
  if (looksLikeDeclarationConflict(blob) || category === "entertainment") return "declaration";
  if (category === "society") return "norm_flare";
  if (
    category === "politics" ||
    category === "law" ||
    category === "economy" ||
    category === "rights" ||
    category === "education"
  ) {
    return "policy";
  }
  if (/炎上|ハラスメント|差別|キャンセル|マナー|切り抜き/i.test(blob)) return "norm_flare";
  return null;
}

/** promote 順位ボーナス（eligible 内のみ） */
export function debateTypePromoteBonus(debateType: DebateType | null | undefined): number {
  switch (debateType) {
    case "declaration":
      return 2.5;
    case "org_response":
    case "norm_flare":
      return 1.0;
    case "policy":
    case "indicator":
    case "geopolitics":
      return 0.25;
    default:
      return 0;
  }
}

/**
 * この争点タイプの両側見出しに、賛成/反対のような実質的な極性（賛否の強さ）があるか。
 * declaration（声明対立）・geopolitics（陣営）は「賛成/反対の無理当て禁止」と明記した通り
 * 当事者名・陣営名の並置に過ぎず極性を持たない。それ以外は「賛成/支持/擁護」対「反対/批判/問題視」の
 * 実質的な二極対立として書かせているため極性ありとする。
 * UIで両側を色分けする際、極性が無いのに賛成=緑/反対=赤の色を使うと「どちらが優勢/正しいか」を
 * 誤って示唆してしまうため、この判定で色を出し分ける。
 */
export function debateTypeHasPolarity(debateType: DebateType | null | undefined): boolean {
  if (!debateType) return true;
  return debateType !== "declaration" && debateType !== "geopolitics";
}

/** 記事 HTML の両側見出し・書き方ヒント（Writer プロンプト注入用） */
export function debateTypeArticleHint(debateType: DebateType, reignite = false): string {
  const reigniteLine = reignite
    ? "\n再燃フラグあり: 先頭で「今回何が火をつけたか」を短く書き、定番の賛否は再提示。毎回フル百科にしない。"
    : "";

  switch (debateType) {
    case "declaration":
      return `争点タイプ: declaration（声明対立）
両側見出しは当事者名（例:「週刊文春・報道側」「佐藤二朗さん側」）。賛成/反対の無理当て禁止。
「いま何が論点か」必須スロット（空欄・抽象文禁止）:
  ① [報道の行為・発言の要約] ← 何をした／何と言ったと報じたかを具体語で。否定の前に置く
  ② [時期・場面]
  ③ [否定・反応と対立軸]
両側セクションは事実の再掲禁止。各側の主張・反論・論点だけ。
きれいに対称でなくてもよい（実争点は非対称が多い）。`;
    case "policy":
      return `争点タイプ: policy（政策・法案賛否）${reigniteLine}
両側見出し:「賛成側が言うこと」「反対側が言うこと」。
何が決まろうとしているかを1画面で。本体は賛否の最強論各3〜4（資料の発言・報道点から。一般論埋め禁止）。
賛成側には賛同論だけ、反対側には反対・批判・慎重論だけ。同一見出しに賛否を混ぜない（「支持・慎重派」禁止）。`;
    case "org_response":
      return `争点タイプ: org_response（企業・組織の対応是非）
両側見出し:「対応を支持する側」「問題だとする側」（または会社名/批判側の当事者名）。
何が起きた→公式が言ったこと→批判側の代表論点に束ねる（匿名炎上の羅列禁止）→まだ分からないこと。`;
    case "norm_flare":
      return `争点タイプ: norm_flare（社会炎上・規範）
最重要:「何が争われているか」を規範の軸1本に固定してから両側を書く。
両側見出し:「擁護側が言うこと」「批判側が言うこと」（または具体規範ラベル）。
声明が無いので A声明/B声明形式は作らない。切り抜き真偽が曖昧なら「まだ分からないこと」を厚めに。`;
    case "indicator":
      return `争点タイプ: indicator（数値・指標の解釈）
数字は公式どおり短く。百科的な「○○とは」禁止。
本体は解釈の対立（この判断・水準を支持 / 不適切・別対応を求める）。
両側見出し:「支持する側が言うこと」「問題視する側が言うこと」。`;
    case "geopolitics":
      return `争点タイプ: geopolitics（国際・陣営）${reigniteLine}
実在する陣営・立場名で対になる2側に圧縮（例:「停戦を急ぐ側」「軍事圧力を優先する側」）。
冒頭は直近で新たに報じられたことだけ。数ヶ月の経緯は「これまでの流れ」に分離。
真偽が揺れる速報は断定せず帰属表現にし、「まだ分からないこと」へ逃がす。
国内主なら日本にとっての論点は薄く。`;
  }
}

/**
 * 争点一覧タイトル（composeIssueTitle、いわゆるshareTitle）の「自分ごとフック」の種類を
 * debateTypeに合わせて変える。従来は生活・電気代・物価等の家計フック例しか無く、
 * 声明対立・社会炎上のような「好奇心・社会的関心」で読ませるべき話題に合わなかった
 * （経済フックを無理に当てはめると不自然なタイトルになる）。
 */
export function debateTypeTitleHint(debateType: DebateType): string {
  switch (debateType) {
    case "declaration":
      return "フックは家計ではなく好奇心・展開への関心（「なぜ」「この後どうなる」「〇〇の言い分」等）。誰が何を言っているかを具体的に。";
    case "org_response":
      return "フックは「自分も同じ立場なら」（消費者・利用者・従業員として関係あるか）。企業名・対応内容を具体的に。";
    case "norm_flare":
      return "フックは好奇心・社会的な賛否への関心（「なぜ炎上」「賛否の理由」等）。規範の対立軸を具体的に。";
    case "indicator":
    case "policy":
      return "フックは生活・家計への影響（電気代・物価・税金・ローン・給料等）。数値・政策名を具体的に。";
    case "geopolitics":
      return "フックは安全・生活への波及（貿易・エネルギー・為替・安全保障等）。何が起きたかを具体的に。";
  }
}

/**
 * 投票ボタン（for/against）の主体が記事本文の両側見出しと揃うようにするヒント。
 * debateTypeArticleHintは記事本文用（見出し文の完全な指定）、こちらは投票設問生成プロンプトに
 * 埋め込む短い1行ヒント。両者が別々のAI呼び出しで生成されても表現がズレないようにする。
 */
export function debateTypeChoiceHint(debateType: DebateType): string {
  switch (debateType) {
    case "declaration":
      return "for/againstは当事者の名前・呼称（例:「事務所側」「本人側」）。賛成/反対の無理当て禁止。";
    case "policy":
      return "for/againstは「法案に賛成」「法案に反対」など賛否だけの短いラベル。人物名・団体名（「○○氏賛成」「○○会反対」）は禁止。";
    case "org_response":
      return "for/againstは「対応を支持」「問題視」を軸にした短い立場ラベル。";
    case "norm_flare":
      return "for/againstは「擁護」「批判」を軸にした短い立場ラベル。";
    case "indicator":
      return "for/againstは「妥当」「不適切」等、数値・判断への評価軸の短いラベル。";
    case "geopolitics":
      return "for/againstは実在する陣営・立場名（例:「停戦優先」「圧力継続」）の短いラベル。";
  }
}

/** bullets 指示を型に合わせる。メタ立場（「虚偽」「事実」だけ）は禁止し、具体内容を必須にする */
export function debateTypeBulletsSpec(debateType: DebateType, isReported: boolean): string {
  const density =
    "各項目はスキャンしやすく。1項目目（事実）は80〜120字。" +
    "2・3項目目は『芯の一文（40〜60字）。根拠の一文（40〜70字）。』の2文構成を基本にする。" +
    "「虚偽だ／事実だ」「支持／反対」だけのメタ表現禁止。何についてそう主張するかを具体的に。" +
    "両側がきれいに対称でなくてもよい。";

  if (!isReported) {
    return `articleHtmlの「いま分かっていること」と同じ3観点語で、各項目に具体内容。${density}`;
  }
  switch (debateType) {
    case "declaration":
      return `["報道の内容: …（何をした／何と言ったと報じたか。否定は書かない）", "A側（当事者名）: 芯の一文。根拠の一文。", "B側（当事者名）: 芯の一文。根拠の一文。"]。${density}`;
    case "org_response":
      return `["いま分かっていること: …（何が起き、組織が何をしたか）", "対応を支持する側: 芯。根拠。", "問題だとする側: 芯。根拠。"]。${density}`;
    case "norm_flare":
      return `["争点の軸: …（何の規範・行為が問題になっているか具体的に）", "擁護側: 芯。根拠。", "批判側: 芯。根拠。"]。${density}`;
    case "indicator":
      return `["公式の数字・判断: …（数値をそのまま）", "支持する側: 芯。根拠。", "問題視する側: 芯。根拠。"]。${density}`;
    case "geopolitics":
      return `["いま分かっていること: …（直近で何が起きたか1〜2文）", "陣営A（実名）: 芯の一文（何をしたいか）。根拠の一文。", "陣営B（実名）: 芯の一文。根拠の一文。"]。${density} 読者がVSで一瞬で対立が分かる短さに。`;
    case "policy":
    default:
      return `["いま分かっていること: …（何が決まろうとしているか）", "賛成側が言うこと: 芯。根拠。", "反対側が言うこと: 芯。根拠。"]。${density} 各側は賛否を混ぜない。「支持・慎重派」等の混在ラベル禁止。慎重・批判は反対側へ。`;
  }
}
