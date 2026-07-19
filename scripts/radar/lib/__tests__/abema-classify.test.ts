import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("../../../../src/lib/openai-client", () => ({
  createOpenAIClient: () => ({
    chat: { completions: { create: mocks.create } },
  }),
}));

import { classifyAbemaVideo } from "../abema-classify";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classifyAbemaVideo", () => {
  it("有効なtrackをそのまま返す", async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ track: "debate", reason: "賛否あり" }) } }],
    });
    const track = await classifyAbemaVideo("タイトル", "概要");
    expect(track).toBe("debate");
  });

  it("不正なJSONはexcludeにフォールバック", async () => {
    mocks.create.mockResolvedValue({ choices: [{ message: { content: "not json" } }] });
    const track = await classifyAbemaVideo("タイトル", "概要");
    expect(track).toBe("exclude");
  });

  it("不正なtrack値はexcludeにフォールバック", async () => {
    mocks.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ track: "maybe", reason: "" }) } }],
    });
    const track = await classifyAbemaVideo("タイトル", "概要");
    expect(track).toBe("exclude");
  });

  it("API呼び出し失敗時はexcludeにフォールバック", async () => {
    mocks.create.mockRejectedValue(new Error("timeout"));
    const track = await classifyAbemaVideo("タイトル", "概要");
    expect(track).toBe("exclude");
  });
});
