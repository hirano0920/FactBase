import { describe, expect, it } from "vitest";
import { resolveEnrichSearchTerm } from "../enrich-search-term";

describe("resolveEnrichSearchTerm", () => {
  it("topicTerm を優先する", () => {
    expect(
      resolveEnrichSearchTerm({ topicTerm: "国旗損壊罪", title: "長い見出しタイトル" }, "fallback"),
    ).toBe("国旗損壊罪");
  });

  it("topicTerm が無ければ candidate.title → fallback の順", () => {
    expect(resolveEnrichSearchTerm({ title: "入管法改正" }, "RSSクラスタタイトル")).toBe("入管法改正");
    expect(resolveEnrichSearchTerm(null, "RSSクラスタタイトル")).toBe("RSSクラスタタイトル");
  });
});
