import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchTavily } from "../tavily";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("TAVILY_API_KEY", "test-key");
});

describe("searchTavily", () => {
  it("結果からtitle/url/contentを抽出する", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ title: "見出しA", url: "https://a.example", content: "本文抜粋A" }],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTavily("テストトピック");
    expect(results).toEqual([{ title: "見出しA", url: "https://a.example", content: "本文抜粋A" }]);
  });

  it("title/urlが欠けている結果は除外する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [{ title: "", url: "https://a.example" }] }),
      }),
    );
    const results = await searchTavily("テストトピック");
    expect(results).toHaveLength(0);
  });

  it("TAVILY_API_KEY未設定時はfetchせず空配列を返す", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchTavily("テストトピック");
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTPエラー時は空配列にフォールバックする（Radar全体を止めない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const results = await searchTavily("テストトピック");
    expect(results).toEqual([]);
  });

  it("短すぎるクエリはfetchせず空配列を返す", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const results = await searchTavily("a");
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
