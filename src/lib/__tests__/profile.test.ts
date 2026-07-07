import { describe, expect, it } from "vitest";
import { validateProfileInput } from "@/lib/profile";

describe("validateProfileInput", () => {
  it("正常な入力を受け付ける", () => {
    const result = validateProfileInput({
      name: "経済ウォッチャー",
      bio: "財政・金融ニュースを追っています",
    });
    expect(result).toEqual({
      ok: true,
      data: {
        name: "経済ウォッチャー",
        bio: "財政・金融ニュースを追っています",
      },
    });
  });

  it("表示名が空なら拒否", () => {
    const result = validateProfileInput({ name: "  ", bio: "" });
    expect(result.ok).toBe(false);
  });

  it("表示名が上限を超えたら拒否", () => {
    const result = validateProfileInput({ name: "あ".repeat(31), bio: "" });
    expect(result.ok).toBe(false);
  });

  it("一言が上限を超えたら拒否", () => {
    const result = validateProfileInput({ name: "テスト", bio: "あ".repeat(81) });
    expect(result.ok).toBe(false);
  });

  it("前後の空白をトリムする", () => {
    const result = validateProfileInput({ name: "  太郎  ", bio: "  一言  " });
    expect(result).toEqual({
      ok: true,
      data: { name: "太郎", bio: "一言" },
    });
  });

  it("bio未指定は空文字として扱う", () => {
    const result = validateProfileInput({ name: "テスト" });
    expect(result).toEqual({
      ok: true,
      data: { name: "テスト", bio: "" },
    });
  });
});
