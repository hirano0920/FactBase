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
  buildSourceTextIndex,
  findUngroundedByMissingSource,
  extractGroundableNumbers,
  extractHighlightedFacts,
  findUngroundedNumbers,
  findUnclaimedHighlights,
  isTimelineWorthy,
  generateVerifiedArticle,
  generateArticle,
  violatesBan,
  type ArticleClaim,
  type GenerateArticleParams,
} from "@/lib/radar-article";

function mockArticleResponse(content: Record<string, unknown>) {
  mocks.create.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(content) } }],
  });
}

function mockVerifyResponse(results: { id: string; supported: boolean }[]) {
  mocks.create.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify({ results }) } }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildSourceTextIndex", () => {
  it("primaryExcerpts/reportExcerpts/dietSpeeches/laws/backgroundのURLを本文に索引化する", () => {
    const index = buildSourceTextIndex({
      primaryExcerpts: [{ title: "t", url: "https://a", text: "一次資料本文" }],
      reportExcerpts: [{ feed: "f", title: "t", url: "https://b", text: "報道本文" }],
      dietSpeeches: [
        { date: "2026-01-01", house: "衆議院", meeting: "本会議", speaker: "議員A", snippet: "発言内容", url: "https://c" },
      ],
      laws: [
        {
          lawTitle: "テスト法",
          lawNum: "1",
          promulgationDate: "",
          repealStatus: "",
          url: "https://d",
          articleSnippets: [{ position: "第1条", text: "条文内容" }],
        },
      ],
      background: { title: "背景", extract: "背景本文", url: "https://e" },
    });
    expect(index.get("https://a")).toBe("一次資料本文");
    expect(index.get("https://b")).toBe("報道本文");
    expect(index.get("https://c")).toBe("発言内容");
    expect(index.get("https://d")).toBe("条文内容");
    expect(index.get("https://e")).toBe("背景本文");
  });

  it("法令に条文抜粋が無い場合は索引に含めない（存在レベルの事実のみで裏取り不能なため）", () => {
    const index = buildSourceTextIndex({
      laws: [{ lawTitle: "テスト法", lawNum: "1", promulgationDate: "", repealStatus: "", url: "https://d" }],
    });
    expect(index.has("https://d")).toBe(false);
  });
});

describe("findUngroundedByMissingSource", () => {
  const index = new Map([["https://known", "本文"]]);

  it("索引に無いsourceUrlを持つclaimをsource_not_foundとして返す", () => {
    const claims: ArticleClaim[] = [
      { text: "既知の主張", sourceUrl: "https://known" },
      { text: "捏造/未取得の主張", sourceUrl: "https://unknown" },
    ];
    const result = findUngroundedByMissingSource(claims, index);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ text: "捏造/未取得の主張", reason: "source_not_found" });
  });
});

