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
  sanitizePolarVoteChoices,
  syncVoteQuestionWithChoices,
  verifySidesAxisAlignment,
  assessCommentStanceSpread,
  composeIssueTitle,
  judgeIssueTitleQuality,
  verifyVoteChoicesReflectSides,
} from "@/lib/ai";
import { AI_MODELS, RADAR, VOTE_CHOICE_MAX_CHARS } from "@/lib/constants";

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
    // 空応答時のフォールバックは争点タイプ非依存の汎用文言ではなく、
    // debateType別のデフォルト（indicator→妥当だ/不適切だ）を使う
    expect(topics[1].choices).toEqual({ for: "妥当だ", against: "不適切だ", undecided: "まだ判断できない" });
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
    expect(topics[0].choices.for.length).toBeLessThanOrEqual(VOTE_CHOICE_MAX_CHARS);
    expect(topics[0].choices.against.length).toBeLessThanOrEqual(VOTE_CHOICE_MAX_CHARS);
    expect(topics[0].choices.undecided.length).toBeLessThanOrEqual(VOTE_CHOICE_MAX_CHARS);
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

  it("記事内容から確定した設問・選択肢を返す（設問末尾にchoicesを埋め込む）", async () => {
    mockContent(
      JSON.stringify({
        question: "国旗損壊罪の新設、新設に賛成？新設に反対？",
        choices: { for: "新設に賛成", against: "新設に反対", undecided: "まだ判断できない" },
      }),
    );
    const result = await composeVoteQuestion(fallback);
    expect(result.question).toContain("新設に賛成");
    expect(result.question).toContain("新設に反対");
    expect(result.choices).toEqual({ for: "新設に賛成", against: "新設に反対", undecided: "まだ判断できない" });
  });

  it("choicesが長すぎる場合はVOTE_CHOICE_MAX_CHARSに切り詰める", async () => {
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
    expect(result.choices.for.length).toBeLessThanOrEqual(VOTE_CHOICE_MAX_CHARS);
    expect(result.choices.against.length).toBeLessThanOrEqual(VOTE_CHOICE_MAX_CHARS);
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

  it("policyで人物名ボタンになった場合は賛否ラベルに矯正し、設問末尾も同期する", async () => {
    mockContent(
      JSON.stringify({
        question: "国旗損壊罪法案、百地章氏賛成？沖縄弁護士会反対？",
        choices: { for: "百地章氏賛成", against: "沖縄弁護士会反対", undecided: "まだ判断できない" },
      }),
    );
    const result = await composeVoteQuestion(fallback);
    expect(result.choices).toEqual({
      for: "賛成",
      against: "反対",
      undecided: "わからない",
    });
    expect(result.question).toContain("賛成？");
    expect(result.question).toContain("反対？");
    expect(result.question).not.toContain("百地");
    expect(result.question).not.toContain("弁護士会");
  });

  it("geopoliticsで是非を問う設問なのに陣営名ラベルが返った場合は是非ラベルに矯正し設問も同期する", async () => {
    mockContent(
      JSON.stringify({
        question: "ホルムズ海峡封鎖は容認できますか？",
        choices: { for: "イラン側", against: "米軍側", undecided: "まだ判断できない" },
      }),
    );
    const result = await composeVoteQuestion({
      ...fallback,
      debateType: "geopolitics",
      issueTitle: "ホルムズ海峡封鎖",
    });
    expect(result.choices).toEqual({
      for: "容認できる",
      against: "容認できない",
      undecided: "まだ判断できない",
    });
    expect(result.question).toContain("容認できる");
    expect(result.question).toContain("容認できない");
  });

  it("geopoliticsでも当事者比較型の設問なら陣営名ラベルはそのまま通す", async () => {
    mockContent(
      JSON.stringify({
        question: "どちらの主張が妥当か、イラン側？米軍側？",
        choices: { for: "イラン側", against: "米軍側", undecided: "まだ判断できない" },
      }),
    );
    const result = await composeVoteQuestion({
      ...fallback,
      debateType: "geopolitics",
      issueTitle: "ホルムズ海峡封鎖",
    });
    expect(result.choices).toEqual({ for: "イラン側", against: "米軍側", undecided: "まだ判断できない" });
    expect(result.question).toContain("イラン側");
    expect(result.question).toContain("米軍側");
  });

  it("正しい？間違ってる？形式は容認ラベルへ置換せず通す", async () => {
    mockContent(
      JSON.stringify({
        question: "佐藤大臣が辞任した判断は正しい？間違ってる？",
        choices: { for: "正しい", against: "間違ってる", undecided: "まだ判断できない" },
      }),
    );
    const result = await composeVoteQuestion({
      ...fallback,
      debateType: "geopolitics",
      issueTitle: "佐藤大臣の辞任",
    });
    expect(result.choices.for).toBe("正しい");
    expect(result.choices.against).toBe("間違ってる");
    expect(result.question).toContain("正しい");
    expect(result.question).toContain("間違ってる");
    expect(result.question).not.toContain("容認");
  });
});

