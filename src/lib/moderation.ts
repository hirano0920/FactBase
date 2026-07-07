/**
 * 送信時NGフィルタ（AI不要・¥0）
 * 政治系の誹謗中傷・差別・暴力表現をブロック
 */
import { COMMENT_LIMITS } from "@/lib/constants";

export type ModerationResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: string };

const BLOCK_PATTERNS: { pattern: RegExp; code: string; reason: string }[] = [
  { pattern: /死ね|殺せ|消えろ/u, code: "ABUSE", reason: "暴力的な表現は投稿できません" },
  { pattern: /(馬鹿|バカ|アホ|クズ|ゴミ)(野郎|ども|共)/u, code: "INSULT", reason: "侮辱的な表現は投稿できません" },
];

// URLの出現回数上限（空白区切りの連投も検知するため出現回数でカウント）
const MAX_URLS = 2;

const BLOCK_WORDS = [
  // 実運用ではカテゴリ別に拡張
  "氏ね",
];

/** 文字数制約なしのNGワード・パターン検査。コメント本文・プロフィールの一言など複数箇所から使う。 */
export function containsNgContent(trimmed: string): ModerationResult {
  const urlCount = (trimmed.match(/https?:\/\//g) ?? []).length;
  if (urlCount > MAX_URLS) {
    return { allowed: false, code: "SPAM", reason: "リンクの過剰な投稿はできません" };
  }

  for (const word of BLOCK_WORDS) {
    if (trimmed.includes(word)) {
      return { allowed: false, code: "NG_WORD", reason: "不適切な表現が含まれています" };
    }
  }

  for (const { pattern, code, reason } of BLOCK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, code, reason };
    }
  }

  return { allowed: true };
}

/**
 * minLength/maxLengthは省略時トップレベルコメントの制限（COMMENT_LIMITS）を使う。
 * 返信（1階層のみ）はより短く気軽に投稿できるよう、呼び出し側からREPLY_LIMITSを渡す。
 */
export function moderateOnSubmit(
  body: string,
  limits: { minLength: number; maxLength: number } = COMMENT_LIMITS,
): ModerationResult {
  const trimmed = body.trim();

  if (trimmed.length < limits.minLength) {
    return { allowed: false, code: "TOO_SHORT", reason: `${limits.minLength}字以上で投稿してください` };
  }
  if (trimmed.length > limits.maxLength) {
    return { allowed: false, code: "TOO_LONG", reason: `${limits.maxLength}字以内で投稿してください` };
  }

  return containsNgContent(trimmed);
}

export function detectDuplicateBodies(bodies: string[], threshold = 0.9): boolean {
  if (bodies.length < 2) return false;
  const normalized = bodies.map((b) => b.trim().toLowerCase());
  const latest = normalized[normalized.length - 1];
  const duplicates = normalized.slice(0, -1).filter((b) => b === latest);
  return duplicates.length >= 4;
}
