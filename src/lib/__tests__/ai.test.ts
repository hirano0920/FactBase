import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/openai-client", () => ({
  createOpenAIClient: () => ({
    chat: { completions: { create: mocks.create } },
  }),
}));

import {
  factCheck,
  judgeModeration,
  judgeIssueQuality,
  classifyHeadlines,
  filterRelevantTopics,
  composeVoteQuestion,
} from "@/lib/ai";
import { AI_MODELS, RADAR } from "@/lib/constants";

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

  it("match_candidate_idを未指定なら既定でnullになる", async () => {
    mockContent(
      JSON.stringify({
        clusters: [
          {
            title: "テストクラスタ",
            member_indices: [0],
            classification: "report",
            category: "politics",
            risk_flags: [],
          },
        ],
      }),
    );
    const clusters = await classifyHeadlines(headlines);
    expect(clusters[0].match_candidate_id).toBeNull();
  });

  it("match_candidate_idを指定した応答をそのまま反映する", async () => {
    mockContent(
      JSON.stringify({
        clusters: [
          {
            title: "国旗損壊罪の続報",
            member_indices: [0],
            classification: "official",
            category: "law",
            risk_flags: [],
            match_candidate_id: "cand_123",
          },
        ],
      }),
    );
    const clusters = await classifyHeadlines(headlines, [], [{ id: "cand_123", title: "国旗損壊罪の新設をどう見る？" }]);
    expect(clusters[0].match_candidate_id).toBe("cand_123");
  });

  it("未公開候補一覧をプロンプトのuserメッセージに含める", async () => {
    mockContent(JSON.stringify({ clusters: [] }));
    await classifyHeadlines(headlines, [], [{ id: "cand_123", title: "国旗損壊罪の新設をどう見る？" }]);
    const userMessage = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("cand_123");
    expect(userMessage).toContain("国旗損壊罪の新設をどう見る？");
  });
});

