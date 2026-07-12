import { describe, expect, it } from "vitest";
import { parseTimelineItem } from "@/lib/article-sections";

describe("parseTimelineItem", () => {
  it("M月D日: を日付と本文に分ける", () => {
    expect(parseTimelineItem("7月12日: イランが封鎖を宣言したと報じられた")).toEqual({
      date: "7月12日",
      body: "イランが封鎖を宣言したと報じられた",
    });
  });

  it("YYYY年M月D日: を扱う", () => {
    expect(parseTimelineItem("2026年6月1日：停戦交渉が再開")).toEqual({
      date: "2026年6月1日",
      body: "停戦交渉が再開",
    });
  });

  it("日付が無い行はそのまま本文", () => {
    expect(parseTimelineItem("経緯の補足説明")).toEqual({
      date: null,
      body: "経緯の補足説明",
    });
  });
});
