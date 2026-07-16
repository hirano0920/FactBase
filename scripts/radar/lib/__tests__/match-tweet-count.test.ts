import { describe, expect, it } from "vitest";
import { matchYahooTweetCount } from "../match-tweet-count";

const yahoo = [
  { term: "クレカ障害", tweetCount: 2809 },
  { term: "シンデレラガール総選挙2026", tweetCount: 16 },
];

describe("matchYahooTweetCount", () => {
  it("具体トピックには突合する", () => {
    expect(matchYahooTweetCount("モバイルSuica等の決済障害と企業対応", yahoo)).toBe(2809);
    expect(matchYahooTweetCount("クレジットカード障害が続く", yahoo)).toBe(2809);
  });

  it("「決済」だけで無関係トピックに数字を付けない", () => {
    expect(matchYahooTweetCount("決済代行会社全東信の破産（負債1151億円）", yahoo)).toBeUndefined();
    expect(matchYahooTweetCount("決済代行業者破綻による連鎖倒産リスク", yahoo)).toBeUndefined();
  });

  it("無関係トピックは undefined", () => {
    expect(matchYahooTweetCount("JTの加熱式たばこ値上げ", yahoo)).toBeUndefined();
  });
});
