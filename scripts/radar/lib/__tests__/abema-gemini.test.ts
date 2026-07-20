import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
  Type: {
    OBJECT: "OBJECT",
    STRING: "STRING",
    ARRAY: "ARRAY",
  },
}));

import { analyzeAbemaVideo } from "../abema-gemini";

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
});

describe("analyzeAbemaVideo", () => {
  it("APIキー未設定ならnull（API呼び出しなし）", async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await analyzeAbemaVideo("vid1", "タイトル");
    expect(result).toBeNull();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("有効なdebateレスポンスをそのまま返す", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        track: "debate",
        lead: "要約",
        axis: "対立軸",
        forLabel: "賛成派",
        forBullets: ["Aさんは賛成と主張"],
        againstLabel: "反対派",
        againstBullets: ["Bさんは反対と主張"],
        keyPoints: [],
      }),
    });
    const result = await analyzeAbemaVideo("vid1", "タイトル");
    expect(result?.track).toBe("debate");
    expect(result?.forBullets).toEqual(["Aさんは賛成と主張"]);
  });

  it("スキーマ不一致(必須フィールド欠落)ならnull", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ track: "debate", lead: "要約" }),
    });
    const result = await analyzeAbemaVideo("vid1", "タイトル");
    expect(result).toBeNull();
  });

  it("不正なtrack値ならnull", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        track: "maybe",
        lead: "要約",
        axis: null,
        forLabel: null,
        forBullets: [],
        againstLabel: null,
        againstBullets: [],
        keyPoints: [],
      }),
    });
    const result = await analyzeAbemaVideo("vid1", "タイトル");
    expect(result).toBeNull();
  });

  it("API呼び出し失敗時はnull（例外を投げない）", async () => {
    mocks.generateContent.mockRejectedValue(new Error("network error"));
    const result = await analyzeAbemaVideo("vid1", "タイトル");
    expect(result).toBeNull();
  });

  it("YouTube URLをfileDataとして正しく渡す", async () => {
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({
        track: "news",
        lead: "要約",
        axis: null,
        forLabel: null,
        forBullets: [],
        againstLabel: null,
        againstBullets: [],
        keyPoints: ["ポイント1"],
      }),
    });
    await analyzeAbemaVideo("abc123", "タイトル");
    const callArgs = mocks.generateContent.mock.calls[0][0];
    expect(callArgs.contents[0].parts[0].fileData.fileUri).toBe(
      "https://www.youtube.com/watch?v=abc123",
    );
  });
});
