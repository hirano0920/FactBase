/**
 * assessDebateLegitimacy のユニットテスト。
 *
 * このフィルタの目的:
 * - 犯罪擁護を強要する設問(bad_frame)を弾く
 * - 自明な問い(obvious_truth)を弾く
 * - 事実確認のみ(fact_only)を弾く
 * - 両論が存在しない(no_opposing_side)を弾く
 * - 社会通念上まともでない立場(unacceptable_side)を弾く
 *
 * nanoモデル（gpt-5-mini）の応答をモックして、判定ツリーの各分岐をテストする。
 * 抜粋は本番と同じく1件あたり40字以上（短すぎるとAPI前に fail-closed）。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DebateLegitimacyResult } from "../ai";

// ─── モック ───────────────────────────

const mockCreate = vi.fn();

vi.mock("../openai-client", () => ({
  createOpenAIClient: () => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }),
}));

// OPENAI_API_KEY 設定がないと createOpenAIClient がエラーになる
vi.stubEnv("AZURE_OPENAI_API_KEY", "test-key");
vi.stubEnv("AZURE_OPENAI_BASE_URL", "https://test.openai.azure.com/");

// モジュールを動的にimportするための参照
let assessDebateLegitimacy: (
  params: Parameters<typeof import("../ai").assessDebateLegitimacy>[0],
) => Promise<DebateLegitimacyResult>;

// ─── ヘルパー ───────────────────────────

/** LLMの生JSON応答の型（Step4のpredictedMajorityPctを含む。パース後のpredictedDivisionScoreとは別物） */
type RawLegitimacyResponse = Omit<DebateLegitimacyResult, "predictedDivisionScore"> & {
  /** 読者100人が投票した場合の多数派側の割合(50〜100)。省略時はスキーマ既定の60。 */
  predictedMajorityPct?: number;
};

function mockResponse(result: RawLegitimacyResponse) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(result) } }],
  });
}

/** 本番ゲート（≧40字）を通る抜粋 ※ 短すぎると mock が次テストに漏れ fail する */
const EX = {
  pro: "政府は法案を提出した。賛成派は経済成長と雇用創出を主張し、将来の税収増も見込んでいると報じた。",
  con: "反対派は財政悪化を懸念し、将来世代への負担増と社会保障の持続性を強く問題視していると伝えた。",
  theftPro: "大学は博士号を取り消すと発表した。不正行為への厳正な対応として妥当だとする声が広がっている。",
  theftCon: "処分が厳しすぎるとの指摘もある。学位剥奪は生涯にわたる制裁になりかねないと専門家は語る。",
  disasterPro: "政府の初動は迅速だったと評価する声があり、物資の手配も早かったとの報道が相次いでいる。",
  disasterCon: "被災地からは支援が足りないと批判が出ている。避難所の環境改善が遅れているとの声も強い。",
  crimeA: "インフルエンサーが脱税で有罪判決を受けた。量刑の重さをめぐり専門家の見解が分かれている。",
  crimeB: "量刑は重すぎるとの指摘もある一方、抑止効果を重視すべきだという意見も報道されている。",
  obvious: "脱税が発覚し捜査が入った。関係者は説明責任を果たすべきだとの指摘が各方面から相次いでいる。",
  factOnly: "首相は記者会見で該当の発言をしたと報じられた。議事録にも同様の記述が残っていると確認された。",
  arrestA: "容疑者が逮捕された。警察は余罪を調べていると発表し、関係先への捜索も続けていると報じた。",
  arrestB: "逮捕状が出て身柄を拘束した。捜査当局は動機の解明に向けて裏付けを急いでいると説明した。",
  hatePro: "規制に賛成する側は、表現の自由と差別の境界を明確にすべきだと主張していると報じられた。",
  hateCon: "反対派は「表現の自由の侵害になりかねない」と主張し、萎縮効果を強く懸念していると伝えた。",
};

// ─── テスト ───────────────────────────

