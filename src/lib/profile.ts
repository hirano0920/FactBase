import { AVATAR_EMOJIS, BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from "@/lib/constants";

export interface ProfileInput {
  name: string;
  bio: string;
  avatarEmoji: string | null;
}

export type ProfileValidationResult =
  | { ok: true; data: ProfileInput }
  | { ok: false; message: string };

/**
 * プロフィール編集フォームの入力を検証・正規化する純関数。
 * API route・テストの両方から使う。
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

  let avatarEmoji: string | null = null;
  if (input.avatarEmoji !== null && input.avatarEmoji !== undefined && input.avatarEmoji !== "") {
    if (typeof input.avatarEmoji !== "string" || !AVATAR_EMOJIS.includes(input.avatarEmoji as never)) {
      return { ok: false, message: "アバターは用意された絵文字から選んでください" };
    }
    avatarEmoji = input.avatarEmoji;
  }

  return { ok: true, data: { name, bio, avatarEmoji } };
}
