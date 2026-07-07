import { afterEach, describe, expect, it, vi } from "vitest";
import { searchDietSpeeches } from "../kokkai";

const RESPONSE = {
  numberOfRecords: 2,
  speechRecord: [
    {
      date: "2026-04-02",
      nameOfHouse: "衆議院",
      nameOfMeeting: "本会議",
      session: "221",
      speaker: "後藤祐一",
      speakerGroup: "中道改革連合",
      speech: "○後藤祐一君　私は、国旗損壊罪について質問いたします。",
      speechURL: "https://kokkai.ndl.go.jp/txt/AAA/1",
      meetingURL: "https://kokkai.ndl.go.jp/txt/AAA",
    },
    {
      date: "2026-04-10",
      nameOfHouse: "参議院",
      nameOfMeeting: "内閣委員会",
      session: "221",
      speaker: "山田太郎",
      speakerGroup: "None",
      speech: "○山田太郎君　国旗損壊罪の運用について伺います。",
      speechURL: "https://kokkai.ndl.go.jp/txt/BBB/2",
      meetingURL: "None",
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("searchDietSpeeches", () => {
  it("発言を新しい日付順に返し、'None'を空文字に正規化する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(RESPONSE) }),
    );
    const speeches = await searchDietSpeeches("国旗損壊罪", 5);
    expect(speeches).toHaveLength(2);
    // 4-10 が先頭（新しい順）
    expect(speeches[0].date).toBe("2026-04-10");
    expect(speeches[0].speakerGroup).toBe(""); // "None" → ""
    expect(speeches[0].url).toBe("https://kokkai.ndl.go.jp/txt/BBB/2");
  });

  it("2文字未満の語は検索せず空配列", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchDietSpeeches("あ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetch失敗時は空配列にフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await searchDietSpeeches("国旗損壊罪")).toEqual([]);
  });

  it("HTTPエラーも空配列にフォールバック", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await searchDietSpeeches("国旗損壊罪")).toEqual([]);
  });
});
