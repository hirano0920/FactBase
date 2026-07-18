import { describe, expect, it } from "vitest";
import {
  isSubstantiveArticleText,
  isSoftBlockedText,
} from "../report-text";

describe("report-text article quality", () => {
  it("ナビだらけの薄い extract を弾く", () => {
    expect(isSubstantiveArticleText("short")).toBe(false);
    const navby = Array.from({ length: 6 }, () => "Skip to main Browse Subscribe Sign in").join(" ");
    expect(isSubstantiveArticleText(navby)).toBe(false);
    const real =
      "In recent weeks, independent Chinese refiners based in the eastern oil hub of Shandong, known as teapots, have turned to rival Middle East suppliers as Iranian oil stuck at sea surged. Traders said volumes rose as Hormuz tensions continued through July.";
    expect(isSubstantiveArticleText(real.repeat(2))).toBe(true);
  });

  it("JS無効化案内・captchaページは文字数が長くても弾く（2026-07-16実データで発見した抜け穴の回帰テスト）", () => {
    const padding = "メニュー項目のダミーテキストです。".repeat(60);
    const jsDisabledPage = `現在JavaScriptが無効になっています。有効にしてご利用ください。${padding}`;
    expect(jsDisabledPage.length).toBeGreaterThan(800);
    expect(isSoftBlockedText(jsDisabledPage)).toBe(true);
    expect(isSubstantiveArticleText(jsDisabledPage)).toBe(false);
  });

  it("英語のcaptcha/bot対策ページも文字数に関わらず弾く", () => {
    const padded = "Just a moment... please wait while we verify you are human. " + "filler ".repeat(200);
    expect(padded.length).toBeGreaterThan(800);
    expect(isSoftBlockedText(padded)).toBe(true);
  });

  it("正常な記事本文はisSoftBlockedTextに引っかからない", () => {
    const real =
      "In recent weeks, independent Chinese refiners based in the eastern oil hub of Shandong, known as teapots, have turned to rival Middle East suppliers.";
    expect(isSoftBlockedText(real)).toBe(false);
  });
});
