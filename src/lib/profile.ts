import { AVATAR_EMOJIS, BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from "@/lib/constants";

export interface ProfileInput {
  name: string;
  bio: string;
}

export type ProfileValidationResult =
  | { ok: true; data: ProfileInput }
  | { ok: false; message: string };

/**
 * プロフィール編集フォームの入力を検証・正規化する純関数。
 */
export function validateProfileInput(input: Record<string, unknown>): ProfileValidationResult {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length === 0) {
    return { ok: false, message: "表示名を入力してください" };
  }
  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return { ok: false, message: `表示名は${DISPLAY_NAME_MAX_LENGTH}字以内で入力してください` };
  }

  const bio = typeof input.bio === "string" ? input.bio.trim() : "";
  if (bio.length > BIO_MAX_LENGTH) {
    return { ok: false, message: `一言は${BIO_MAX_LENGTH}字以内で入力してください` };
  }

  return { ok: true, data: { name, bio } };
}

/** @deprecated アバター機能廃止。後方互換のため残す */
export const DEPRECATED_AVATAR_EMOJIS = AVATAR_EMOJIS;