describe("filterRelevantTopics", () => {
  it("relevant=trueのトピックだけを正規化して返す（ゴシップは除外）", async () => {
    mockContent(
      JSON.stringify({
        topics: [
          {
            topic: "国旗損壊罪",
            relevant: true,
            category: "law",
            debatable: true,
            debateType: "policy",
            reason: "国会審議中の法案",
          },
          { topic: "某アイドル熱愛", relevant: false, category: "", reason: "芸能ゴシップ" },
        ],
      }),
    );
    const topics = await filterRelevantTopics([
      { term: "#国旗損壊", sustained: true },
      { term: "某アイドル", sustained: false },
    ]);
    expect(topics).toHaveLength(1);
    expect(topics[0].topic).toBe("国旗損壊罪");
    expect(topics[0].category).toBe("law");
    expect(topics[0].debateType).toBe("policy");
  });

  it("継続的話題フラグをプロンプトのuserメッセージに反映する", async () => {
    mockContent(JSON.stringify({ topics: [] }));
    await filterRelevantTopics([{ term: "解散総選挙", sustained: true }]);
    const userMessage = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(userMessage).toContain("解散総選挙");
    expect(userMessage).toContain("継続的に話題");
  });

  it("入力が空ならnanoを呼ばず空配列", async () => {
    const topics = await filterRelevantTopics([]);
    expect(topics).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("不正なJSONでも例外を投げず空配列にフォールバック", async () => {
    mockContent("not json");
    expect(await filterRelevantTopics([{ term: "国会" }])).toEqual([]);
  });

  it("gpt-5-mini（topicFilter）モデルで争点選別する", async () => {
    mockContent(JSON.stringify({ topics: [] }));
    await filterRelevantTopics([{ term: "国会" }]);
    expect(mocks.create.mock.calls[0][0].model).toBe(AI_MODELS.topicFilter);
  });

  it(`候補語は最大${RADAR.topicFilterMaxTerms}件まで mini に渡す`, async () => {
    mockContent(JSON.stringify({ topics: [] }));
    const terms = Array.from({ length: RADAR.topicFilterMaxTerms + 10 }, (_, i) => ({
      term: `争点候補${i}`,
    }));
    await filterRelevantTopics(terms);
    const userMessage = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(userMessage.match(/^- 争点候補/gm)?.length).toBe(RADAR.topicFilterMaxTerms);
  });

  it("question/choicesを返し、空ならデフォルト文言で補う", async () => {
    mockContent(
      JSON.stringify({
        topics: [
          {
            topic: "国旗損壊罪",
            relevant: true,
            category: "law",
            debatable: true,
            debateType: "policy",
            reason: "国会審議中",
            question: "国旗損壊罪の新設、あなたはどう見る？",
            choices: { for: "賛成", against: "反対", undecided: "わからない" },
          },
          {
            topic: "為替介入",
            relevant: true,
            category: "finance",
            debatable: true,
            debateType: "indicator",
            reason: "",
          },
        ],
      }),
    );
    const topics = await filterRelevantTopics([{ term: "国旗損壊罪" }, { term: "為替介入" }]);
    expect(topics[0].question).toBe("国旗損壊罪の新設、あなたはどう見る？");
    expect(topics[0].choices).toEqual({ for: "賛成", against: "反対", undecided: "わからない" });
    expect(topics[0].debateType).toBe("policy");
    expect(topics[1].question).toContain("為替介入");
    expect(topics[1].choices).toEqual({ for: "支持する", against: "支持しない", undecided: "わからない" });
    expect(topics[1].debateType).toBe("indicator");
  });

  it("choicesが長すぎる場合は投票ボタンに収まる長さに切り詰める（AI出力の暴走に備えた保険）", async () => {
    mockContent(
      JSON.stringify({
        topics: [
          {
            topic: "国旗損壊罪",
            relevant: true,
            category: "law",
            debatable: true,
            debateType: "policy",
            reason: "国会審議中",
            question: "国旗損壊罪の新設、あなたはどう見る？",
            choices: {
              for: "新設に賛成し表現の自由より公共の秩序を優先すべき",
              against: "新設に反対し表現の自由を最大限尊重すべき",
              undecided: "まだ判断に必要な情報が十分に揃っていない",
            },
          },
        ],
      }),
    );
    const topics = await filterRelevantTopics([{ term: "国旗損壊罪" }]);
    expect(topics[0].choices.for.length).toBeLessThanOrEqual(12);
    expect(topics[0].choices.against.length).toBeLessThanOrEqual(12);
    expect(topics[0].choices.undecided.length).toBeLessThanOrEqual(12);
  });

  it("debatable=falseやdebateType不明は落とす", async () => {
    mockContent(
      JSON.stringify({
        topics: [
          {
            topic: "速報だけ",
            relevant: true,
            category: "",
            debatable: false,
            reason: "事実共有のみ",
          },
          {
            topic: "減税",
            relevant: true,
            category: "politics",
            debatable: true,
            debateType: "policy",
            reason: "賛否あり",
          },
        ],
      }),
    );
    const topics = await filterRelevantTopics([{ term: "速報だけ" }, { term: "減税" }]);
    expect(topics.map((t) => t.topic)).toEqual(["減税"]);
  });
});

describe("composeVoteQuestion", () => {
  const fallback = {
    issueTitle: "国旗損壊罪法案",
    lead: "国旗損壊罪の新設を巡り、与野党で賛否が分かれています。",
    bullets: ["いま分かっていること: 参院で審議中", "賛成側が言うこと: 秩序維持に必要", "反対側が言うこと: 表現の自由を侵害"],
    debateType: "policy" as const,
    fallbackQuestion: "国旗損壊罪の新設、あなたはどう見る？",
    fallbackChoices: { for: "賛成", against: "反対", undecided: "わからない" },
  };

  it("記事内容から確定した設問・選択肢を返す", async () => {
    mockContent(
      JSON.stringify({
        question: "国旗損壊罪の新設、賛成ですか？",
        choices: { for: "新設に賛成", against: "新設に反対", undecided: "まだ判断できない" },
      }),
    );
    const result = await composeVoteQuestion(fallback);
    expect(result.question).toBe("国旗損壊罪の新設、賛成ですか？");
    expect(result.choices).toEqual({ for: "新設に賛成", against: "新設に反対", undecided: "まだ判断できない" });
  });

  it("choicesが長すぎる場合は12字に切り詰める", async () => {
    mockContent(
      JSON.stringify({
        question: "国旗損壊罪の新設、賛成ですか？",
        choices: {
          for: "秩序維持のために新設に賛成すべき",
          against: "表現の自由を侵害するため反対すべき",
          undecided: "まだ判断",
        },
      }),
    );
    const result = await composeVoteQuestion(fallback);
    expect(result.choices.for.length).toBeLessThanOrEqual(12);
    expect(result.choices.against.length).toBeLessThanOrEqual(12);
  });

  it("空応答時はfallbackの設問・選択肢を返す", async () => {
    mockContent(JSON.stringify({ question: "", choices: { for: "", against: "", undecided: "" } }));
    const result = await composeVoteQuestion(fallback);
    expect(result).toEqual({ question: fallback.fallbackQuestion, choices: fallback.fallbackChoices });
  });

  it("nano呼び出し失敗時はfallbackにフォールバックする（記事公開を止めない）", async () => {
    mocks.create.mockRejectedValueOnce(new Error("network error"));
    const result = await composeVoteQuestion(fallback);
    expect(result).toEqual({ question: fallback.fallbackQuestion, choices: fallback.fallbackChoices });
  });
});