describe("generateVerifiedArticle", () => {
  const baseParams: GenerateArticleParams = {
    issueTitle: "テスト争点",
    isReported: false,
    sources: [{ title: "見出し", url: "https://known", feed: "f" }],
    primaryExcerpts: [{ title: "資料", url: "https://known", text: "予算は100億円と決定されました" }],
  };

  it("claimsが全て裏付けされれば1回の生成でverified=trueを返す", async () => {
    mockArticleResponse({
      lead: "lead",
      bullets: ["a"],
      articleHtml: "<h2>ポイント</h2>",
      claims: [{ text: "予算は100億円", sourceUrl: "https://known" }],
    });
    mockVerifyResponse([{ id: "0", supported: true }]);

    const result = await generateVerifiedArticle(baseParams);
    expect(result.verified).toBe(true);
    expect(result.attempts).toBe(1);
    expect(mocks.create).toHaveBeenCalledTimes(2); // 執筆1回 + 検証1回
  });

  it("claims配列が空なら検証をスキップして即座にverified=trueを返す（nano呼び出しなし）", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>ポイント</h2>", claims: [] });

    const result = await generateVerifiedArticle(baseParams);
    expect(result.verified).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1); // 執筆のみ
  });

  it("存在しないURLを主張の根拠にした場合、nanoを呼ばずに即不合格として差し戻す", async () => {
    mockArticleResponse({
      lead: "lead",
      bullets: [],
      articleHtml: "<h2>ポイント</h2>",
      claims: [{ text: "捏造された主張", sourceUrl: "https://not-given" }],
    });
    // 2回目（差し戻し後）も同じ不合格claimを返し続けるケース
    mockArticleResponse({
      lead: "lead",
      bullets: [],
      articleHtml: "<h2>ポイント</h2>",
      claims: [{ text: "捏造された主張", sourceUrl: "https://not-given" }],
    });
    mockArticleResponse({
      lead: "lead",
      bullets: [],
      articleHtml: "<h2>ポイント</h2>",
      claims: [{ text: "捏造された主張", sourceUrl: "https://not-given" }],
    });

    const result = await generateVerifiedArticle(baseParams, 2);
    expect(result.verified).toBe(false);
    expect(result.unresolvedClaims).toHaveLength(1);
    expect(result.unresolvedClaims[0].reason).toBe("source_not_found");
    expect(result.attempts).toBe(3); // 初回+再試行2回
    expect(mocks.create).toHaveBeenCalledTimes(3); // 執筆のみ×3（nanoは一度も呼ばれない）
  });

  it("不合格claimが2回目の生成で解消されればverified=trueで終わる", async () => {
    mockArticleResponse({
      lead: "lead",
      bullets: [],
      articleHtml: "<h2>ポイント</h2>",
      claims: [{ text: "誇張された主張", sourceUrl: "https://known" }],
    });
    mockVerifyResponse([{ id: "0", supported: false }]);
    mockArticleResponse({
      lead: "lead",
      bullets: [],
      articleHtml: "<h2>ポイント</h2>",
      claims: [{ text: "予算は100億円", sourceUrl: "https://known" }],
    });
    mockVerifyResponse([{ id: "0", supported: true }]);

    const result = await generateVerifiedArticle(baseParams, 2);
    expect(result.verified).toBe(true);
    expect(result.attempts).toBe(2);
  });
});

describe("violatesBan", () => {
  it("既存の断定表現チェックはclaimsフィールド追加後も変わらず動作する", () => {
    const banned = violatesBan({
      lead: "これは間違いない事実です",
      bullets: [],
      articleHtml: "",
    });
    expect(banned).not.toBeNull();
  });
});

describe("extractGroundableNumbers", () => {
  it("金額・割合・件数等の数量的事実を抽出する", () => {
    const html = "<li>予算は<strong>140億円</strong>に決定。前年比3.5%増で、対象は8000件</li>";
    expect(extractGroundableNumbers(html)).toEqual(
      expect.arrayContaining(["140億円", "3.5%", "8000件"]),
    );
  });

  it("日付単体（◯年/◯月/◯日）は誤検出が多いため対象外にする", () => {
    expect(extractGroundableNumbers("<li>2026年6月30日に成立</li>")).toEqual([]);
  });

  it("重複は1つにまとめる", () => {
    expect(extractGroundableNumbers("<li>100億円と100億円</li>")).toEqual(["100億円"]);
  });
});

describe("extractHighlightedFacts", () => {
  it("<strong>タグ内のテキストをタグ除去して抽出する", () => {
    expect(extractHighlightedFacts("<li><strong>予算は140億円</strong>に決定</li>")).toEqual([
      "予算は140億円",
    ]);
  });

  it("強調が無ければ空配列を返す", () => {
    expect(extractHighlightedFacts("<li>強調なしの文章</li>")).toEqual([]);
  });
});

describe("findUngroundedNumbers", () => {
  it("資料本文のどこにも無い数値だけを返す", () => {
    const result = findUngroundedNumbers(["100億円", "3.5%"], ["予算は100億円に決定されました"]);
    expect(result).toEqual(["3.5%"]);
  });
});

describe("findUnclaimedHighlights", () => {
  it("claimsにも資料本文にも無い強調箇所だけを返す", () => {
    const result = findUnclaimedHighlights(
      ["予算は140億円", "捏造された強調"],
      ["予算は140億円に決定"],
      ["別の資料本文"],
    );
    expect(result).toEqual(["捏造された強調"]);
  });

  it("claimsに含まれていなくても資料本文に直接見つかれば合格扱いにする", () => {
    const result = findUnclaimedHighlights(["予算は140億円"], [], ["予算は140億円に決定されました"]);
    expect(result).toEqual([]);
  });
});

