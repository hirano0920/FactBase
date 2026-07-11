import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/openai-client", () => ({
  createOpenAIClient: () => ({
    chat: { completions: { create: mocks.create } },
  }),
  createArticleClient: () => ({
    chat: { completions: { create: mocks.create } },
  }),
  resolveArticleModel: (defaultModel: string) => defaultModel,
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
  extractArgumentSections,
  formatArgumentSectionsForPrompt,
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

  it("pollingExcerptsのURLも本文に索引化する（世論調査主張の裏取り用）", () => {
    const index = buildSourceTextIndex({
      pollingExcerpts: [{ feed: "NHK", title: "内閣支持率調査", url: "https://poll", text: "支持率は45%でした" }],
    });
    expect(index.get("https://poll")).toBe("支持率は45%でした");
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

describe("extractArgumentSections", () => {
  it("賛成側/反対側セクションだけを抽出し、背景・出典等は除外する", () => {
    const html = `<h2>いま何が論点か</h2><p>導入部</p>
      <h2>背景</h2><ul><li>辞書的な説明</li></ul>
      <h2>賛成側が言うこと</h2><ul><li>財源が確保できる</li><li>公平性が高まる</li></ul>
      <h2>反対側が言うこと</h2><ul><li>負担が増える</li></ul>
      <h2>出典</h2><ul><li><a href="https://example.com">記事</a></li></ul>`;
    const sections = extractArgumentSections(html);
    expect(sections.map((s) => s.heading)).toEqual(["賛成側が言うこと", "反対側が言うこと"]);
    expect(sections[0].items).toEqual(["財源が確保できる", "公平性が高まる"]);
    expect(sections[1].items).toEqual(["負担が増える"]);
  });

  it("声明対立型の当事者名見出しも（既知の非論点見出しでなければ）拾う", () => {
    const html = `<h2>いま分かっていること</h2><ul><li>事実</li></ul>
      <h2>A氏の言い分</h2><ul><li>事実誤認だと主張</li></ul>
      <h2>B事務所の言い分</h2><ul><li>謝罪を要求</li></ul>`;
    const sections = extractArgumentSections(html);
    expect(sections.map((s) => s.heading)).toEqual(["A氏の言い分", "B事務所の言い分"]);
  });

  it("見出しにHTMLタグが無いセクションや空のulは無視する", () => {
    expect(extractArgumentSections("<h2>賛成側が言うこと</h2><p>箇条書きなし</p>")).toEqual([]);
  });
});

describe("formatArgumentSectionsForPrompt", () => {
  it("見出しごとにブロック化したプレーンテキストを返す", () => {
    const text = formatArgumentSectionsForPrompt([
      { heading: "賛成側が言うこと", items: ["財源が確保できる"] },
      { heading: "反対側が言うこと", items: ["負担が増える"] },
    ]);
    expect(text).toBe(
      "【賛成側が言うこと】\n- 財源が確保できる\n\n【反対側が言うこと】\n- 負担が増える",
    );
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

  it("観点ラベル・日付ラベルだけのstrongは除外する（検証誤爆防止）", () => {
    const html = `<ul>
      <li><strong>共通して報じられていること:</strong> 各社が金利据え置きを報じた</li>
      <li><strong>媒体名:</strong> 日経</li>
      <li><strong>ダイヤモンド・オンライン:</strong> 独自の分析を報じた</li>
      <li><strong>本人・事務所側:</strong> 該当しないと反論</li>
      <li><strong>6月4日:</strong> 会合が開かれた</li>
      <li><strong>今年6月26日:</strong> 議論が始まった</li>
      <li><strong>政策金利を1%に据え置き</strong></li>
    </ul>`;
    expect(extractHighlightedFacts(html)).toEqual(["政策金利を1%に据え置き"]);
  });

  it("正確な日が分からない月単位の時系列見出し（4月:等）も日付ラベルとして除外する", () => {
    const html = `<ul>
      <li><strong>4月:</strong> 道路交通法違反が発覚</li>
      <li><strong>今年7月:</strong> 代表辞任を表明</li>
      <li><strong>政策金利を1%に据え置き</strong></li>
    </ul>`;
    expect(extractHighlightedFacts(html)).toEqual(["政策金利を1%に据え置き"]);
  });
});

describe("findUngroundedNumbers", () => {
  it("資料本文のどこにも無い数値だけを返す", () => {
    const result = findUngroundedNumbers(["100億円", "3.5%"], ["予算は100億円に決定されました"]);
    expect(result).toEqual(["3.5%"]);
  });

  it("全角数字で書かれた資料でも半角の数値claimを裏付けありと判定する（表記ゆれ誤判定の修正）", () => {
    const result = findUngroundedNumbers(["100億円"], ["予算は１００億円に決定されました"]);
    expect(result).toEqual([]);
  });

  it("全角％でも半角%のclaimを裏付けありと判定する", () => {
    const result = findUngroundedNumbers(["3.5%"], ["支持率は3.5％に上昇"]);
    expect(result).toEqual([]);
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

  it("資料本文が全角数字でも半角の強調箇所を合格扱いにする（表記ゆれ誤判定の修正）", () => {
    const result = findUnclaimedHighlights(["予算は140億円"], [], ["予算は１４０億円に決定されました"]);
    expect(result).toEqual([]);
  });

  it("claimsが全角・強調箇所が半角の組み合わせでも合格扱いにする", () => {
    const result = findUnclaimedHighlights(["予算は140億円"], ["予算は１４０億円に決定"], ["別の資料"]);
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

describe("generateArticle（TwoSides導火線フォーマット）", () => {
  it("REPORTEDは火種向けセクションとlead/bullets指示を含む", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>いま何が論点か</h2>" });
    await generateArticle({
      issueTitle: "テスト争点",
      isReported: true,
      sources: [{ title: "見出し", url: "https://known", feed: "f" }],
      debateType: "policy",
    });
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    const systemContent = mocks.create.mock.calls[0][0].messages[0].content as string;
    expect(systemContent).toContain("最低限");
    expect(systemContent).toContain("スプリットスレッド");
    expect(systemContent).toContain("声明対立");
    expect(systemContent).toContain("国内が主戦場");
    expect(systemContent).toContain("辞書定義");
    expect(sentContent).toContain("<h2>いま何が論点か</h2>");
    expect(sentContent).toContain("<h2>どこで意見が分かれるか</h2>");
    expect(sentContent).toContain("<h2>賛成側が言うこと</h2>");
    expect(sentContent).toContain("争点タイプ: policy");
    expect(sentContent).toContain("いま分かっていること:");
    expect(sentContent).toContain("賛成側が言うこと:");
    expect(sentContent).not.toContain("<h2>現時点で確認できること</h2>");
    expect(sentContent).not.toContain("<h2>各立場の主張</h2>");
    expect(sentContent).not.toContain("<h2>報道の共通点と相違点</h2>");
    expect(sentContent).toContain("資料にありません");
  });

  it("declaration型は当事者名ヒントを注入する", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<p>x</p>" });
    await generateArticle({
      issueTitle: "声明対立",
      isReported: true,
      sources: [{ title: "見出し", url: "https://known", feed: "f" }],
      debateType: "declaration",
    });
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).toContain("争点タイプ: declaration");
    expect(sentContent).toContain("当事者名");
    expect(sentContent).toContain("A側（当事者名）");
  });

  it("OFFICIALは与党/野党固定ラベルではなく対立の軸を使う", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>いま分かっていること</h2>" });
    await generateArticle({
      issueTitle: "テスト争点",
      isReported: false,
      sources: [{ title: "見出し", url: "https://known", feed: "f" }],
      debateType: "policy",
    });
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).toContain("<h2>どこで意見が分かれるか</h2>");
    expect(sentContent).toContain("与党/野党固定はしない");
    expect(sentContent).toContain("<h2>賛成側が言うこと</h2>");
    expect(sentContent).not.toContain("<h2>各立場の主張</h2>");
    expect(sentContent).not.toContain("<h2>ポイント</h2>");
  });
});

describe("generateArticle（時系列セクションの自動挿入）", () => {
  const baseParams: GenerateArticleParams = {
    issueTitle: "テスト争点",
    isReported: false,
    sources: [{ title: "見出し", url: "https://known", feed: "f" }],
  };

  it("isTimelineWorthy=falseなら時系列セクションの指示を含めない", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>いま分かっていること</h2>" });
    await generateArticle(baseParams);
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).not.toContain("<h2>これまでの流れ</h2>");
  });

  it("previousArticleがあれば（続報＝変遷あり）時系列セクションの指示を含める", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>いま分かっていること</h2>" });
    await generateArticle({
      ...baseParams,
      previousArticle: { lead: "前回の要約", articleHtml: "<h2>いま分かっていること</h2>" },
    });
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).toContain("<h2>これまでの流れ</h2>");
  });

  it("日付が複数日にまたがるsourcesがあれば初回生成でも時系列セクションを含める", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>いま分かっていること</h2>" });
    await generateArticle({
      ...baseParams,
      sources: [
        { title: "A", url: "https://a", feed: "f", publishedAt: "2026-01-01T00:00:00Z" },
        { title: "B", url: "https://b", feed: "f", publishedAt: "2026-01-02T00:00:00Z" },
        { title: "C", url: "https://c", feed: "f", publishedAt: "2026-01-03T00:00:00Z" },
      ],
    });
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).toContain("<h2>これまでの流れ</h2>");
  });
});

describe("generateArticle（世論調査報道抜粋）", () => {
  const baseParams: GenerateArticleParams = {
    issueTitle: "テスト争点",
    isReported: false,
    sources: [{ title: "見出し", url: "https://known", feed: "f" }],
  };

  it("pollingExcerptsが無ければ世論調査報道抜粋ブロックを含めない", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>ポイント</h2>" });
    await generateArticle(baseParams);
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).not.toContain("# 世論調査報道抜粋");
  });

  it("pollingExcerptsがあれば媒体名付きで本文に含める", async () => {
    mockArticleResponse({ lead: "lead", bullets: [], articleHtml: "<h2>ポイント</h2>" });
    await generateArticle({
      ...baseParams,
      pollingExcerpts: [
        { feed: "NHK", title: "内閣支持率調査", url: "https://poll", text: "支持率は45%でした" },
      ],
    });
    const sentContent = mocks.create.mock.calls[0][0].messages[1].content as string;
    expect(sentContent).toContain("# 世論調査報道抜粋");
    expect(sentContent).toContain("NHK");
    expect(sentContent).toContain("支持率は45%でした");
  });
});
