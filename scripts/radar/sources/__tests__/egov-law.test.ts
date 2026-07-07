import { afterEach, describe, expect, it, vi } from "vitest";
import { searchLaws } from "../egov-law";

const RESPONSE = {
  total_count: 1,
  laws: [
    {
      law_info: { law_id: "140AC0000000045", law_num: "明治四十年法律第四十五号", promulgation_date: "1907-04-24" },
      revision_info: { law_title: "刑法", category: "刑事", repeal_status: "None" },
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("searchLaws", () => {
  it("法令名・法令番号・e-Gov URLを組み立てて返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(RESPONSE) }),
    );
    const laws = await searchLaws("刑法", 3);
    expect(laws).toHaveLength(1);
    expect(laws[0].lawTitle).toBe("刑法");
    expect(laws[0].lawNum).toBe("明治四十年法律第四十五号");
    expect(laws[0].url).toBe("https://laws.e-gov.go.jp/law/140AC0000000045");
    expect(laws[0].lawId).toBe("140AC0000000045");
    expect(laws[0].articleSnippets).toEqual([]);
  });

  it("2文字未満の語は検索せず空配列", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchLaws("A")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch失敗時は空配列にフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await searchLaws("刑法")).toEqual([]);
  });

  it("HTTPエラーも空配列にフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await searchLaws("刑法")).toEqual([]);
  });
});