describe("generateVerifiedArticle（網羅性チェック）", () => {
  const baseParams: GenerateArticleParams = {
    issueTitle: "テスト争点",
    isReported: false,
    sources: [{ title: "見出し", url: "https://known", feed: "f" }],
    primaryExcerpts: [{ title: "資料", url: "https://known", text: "予算は100億円と決定されました" }],
  };

  it("claimsに無くタグ付けも無い<strong>強調の捏造数値は、資料に無ければ最終的にHELD相当になる", async () => {
    // claims配列自体を出さない（自己申告漏れ）ケースを想定 — articleHtml直接スキャンで捕まえられるか
    const badArticle = {
      lead: "lead",
      bullets: [],
      articleHtml: "<h2>ポイント</h2><li><strong>予算は999億円</strong>に決定</li>",
      claims: [],
    };
    mockArticleResponse(badArticle);
    mockArticleResponse(badArticle);
    mockArticleResponse(badArticle);

    const result = await generateVerifiedArticle(baseParams, 2);
    expect(result.verified).toBe(false);
    expect(result.unresolvedClaims.some((c) => c.reason === "unclaimed_highlight")).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(3); // 執筆のみ×3（nanoは一度も呼ばれない・claims空のため）
  });

  it("資料本文に実在する数値の強調はclaims自己申告が無くても合格する", async () => {
    mockArticleResponse({
      lead: "lead",
      bullets: [],
      articleHtml: "<h2>ポイント</h2><li><strong>予算は100億円</strong>に決定</li>",
      claims: [],
    });

    const result = await generateVerifiedArticle(baseParams);
    expect(result.verified).toBe(true);
  });
});

describe("isTimelineWorthy", () => {
  it("続報再生成（previousArticleあり）は常に対象にする", () => {
    expect(isTimelineWorthy([], [], true)).toBe(true);
  });

  it("日付付きソースが2件未満なら対象外", () => {
    expect(isTimelineWorthy([{ publishedAt: "2026-01-01T00:00:00Z" }], [], false)).toBe(false);
  });

  it("同じ日に集中していれば（実質スナップショット）対象外", () => {
    const sources = [
      { publishedAt: "2026-01-01T00:00:00Z" },
      { publishedAt: "2026-01-01T02:00:00Z" },
      { publishedAt: "2026-01-01T04:00:00Z" },
    ];
    expect(isTimelineWorthy(sources, [], false)).toBe(false);
  });

  it("複数日にまたがり時間幅も十分なら対象にする", () => {
    const sources = [
      { publishedAt: "2026-01-01T00:00:00Z" },
      { publishedAt: "2026-01-02T00:00:00Z" },
      { publishedAt: "2026-01-03T00:00:00Z" },
    ];
    expect(isTimelineWorthy(sources, [], false)).toBe(true);
  });

  it("国会会議録の日付も判定材料に含める", () => {
    const sources = [{ publishedAt: "2026-01-01T00:00:00Z" }];
    const dietSpeeches = [{ date: "2026-01-02" }, { date: "2026-01-03" }];
    expect(isTimelineWorthy(sources, dietSpeeches, false)).toBe(true);
  });

  it("日付が分からないソースだけなら対象外", () => {
    expect(isTimelineWorthy([{}, {}, {}], [], false)).toBe(false);
  });
});

describe("generateArticle（時系列セクションの自動挿入）", () => {
  const baseParams: GenerateArticleParams = {
    issueTitle: "テスト争点",
    isReported: false,
    sources: [{ title: "見出し", url: "https://known", feed: "f" }],
  };

  it("isTimelineWorthy=falseなら時系列セクションの指示を含めない", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>ポイント</h2>" });
    await generateArticle(baseParams);
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).not.toContain("<h2>時系列</h2>");
  });

  it("previousArticleがあれば（続報＝変遷あり）時系列セクションの指示を含める", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>ポイント</h2>" });
    await generateArticle({
      ...baseParams,
      previousArticle: { lead: "前回の要約", articleHtml: "<h2>ポイント</h2>" },
    });
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).toContain("<h2>時系列</h2>");
  });

  it("日付が複数日にまたがるsourcesがあれば初回生成でも時系列セクションを含める", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>ポイント</h2>" });
    await generateArticle({
      ...baseParams,
      sources: [
        { title: "A", url: "https://a", feed: "f", publishedAt: "2026-01-01T00:00:00Z" },
        { title: "B", url: "https://b", feed: "f", publishedAt: "2026-01-02T00:00:00Z" },
        { title: "C", url: "https://c", feed: "f", publishedAt: "2026-01-03T00:00:00Z" },
      ],
    });
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).toContain("<h2>時系列</h2>");
  });
});