describe("assessDebateLegitimacy", () => {
  const defaultParams = {
    topic: "テストトピック",
    voteQuestion: "これは賛成ですか？反対ですか？",
    excerpts: [
      { feed: "新聞A", text: EX.pro },
      { feed: "新聞B", text: EX.con },
    ],
    classification: "reported",
    category: "politics",
  };

  beforeAll(async () => {
    const mod = await import("../ai");
    assessDebateLegitimacy = mod.assessDebateLegitimacy;
  });

  afterEach(() => {
    mockCreate.mockReset();
  });

  // ─── 適切なケース ───────────────────

  it("両論ある政策トピックは通す", async () => {
    mockResponse({
      legitimate: true,
      problemType: "ok",
      reason: "両方に正当な論拠がある",
      suggestedFrames: [],
    });

    const result = await assessDebateLegitimacy(defaultParams);
    expect(result.legitimate).toBe(true);
    expect(result.problemType).toBe("ok");
  });

  it("処分の轻重で議論が分かれるトピックは通す（論文盗用）", async () => {
    mockResponse({
      legitimate: true,
      problemType: "ok",
      reason: "処分の轻重で両論成立",
      suggestedFrames: [],
    });

    const result = await assessDebateLegitimacy({
      ...defaultParams,
      topic: "論文盗用で学位剥奪",
      voteQuestion: "学位剥奪は妥当だと思いますか？",
      excerpts: [
        { feed: "新聞A", text: EX.theftPro },
        { feed: "新聞B", text: EX.theftCon },
      ],
    });
    expect(result.legitimate).toBe(true);
    expect(result.problemType).toBe("ok");
  });

  it("被災対応の評価は通す", async () => {
    mockResponse({
      legitimate: true,
      problemType: "ok",
      reason: "対応の評価で両論成立",
      suggestedFrames: [],
    });

    const result = await assessDebateLegitimacy({
      ...defaultParams,
      topic: "能登半島地震の被災対応",
      voteQuestion: "被災対応は適切だと思いますか？",
      excerpts: [
        { feed: "新聞A", text: EX.disasterPro },
        { feed: "新聞B", text: EX.disasterCon },
      ],
    });
    expect(result.legitimate).toBe(true);
  });

  // ─── 不適切なケース ───────────────────

  it("犯罪擁護を強要する設問はbad_frameとして弾く", async () => {
    mockResponse({
      legitimate: false,
      problemType: "bad_frame",
      reason: "脱税擁護は存在しない",
      suggestedFrames: ["量刑は適切だった？", "実刑判決は妥当？"],
    });

    const result = await assessDebateLegitimacy({
      ...defaultParams,
      topic: "宮崎麗果、脱税で有罪判決",
      voteQuestion: "宮崎麗果の判決を擁護しますか、批判しますか？",
      excerpts: [
        { feed: "新聞A", text: EX.crimeA },
        { feed: "新聞B", text: EX.crimeB },
      ],
    });
    expect(result.legitimate).toBe(false);
    expect(result.problemType).toBe("bad_frame");
    expect(result.suggestedFrames.length).toBeGreaterThanOrEqual(1);
  });

  it("自明な問いはobvious_truthとして弾く", async () => {
    mockResponse({
      legitimate: false,
      problemType: "obvious_truth",
      reason: "脱税を擁護する人はいない",
      suggestedFrames: [],
    });

    const result = await assessDebateLegitimacy({
      ...defaultParams,
      topic: "脱税事件",
      voteQuestion: "脱税は悪いですか？",
      excerpts: [{ feed: "新聞A", text: EX.obvious }],
    });
    expect(result.legitimate).toBe(false);
    expect(result.problemType).toBe("obvious_truth");
  });

  it("事実確認のみの設問はfact_onlyとして弾く", async () => {
    mockResponse({
      legitimate: false,
      problemType: "fact_only",
      reason: "発言の有無は事実確認",
      suggestedFrames: [],
    });

    const result = await assessDebateLegitimacy({
      ...defaultParams,
      topic: "首相の発言",
      voteQuestion: "この発言はありましたか？",
      excerpts: [{ feed: "新聞A", text: EX.factOnly }],
    });
    expect(result.legitimate).toBe(false);
    expect(result.problemType).toBe("fact_only");
  });

  it("両論が存在しないトピックはno_opposing_sideとして弾く", async () => {
    mockResponse({
      legitimate: false,
      problemType: "no_opposing_side",
      reason: "全記事が逮捕報道のみ",
      suggestedFrames: [],
    });

    const result = await assessDebateLegitimacy({
      ...defaultParams,
      topic: "詐欺事件の逮捕",
      voteQuestion: "逮捕は妥当ですか？",
      excerpts: [
        { feed: "新聞A", text: EX.arrestA },
        { feed: "新聞B", text: EX.arrestB },
      ],
    });
    expect(result.legitimate).toBe(false);
    expect(result.problemType).toBe("no_opposing_side");
  });

  it("社会通念上まともでない立場はunacceptable_sideとして弾く", async () => {
    mockResponse({
      legitimate: false,
      problemType: "unacceptable_side",
      reason: "差別を擁護する立場は不適切",
      suggestedFrames: [],
    });

    const result = await assessDebateLegitimacy({
      ...defaultParams,
      topic: "ヘイトスピーチ規制",
      voteQuestion: "ヘイトスピーチの規制、賛成？反対？",
      excerpts: [
        { feed: "新聞A", text: EX.hatePro },
        { feed: "新聞B", text: EX.hateCon },
      ],
    });
    expect(result.legitimate).toBe(false);
    expect(result.problemType).toBe("unacceptable_side");
  });

  // ─── Step4: 予測分断度（predictedDivisionScore）───────────────────

  it("拮抗が予想されるトピックはpredictedDivisionScoreが高い", async () => {
    mockResponse({
      legitimate: true,
      problemType: "ok",
      reason: "賛否が拮抗すると予想される",
      suggestedFrames: [],
      predictedMajorityPct: 55,
    });

    const result = await assessDebateLegitimacy(defaultParams);
    expect(result.legitimate).toBe(true);
    // margin = 2*55-100 = 10 → divisionScore = 1 - 10/100 = 0.9
    expect(result.predictedDivisionScore).toBeCloseTo(0.9);
  });

  it("ほぼ一方的と予想されるトピックはpredictedDivisionScoreが低い", async () => {
    mockResponse({
      legitimate: true,
      problemType: "ok",
      reason: "論理上は両論だが実際はほぼ一致すると予想",
      suggestedFrames: [],
      predictedMajorityPct: 95,
    });

    const result = await assessDebateLegitimacy(defaultParams);
    expect(result.legitimate).toBe(true);
    // margin = 2*95-100 = 90 → divisionScore = 1 - 90/100 = 0.1
    expect(result.predictedDivisionScore).toBeCloseTo(0.1);
  });

  it("legitimate=falseのときpredictedDivisionScoreはundefined", async () => {
    mockResponse({
      legitimate: false,
      problemType: "obvious_truth",
      reason: "自明な問い",
      suggestedFrames: [],
    });

    const result = await assessDebateLegitimacy(defaultParams);
    expect(result.legitimate).toBe(false);
    expect(result.predictedDivisionScore).toBeUndefined();
  });

  // ─── エラー耐性（fail-closed）───────────────────

  it("API呼び出し失敗時は落とす", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API error"));

    const result = await assessDebateLegitimacy(defaultParams);
    expect(result.legitimate).toBe(false);
    expect(result.problemType).toBe("no_opposing_side");
  });

  it("JSONパース失敗時は落とす", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json" } }],
    });

    const result = await assessDebateLegitimacy(defaultParams);
    expect(result.legitimate).toBe(false);
  });

  it("抜粋が空ならAPIを呼ばず落とす", async () => {
    const result = await assessDebateLegitimacy({
      ...defaultParams,
      excerpts: [],
    });
    expect(result.legitimate).toBe(false);
    expect(result.problemType).toBe("no_opposing_side");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("短すぎる抜粋だけならAPIを呼ばず落とす", async () => {
    const result = await assessDebateLegitimacy({
      ...defaultParams,
      excerpts: [
        { feed: "新聞A", text: "短い。" },
        { feed: "新聞B", text: "これも短い文。" },
      ],
    });
    expect(result.legitimate).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
