import { afterEach, describe, expect, it, vi } from "vitest";
import { searchLaws, buildLawSearchTerms } from "../egov-law";

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

  it("政策語（元語で0件）でも語尾を剥がした核語＋『法』で法令にたどり着く", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const parsed = new URL(url);
      const titleQuery = parsed.searchParams.get("law_title");
      if (titleQuery === "消費税減税") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ laws: [] }) });
      }
      if (titleQuery === "消費税法") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(RESPONSE_CONSUMPTION_TAX) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ laws: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const laws = await searchLaws("消費税減税", 3);
    expect(laws.map((l) => l.lawTitle)).toContain("消費税法");
  });
});

const RESPONSE_CONSUMPTION_TAX = {
  laws: [
    {
      law_info: { law_id: "163AC0000000108", law_num: "昭和六十三年法律第百八号", promulgation_date: "1988-12-30" },
      revision_info: { law_title: "消費税法", category: "税", repeal_status: "None" },
    },
  ],
};

describe("buildLawSearchTerms", () => {
  it("政策動詞・語尾を剥がした核語と『法』付き候補を生成する", () => {
    const terms = buildLawSearchTerms("消費税減税");
    expect(terms).toContain("消費税減税");
    expect(terms).toContain("消費税");
    expect(terms).toContain("消費税法");
  });

  it("既に語尾が無い語はそのまま1候補（重複させない）", () => {
    expect(buildLawSearchTerms("刑法")).toEqual(["刑法"]);
  });

  it("同義語辞書に一致すれば実際の法令名も候補に含める", () => {
    expect(buildLawSearchTerms("選択的夫婦別姓")).toContain("民法");
  });

  it("空文字・短すぎる語は空配列", () => {
    expect(buildLawSearchTerms("")).toEqual([]);
  });
});