describe("syncVoteQuestionWithChoices", () => {
  it("choices変更後に設問末尾を新しいラベルへ揃える", () => {
    const q = syncVoteQuestionWithChoices("選挙SNS対策法案、自民支持？共産党懸念？", {
      for: "対応を支持",
      against: "問題視",
    });
    expect(q).toContain("対応を支持？");
    expect(q).toContain("問題視？");
    expect(q).not.toContain("自民");
    expect(q).not.toContain("共産");
  });

  it("40字超過時は前置きだけ短縮しA？B？は残す", () => {
    const q = syncVoteQuestionWithChoices(
      "とても長い前置きで文字数を意図的に押し上げるための状況説明テキスト、支持する？支持しない？",
      { for: "支持する", against: "支持しない" },
      40,
    );
    expect(q.length).toBeLessThanOrEqual(40);
    expect(q.endsWith("支持する？支持しない？")).toBe(true);
  });
});

describe("sanitizePolarVoteChoices", () => {
  it("declarationはそのまま通す", () => {
    const choices = { for: "事務所側", against: "報道側", undecided: "まだ判断できない" };
    expect(sanitizePolarVoteChoices("declaration", choices, choices)).toEqual(choices);
  });

  it("policyの人物名ラベルはデフォルト賛否へ", () => {
    expect(
      sanitizePolarVoteChoices(
        "policy",
        { for: "百地章氏賛成", against: "沖縄弁護士会反対", undecided: "まだ判断できない" },
        { for: "百地章氏賛成", against: "沖縄弁護士会反対", undecided: "まだ判断できない" },
      ),
    ).toEqual({ for: "法案に賛成", against: "法案に反対", undecided: "まだ判断できない" });
  });

  it("org_responseの政党名ラベルもデフォルト立場ラベルへ（2026-07-15本番で「自民支持」「共産党懸念」を確認）", () => {
    expect(
      sanitizePolarVoteChoices(
        "org_response",
        { for: "自民支持", against: "共産党懸念", undecided: "どちらとも言えない" },
        { for: "自民支持", against: "共産党懸念", undecided: "どちらとも言えない" },
      ),
    ).toEqual({ for: "対応を支持", against: "問題視", undecided: "どちらとも言えない" });
  });
});

describe("verifySidesAxisAlignment", () => {
  it("両側が同じ軸（対応の是非）なら aligned=true", async () => {
    mockContent(JSON.stringify({ aligned: true, reason: "" }));
    const result = await verifySidesAxisAlignment({
      question: "被災対応は適切だと思いますか？",
      sideA: { heading: "擁護側", items: ["救助活動を全力で進めていると当局が強調"] },
      sideB: { heading: "批判側", items: ["対応が後手に回ったと専門家が指摘"] },
    });
    expect(result.aligned).toBe(true);
  });

  it("片方が事後対応、もう片方が事前管理の話にすり替わっていれば aligned=false", async () => {
    mockContent(
      JSON.stringify({
        aligned: false,
        reason: "対応の是非と事前管理の是非が混在",
      }),
    );
    const result = await verifySidesAxisAlignment({
      question: "被災対応は適切だと思いますか？",
      sideA: { heading: "擁護側", items: ["救助活動は全力でやっている"] },
      sideB: { heading: "批判側", items: ["事前のダム管理に問題があった"] },
    });
    expect(result.aligned).toBe(false);
    expect(result.reason).toContain("事前管理");
  });

  it("API失敗時は誤検知で記事を止めないよう安全側でaligned=true", async () => {
    mocks.create.mockRejectedValueOnce(new Error("network error"));
    const result = await verifySidesAxisAlignment({
      question: "Q",
      sideA: { heading: "A", items: ["a"] },
      sideB: { heading: "B", items: ["b"] },
    });
    expect(result.aligned).toBe(true);
  });
});

