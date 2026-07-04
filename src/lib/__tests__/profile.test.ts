import { describe, expect, it } from "vitest";
import { validateProfileInput } from "@/lib/profile";
import { AVATAR_EMOJIS } from "@/lib/constants";

describe("validateProfileInput", () => {
  it("正常な入力を受け付ける", () => {
    const result = validateProfileInput({
      name: "経済ウォッチャー",
      bio: "財政・金融ニュースを追っています",
      avatarEmoji: AVATAR_EMOJIS[0],
    });
    expect(result).toEqual({
      ok: true,
      data: {
        name: "経済ウォッチャー",
        bio: "財政・金融ニュースを追っています",
        avatarEmoji: AVATAR_EMOJIS[0],
      },
    });
  });

  it("表示名が空なら拒否", () => {
    const result = validateProfileInput({ name: "  ", bio: "", avatarEmoji: null });
    expect(result.ok).toBe(false);
  });

  it("表示名が上限を超えたら拒否", () => {
    const result = validateProfileInput({ name: "あ".repeat(31), bio: "", avatarEmoji: null });
    expect(result.ok).toBe(false);
  });

  it("一言が上限を超えたら拒否", () => {
    const result = validateProfileInput({ name: "テスト", bio: "あ".repeat(81), avatarEmoji: null });
    expect(result.ok).toBe(false);
  });

  it("前後の空白をトリムする", () => {
    const result = validateProfileInput({ name: "  太郎  ", bio: "  一言  ", avatarEmoji: null });
    expect(result).toEqual({
      ok: true,
      data: { name: "太郎", bio: "一言", avatarEmoji: null },
    });
  });

  it("許可リストにない絵文字・文字列は拒否する", () => {
    const result = validateProfileInput({ name: "テスト", bio: "", avatarEmoji: "😀" });
    expect(result.ok).toBe(false);
  });

  it("avatarEmojiがnull/undefined/空文字ならnullとして扱う", () => {
    for (const v of [null, undefined, ""]) {
      const result = validateProfileInput({ name: "テスト", bio: "", avatarEmoji: v });
      expect(result).toEqual({
        ok: true,
        data: { name: "テスト", bio: "", avatarEmoji: null },
      });
    }
  });

  it("bio未指定は空文字として扱う", () => {
    const result = validateProfileInput({ name: "テスト", avatarEmoji: null });
    expect(result).toEqual({
      ok: true,
      data: { name: "テスト", bio: "", avatarEmoji: null },
    });
  });
});
