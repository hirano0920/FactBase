/**
 * TopicCandidate.decision（監査用の生ログ文字列）を、管理画面で人間が一目で
 * 分類できるカテゴリに変換する。
 *
 * decisionは複数の生成元（detect.ts / promote.ts）が別々のフォーマットで書き込むため
 * "hold: hard_block:private_individual hot=55 ..." や
 * "unverified_claim:...(unsupported)" のように形がバラバラ。
 * 管理者が「これは本当にレビューが必要か」「そのうち自然に解消するものか」を
 * decisionの生文字列を読まずに判別できるよう、先頭一致ではなく部分一致で分類する。
 */

export type HeldReasonTone = "review" | "transient" | "quality" | "unknown";

export interface HeldReasonInfo {
  /** バッジに出す短い日本語ラベル */
  label: string;
  /** 表示上の重要度・色分け用 */
  tone: HeldReasonTone;
  /** 人間が能動的にレビューすべきか（falseは時間経過や設計上自然に解消しうるもの） */
  requiresHumanReview: boolean;
}

const RULES: Array<{ match: RegExp; info: HeldReasonInfo }> = [
  {
    match: /hard_block/,
    info: { label: "🔴 要人間確認（機微情報）", tone: "review", requiresHumanReview: true },
  },
  {
    match: /daily_limit|reported_daily_limit/,
    info: {
      label: "🕒 本日の公開上限到達（翌日に自然解消）",
      tone: "transient",
      requiresHumanReview: false,
    },
  },
  {
    match: /defer_buzz_pipeline/,
    info: {
      label: "↪️ バズ経路に委譲済み（保留ではない）",
      tone: "transient",
      requiresHumanReview: false,
    },
  },
  {
    match: /thin_excerpts/,
    info: { label: "🟡 報道の抜粋が薄い", tone: "quality", requiresHumanReview: true },
  },
  {
    match: /unverified_claim/,
    info: { label: "🟠 主張の裏取り不可", tone: "quality", requiresHumanReview: true },
  },
  {
    // 2026-07-16: 事実の裏取り失敗ではなく、文章の書き方・構成（箇条書きが薄い等）の要件不足。
    // unverified_claimと同じdecisionプレフィックスに混ざっていたため分離した。
    match: /style_gate/,
    info: { label: "🟡 文章の構成・書き方が基準未達", tone: "quality", requiresHumanReview: true },
  },
  {
    match: /quality_gate/,
    info: { label: "🟠 品質基準未達（両論性・深さ等）", tone: "quality", requiresHumanReview: true },
  },
  {
    match: /banned_phrase/,
    info: { label: "🟣 断定的な表現を検出", tone: "quality", requiresHumanReview: true },
  },
];

export function describeHeldReason(decision: string | null | undefined): HeldReasonInfo {
  const text = decision ?? "";
  for (const rule of RULES) {
    if (rule.match.test(text)) return rule.info;
  }
  return { label: "❔ 理由不明（要確認）", tone: "unknown", requiresHumanReview: true };
}