describe("assessCommentStanceSpread", () => {
  it("コメントが二極化していればsplit=true", async () => {
    mockContent(JSON.stringify({ split: true, confidence: 0.75 }));
    const result = await assessCommentStanceSpread(["賛成だ、いいことだ", "反対だ、やめるべきだ"]);
    expect(result.split).toBe(true);
    expect(result.confidence).toBeCloseTo(0.75);
  });

  it("コメント配列が空ならAPIを呼ばずsplit=false", async () => {
    const result = await assessCommentStanceSpread([]);
    expect(result.split).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("API失敗時は誤って分断ありと過大評価しないよう安全側でsplit=false", async () => {
    mocks.create.mockRejectedValueOnce(new Error("network error"));
    const result = await assessCommentStanceSpread(["何かコメント"]);
    expect(result.split).toBe(false);
    expect(result.confidence).toBe(0);
  });
});

describe("composeIssueTitle", () => {
  it("titlesの配列を返す（3案）", async () => {
    mockContent(
      JSON.stringify({
        titles: ["一転して学位取消し、大学の説明は二転三転", "学位取消しが一夜で決定", "学位剥奪の理由は"],
      }),
    );
    const titles = await composeIssueTitle({
      clusterTitle: "学位剥奪",
      question: "妥当か",
      sourceTitles: ["学位取消しの記事"],
      classification: "reported",
      category: "society",
    });
    expect(titles).toHaveLength(3);
  });

  it("空文字の案は除外する", async () => {
    mockContent(JSON.stringify({ titles: ["良い見出し", "", "  "] }));
    const titles = await composeIssueTitle({
      clusterTitle: "x",
      question: "y",
      sourceTitles: [],
      classification: "reported",
      category: "society",
    });
    expect(titles).toEqual(["良い見出し"]);
  });
});

describe("judgeIssueTitleQuality", () => {
  it("候補が1件なら選抜せずそのまま返す", async () => {
    const result = await judgeIssueTitleQuality(["唯一の候補"]);
    expect(result.best).toBe("唯一の候補");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("候補が空なら空文字を返す", async () => {
    const result = await judgeIssueTitleQuality([]);
    expect(result.best).toBe("");
  });

  it("複数候補から最良の1つを選ぶ", async () => {
    mockContent(JSON.stringify({ best: "候補B", reason: "具体的で自然" }));
    const result = await judgeIssueTitleQuality(["候補A", "候補B", "候補C"]);
    expect(result.best).toBe("候補B");
  });

  it("nanoが候補に無い文字列を返したら安全側で先頭候補を採用する", async () => {
    mockContent(JSON.stringify({ best: "候補X（存在しない）", reason: "" }));
    const result = await judgeIssueTitleQuality(["候補A", "候補B"]);
    expect(result.best).toBe("候補A");
  });

  it("API失敗時は先頭候補を安全側で採用する", async () => {
    mocks.create.mockRejectedValueOnce(new Error("network error"));
    const result = await judgeIssueTitleQuality(["候補A", "候補B"]);
    expect(result.best).toBe("候補A");
  });
});

describe("verifyVoteChoicesReflectSides", () => {
  it("選択肢が両側の主張内容と一致していればaligned=true", async () => {
    mockContent(JSON.stringify({ aligned: true, reason: "" }));
    const result = await verifyVoteChoicesReflectSides({
      choices: { for: "対応を支持", against: "問題視" },
      sideA: { heading: "支持する側", items: ["政府の説明は妥当だと専門家が指摘"] },
      sideB: { heading: "問題視する側", items: ["対応が後手に回ったと批判"] },
    });
    expect(result.aligned).toBe(true);
  });

  it("選択肢が政党名等、両側の主張内容とズレていればaligned=false", async () => {
    mockContent(JSON.stringify({ aligned: false, reason: "政党名になっており対立の芯とズレている" }));
    const result = await verifyVoteChoicesReflectSides({
      choices: { for: "自民支持", against: "共産党懸念" },
      sideA: { heading: "支持する側", items: ["法案は偽情報対策に有効だと説明"] },
      sideB: { heading: "問題視する側", items: ["表現の自由を萎縮させると懸念"] },
    });
    expect(result.aligned).toBe(false);
    expect(result.reason).toContain("政党名");
  });

  it("API失敗時は誤検知で記事を止めないよう安全側でaligned=true", async () => {
    mocks.create.mockRejectedValueOnce(new Error("network error"));
    const result = await verifyVoteChoicesReflectSides({
      choices: { for: "A", against: "B" },
      sideA: { heading: "A側", items: ["a"] },
      sideB: { heading: "B側", items: ["b"] },
    });
    expect(result.aligned).toBe(true);
  });
});
