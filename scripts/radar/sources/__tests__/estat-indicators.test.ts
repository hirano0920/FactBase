import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchTopicIndicators,
  parseMonthlyTimeLabel,
  buildText,
  __INDICATORS,
} from "../estat-indicators";

const ORIGINAL_KEY = process.env.ESTAT_APP_ID;

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.ESTAT_APP_ID;
  else process.env.ESTAT_APP_ID = ORIGINAL_KEY;
});

describe("parseMonthlyTimeLabel", () => {
  it("月次コードを年月ラベルに変換", () => {
    expect(parseMonthlyTimeLabel("2026000505")).toBe("2026年5月");
    expect(parseMonthlyTimeLabel("2000000101")).toBe("2000年1月");
    expect(parseMonthlyTimeLabel("2026000606")).toBe("2026年6月");
  });
  it("不正な形式はnull", () => {
    expect(parseMonthlyTimeLabel("abc")).toBeNull();
    expect(parseMonthlyTimeLabel("")).toBeNull();
    expect(parseMonthlyTimeLabel("2026001313")).toBeNull(); // 月13は無効
  });
});

describe("buildText", () => {
  const cpi = __INDICATORS.find((i) => i.key === "cpi_all")!;
  const unemp = __INDICATORS.find((i) => i.key === "unemployment")!;
  it("前年同月比はプラス符号を明示", () => {
    expect(buildText(cpi, "1.5", "%", "2026年5月")).toBe(
      "消費者物価指数（総合）は前年同月比+1.5%（2026年5月・総務省「消費者物価指数（2020年基準）」）",
    );
  });
  it("前年同月比のマイナスはそのまま", () => {
    expect(buildText(cpi, "-0.2", "%", "2026年5月")).toContain("前年同月比-0.2%");
  });
  it("率はそのまま", () => {
    expect(buildText(unemp, "2.6", "％", "2026年5月")).toBe(
      "完全失業率は2.6％（2026年5月・総務省「労働力調査」）",
    );
  });
});

describe("fetchTopicIndicators", () => {
  it("APIキー未設定なら空（fetchも呼ばない）", async () => {
    delete process.env.ESTAT_APP_ID;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchTopicIndicators("物価高")).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("キーワード非該当なら空（fetchを呼ばない）", async () => {
    process.env.ESTAT_APP_ID = "test-key";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchTopicIndicators("キオクシア株価急落")).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("物価トピックはCPIの確定数値を逐語で返す", async () => {
    process.env.ESTAT_APP_ID = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        // cat01=0001(総合) と 0161(コア) で別の値を返す
        const isCore = url.includes("cdCat01=0161");
        return new Response(
          JSON.stringify({
            GET_STATS_DATA: {
              RESULT: { STATUS: 0 },
              STATISTICAL_DATA: {
                DATA_INF: {
                  VALUE: [
                    { "@time": "2026000404", "@unit": "%", $: "9.9" },
                    { "@time": "2026000505", "@unit": "%", $: isCore ? "1.4" : "1.5" },
                  ],
                },
              },
            },
          }),
        );
      }),
    );
    const figs = await fetchTopicIndicators("物価高で家計が悲鳴");
    // cpi_all と cpi_core の両方が発火する
    const texts = figs.map((f) => f.text);
    expect(texts).toContain(
      "消費者物価指数（総合）は前年同月比+1.5%（2026年5月・総務省「消費者物価指数（2020年基準）」）",
    );
    expect(texts.some((t) => t.includes("生鮮食品を除く総合") && t.includes("+1.4%"))).toBe(true);
    // 最新時点（2026年5月）を選んでいる（4月の9.9ではない）
    expect(texts.every((t) => !t.includes("9.9"))).toBe(true);
  });

  it("値・単位・時点が欠けた不正データは載せない（安全側）", async () => {
    process.env.ESTAT_APP_ID = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            GET_STATS_DATA: {
              RESULT: { STATUS: 0 },
              STATISTICAL_DATA: {
                DATA_INF: { VALUE: [{ "@time": "2026000505", "@unit": "", $: "" }] },
              },
            },
          }),
        ),
      ),
    );
    await expect(fetchTopicIndicators("失業率")).resolves.toEqual([]);
  });
});
