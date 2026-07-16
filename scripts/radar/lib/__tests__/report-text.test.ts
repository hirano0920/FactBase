import { describe, expect, it } from "vitest";
import {
  englishQueryFromUrl,
  isHardBlockedHost,
  isSubstantiveArticleText,
  isSoftBlockedText,
  looksRelevantToTitle,
} from "../report-text";

describe("report-text overseas helpers", () => {
  it("Reuters/NYT を hard-blocked と判定する", () => {
    expect(
      isHardBlockedHost(
        "https://www.reuters.com/business/energy/iran-oil-stuck-sea-surges-2026-07-10/",
      ),
    ).toBe(true);
    expect(isHardBlockedHost("https://www.nytimes.com/2026/07/11/opinion/x.html")).toBe(true);
    expect(isHardBlockedHost("https://www.bbc.com/news/articles/abc")).toBe(false);
    expect(isHardBlockedHost("https://apnews.com/article/foo")).toBe(false);
  });

  it("URLスラッグから英語検索クエリを作る", () => {
    const q = englishQueryFromUrl(
      "https://www.reuters.com/business/energy/iran-oil-stuck-sea-surges-chinas-teapots-turn-rival-middle-east-supplies-traders-2026-07-10/",
      "イラン石油が海上に滞留",
    );
    expect(q).toContain("iran oil stuck");
    expect(q).not.toMatch(/2026/);
  });

  it("ナビだらけの薄い extract を弾く", () => {
    expect(isSubstantiveArticleText("short")).toBe(false);
    const navby = Array.from({ length: 6 }, () => "Skip to main Browse Subscribe Sign in").join(" ");
    expect(isSubstantiveArticleText(navby)).toBe(false);
    const real =
      "In recent weeks, independent Chinese refiners based in the eastern oil hub of Shandong, known as teapots, have turned to rival Middle East suppliers as Iranian oil stuck at sea surged. Traders said volumes rose as Hormuz tensions continued through July.";
    expect(isSubstantiveArticleText(real.repeat(2))).toBe(true);
  });

  it("JS無効化案内・captchaページは文字数が長くても弾く（2026-07-16実データで発見した抜け穴の回帰テスト）", () => {
    // 実際にYahoo!ニュースで観測した「現在JavaScriptが無効になっています」ページが
    // サイト共通メニュー等で1254字まで水増しされ、旧・text.length<800条件をすり抜けていた。
    const padding = "メニュー項目のダミーテキストです。".repeat(60); // 800字超に水増し
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

  it("looksRelevantToTitle: 完全に無関係な本文は弾く（実測: Reuters記事の代替でFidelityの投資信託ページがヒットした事故）", () => {
    const title = "日銀の利上げ影響、49％がマイナス";
    const unrelatedFundPage =
      "AS OF 06/30/2026 More Table view Please Wait FUND: Fidelity Total Bond Fund overview and performance data.";
    expect(looksRelevantToTitle(unrelatedFundPage, title)).toBe(false);
  });

  it("looksRelevantToTitle: タイトルの語が本文に含まれていれば通す", () => {
    const title = "日銀の利上げ影響、49％がマイナス";
    const relatedText = "ロイターの企業調査によると、日銀の利上げが業績にマイナスの影響を与えると回答した企業が49％に上った。";
    expect(looksRelevantToTitle(relatedText, title)).toBe(true);
  });

  it("looksRelevantToTitle: タイトルから意味のある語が取れない場合はfail-openで通す", () => {
    expect(looksRelevantToTitle("何らかの本文", "")).toBe(true);
  });
});
