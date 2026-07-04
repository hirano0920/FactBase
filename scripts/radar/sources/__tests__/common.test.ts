import { describe, expect, it } from "vitest";
import { parseJapaneseDate, isWithinDays } from "../common";

describe("parseJapaneseDate", () => {
  it("令和の和暦を変換する", () => {
    const d = parseJapaneseDate("令和8年6月29日");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5); // 0-indexed = 6月
    expect(d?.getDate()).toBe(29);
  });

  it("平成の和暦（半角スペース区切り）を変換する", () => {
    const d = parseJapaneseDate("平成10年 3月 4日");
    expect(d?.getFullYear()).toBe(1998);
    expect(d?.getMonth()).toBe(2);
    expect(d?.getDate()).toBe(4);
  });

  it("元年を1年として扱う", () => {
    const d = parseJapaneseDate("令和元年5月1日");
    expect(d?.getFullYear()).toBe(2019);
  });

  it("ISO形式(YYYY-MM-DD)を変換する", () => {
    const d = parseJapaneseDate("2001-09-28");
    expect(d?.getFullYear()).toBe(2001);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(28);
  });

  it("空文字・解析不能な文字列はnull", () => {
    expect(parseJapaneseDate("")).toBeNull();
    expect(parseJapaneseDate("／")).toBeNull();
    expect(parseJapaneseDate("可決")).toBeNull();
  });
});

describe("isWithinDays", () => {
  it("直近の日付はtrue", () => {
    expect(isWithinDays(new Date(), 30)).toBe(true);
  });

  it("範囲外の古い日付はfalse", () => {
    const old = new Date(Date.now() - 100 * 86400_000);
    expect(isWithinDays(old, 30)).toBe(false);
  });
});
