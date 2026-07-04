import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/openai-client", () => ({
  createOpenAIClient: () => ({
    chat: { completions: { create: mocks.create } },
  }),
}));

import { factCheck, judgeModeration, judgeIssueQuality, classifyHeadlines } from "@/lib/ai";

function mockContent(content: string) {
  mocks.create.mockResolvedValueOnce({ choices: [{ message: { content } }] });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("factCheck", () => {
  const chunks = [{ id: "c1", sourceName: "テスト法", articleRef: "第1条", text: "本文" }];

  it("正常なJSON応答をverdict/sourceIdsに反映する", async () => {
    mockContent(JSON.stringify({ v: "TRUE", l: "一次情報で確認", r: "条文に明記", s: ["c1"] }));
    const result = await factCheck("主張", chunks);
    expect(result.verdict).toBe("TRUE");
    expect(result.sourceIds).toEqual(["c1"]);
  });

  it("実在しないchunk IDはフィルタされる", async () => {
    mockContent(JSON.stringify({ v: "TRUE", l: "確認", r: "理由", s: ["c1", "ghost"] }));
    const result = await factCheck("主張", chunks);
    expect(result.sourceIds).toEqual(["c1"]);
  });

  it("禁止断定表現が理由文に混入したらUNKNOWNに落とす", async () => {
    mockContent(JSON.stringify({ v: "FALSE", l: "違反", r: "有罪だと断定できる", s: ["c1"] }));
    const result = await factCheck("主張", chunks);
    expect(result.verdict).toBe("UNKNOWN");
  });

  it("不正なJSONが返っても例外を投げずUNKNOWNにフォールバックする", async () => {
    mockContent("これはJSONではありません");
    const result = await factCheck("主張", chunks);
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.sourceIds).toEqual([]);
  });

  it("スキーマに合わない型（sがオブジェクト）でも例外を投げない", async () => {
    mockContent(JSON.stringify({ v: "TRUE", s: { not: "an array" } }));
    const result = await factCheck("主張", chunks);
    expect(result.verdict).toBe("UNKNOWN");
    expect(result.sourceIds).toEqual([]);
  });
});

describe("judgeModeration", () => {
  it("正常なJSON応答を反映する", async () => {
    mockContent(JSON.stringify({ violation: true, category: "abuse", confidence: 0.95, reason: "侮辱表現" }));
    const result = await judgeModeration("コメント本文", ["不快"]);
    expect(result.violation).toBe(true);
    expect(result.category).toBe("abuse");
    expect(result.confidence).toBe(0.95);
  });

  it("confidenceが範囲外でも0-1にクランプする", async () => {
    mockContent(JSON.stringify({ violation: false, confidence: 5 }));
    const result = await judgeModeration("コメント本文", []);
    expect(result.confidence).toBe(1);
  });

  it("不正なJSONが返っても例外を投げず非違反にフォールバックする", async () => {
    mockContent("not json");
    const result = await judgeModeration("コメント本文", []);
    expect(result.violation).toBe(false);
    expect(result.category).toBe("none");
  });
});

describe("judgeIssueQuality", () => {
  it("正常なJSON応答を反映する", async () => {
    mockContent(JSON.stringify({ credible: true, confidence: 0.9, reason: "内容が矛盾" }));
    const result = await judgeIssueQuality("要約", ["おかしい"]);
    expect(result.credible).toBe(true);
    expect(result.confidence).toBe(0.9);
  });

  it("不正なJSONが返っても例外を投げずcredible=falseにフォールバックする", async () => {
    mockContent("{{invalid");
    const result = await judgeIssueQuality("要約", []);
    expect(result.credible).toBe(false);
    expect(result.confidence).toBe(0);
  });
});

describe("classifyHeadlines", () => {
  const headlines = [{ index: 0, feed: "テスト", title: "見出し1" }];

  it("正常なクラスタ応答を返す", async () => {
    mockContent(
      JSON.stringify({
        clusters: [
          {
            title: "テストクラスタ",
            member_indices: [0],
            classification: "report",
            category: "politics",
            risk_flags: [],
            question: "どう見る？",
            choices: { for: "賛成", against: "反対", undecided: "わからない" },
          },
        ],
      }),
    );
    const clusters = await classifyHeadlines(headlines);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].title).toBe("テストクラスタ");
  });

  it("member_indicesが空のクラスタは除外される", async () => {
    mockContent(
      JSON.stringify({
        clusters: [
          {
            title: "空クラスタ",
            member_indices: [],
            classification: "report",
            category: "politics",
            risk_flags: [],
            question: "",
            choices: { for: "", against: "", undecided: "" },
          },
        ],
      }),
    );
    const clusters = await classifyHeadlines(headlines);
    expect(clusters).toHaveLength(0);
  });

  it("不正なJSONが返っても例外を投げず空配列を返す", async () => {
    mockContent("not json at all");
    const clusters = await classifyHeadlines(headlines);
    expect(clusters).toEqual([]);
  });

  it("スキーマ不一致（clustersが配列でない）でも例外を投げず空配列を返す", async () => {
    mockContent(JSON.stringify({ clusters: "not an array" }));
    const clusters = await classifyHeadlines(headlines);
    expect(clusters).toEqual([]);
  });
});
