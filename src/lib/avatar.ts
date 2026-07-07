import { AVATAR_EMOJIS } from "@/lib/constants";

/** userIdから決定的にアバター絵文字を選ぶ（プロフィール設定なしで、常に同じ絵文字が名前の横に出る） */
export function getAvatarEmoji(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return AVATAR_EMOJIS[Math.abs(hash) % AVATAR_EMOJIS.length];
}
