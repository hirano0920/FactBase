import { describe, expect, it } from "vitest";
import {
  selectTopicsForPromotion,
  findDuplicateActiveIssue,
  dedupeSelectedCandidates,
  weightedPromoteScore,
  twosidesFitBonus,
  freshnessFactor,
  commentIntensityBonus,
  divisionScoreBonus,
  isLopsidedWithoutHeat,
  isLopsidedByPrediction,
  type PromotionCandidate,
  type SavedEvidence,
  type ActiveIssueForDedup,
} from "../promote-logic";
import type { EvidenceBundle } from "../research";

function evidence(overrides: Partial<SavedEvidence> = {}) {
  const base: SavedEvidence = {
    topic: "x",
    dietSpeeches: [],
    laws: [],
    news: [],
    internationalNews: [],
    background: null,
    officialEvents: [],
    gatheredAt: "",
    buzzScore: 3,
    /** Selection V2: Click' と Debate' の両方が無いと RANK_MIN で全滅するためテスト既定で付与 */
    tweetCount: 2000,
    commentCount: 500,
    debateType: "policy",
    debatable: true,
  };
  return { ...base, ...overrides };
}

/** evidence + 摩擦度を付与して Debate' が正の値になるようにする */
function ev(overrides: Partial<SavedEvidence> = {}): SavedEvidence {
  return evidence({ commentFrictionScore: 0.3, ...overrides });
}

function candidate(
  id: string,
  overrides: Partial<PromotionCandidate> & { evidence?: SavedEvidence } = {},
): PromotionCandidate {
  return {
    id,
    title: overrides.title ?? id,
    category: overrides.category ?? null,
    topicTerm: overrides.topicTerm ?? null,
    sourceUrls: overrides.sourceUrls ?? [],
    evidence: overrides.evidence ?? ev(),
    updatedAt: overrides.updatedAt,
  };
}

const sufficientNews: EvidenceBundle["news"] = [
  { title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
  { title: "B", source: "朝日", url: "https://b", pubDate: "", region: "domestic" },
];

const threeOutlets: EvidenceBundle["news"] = [
  { title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
  { title: "B", source: "朝日", url: "https://b", pubDate: "", region: "domestic" },
  { title: "C", source: "毎日", url: "https://c", pubDate: "", region: "domestic" },
];

describe("selectTopicsForPromotion", () => {

  it("media consensus: Selection V2では buzz=0 だと Buzz'×Heat'=0 で RANK_MIN 未達（出さない）", () => {
    const candidates: PromotionCandidate[] = [
      {
        id: "carry",
        title: "減税法案の与野党対立",
        category: "politics",
        topicTerm: "減税",
        sourceUrls: [],
        evidence: ev({ buzzScore: 0, news: threeOutlets, mediaConsensus: true, debateType: "policy" }),
      },
    ];
    expect(selectTopicsForPromotion(candidates, 2, 3)).toHaveLength(0);
  });

  it("media consensus + 十分な buzz/heat なら通る", () => {
    const candidates: PromotionCandidate[] = [
      {
        id: "carry",
        title: "減税法案の与野党対立",
        category: "politics",
        topicTerm: "減税",
        sourceUrls: [],
        evidence: ev({
          buzzScore: 2,
          tweetCount: 2500,
          news: threeOutlets,
          mediaConsensus: true,
          debateType: "policy",
        }),
      },
    ];
    expect(selectTopicsForPromotion(candidates, 2, 3).map((c) => c.id)).toEqual(["carry"]);
  });

  it("コメントランキング救済: minBuzz未満でも Buzz'≥0.4 かつ Heat' があれば通す", () => {
    const candidates: PromotionCandidate[] = [
      // minBuzz=3 未満だがコメントランキング＋Buzz'=0.4＋Heat' → 通す
      candidate("discussed", {
        category: "society",
        evidence: ev({
          buzzScore: 2,
          tweetCount: 2000,
          news: sufficientNews,
          buzzSources: ["yahoo_comment_ranking"],
          debateType: "norm_flare",
        }),
      }),
      // コメント一致でも Buzz'=0.2 < 0.4 → V2下限で落とす
      candidate("too-weak-buzz", {
        category: "society",
        evidence: ev({
          buzzScore: 1,
          tweetCount: 2000,
          news: sufficientNews,
          buzzSources: ["yahoo_comment_ranking"],
          debateType: "norm_flare",
        }),
      }),
      // ランキング無し・minBuzz未満 → eligible自体から外す
      candidate("not-discussed", {
        category: "society",
        evidence: ev({
          buzzScore: 2,
          tweetCount: 2000,
          news: sufficientNews,
          debateType: "norm_flare",
        }),
      }),
    ];
    const selected = selectTopicsForPromotion(candidates, 3, 3);
    expect(selected.map((c) => c.id)).toEqual(["discussed"]);
  });

  it("debateTypeが推定不能な薄い速報は promote しない", () => {
    const candidates: PromotionCandidate[] = [
      candidate("thin", {
        title: "速報",
        category: null,
        evidence: ev({
          buzzScore: 5,
          news: threeOutlets,
          debateType: null,
          topic: "速報",
        }),
      }),
      candidate("ok", {
        title: "減税の是非",
        category: "politics",
        evidence: ev({ buzzScore: 2, news: sufficientNews, debateType: "policy" }),
      }),
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["ok"]);
  });

  it("debatable=falseは eligible から外す", () => {
    const candidates: PromotionCandidate[] = [
      candidate("no", {
        title: "話題のみ",
        category: "society",
        evidence: ev({ buzzScore: 5, news: threeOutlets, debatable: false, debateType: "norm_flare" }),
      }),
    ];
    expect(selectTopicsForPromotion(candidates, 2, 3)).toHaveLength(0);
  });

  it("buzzScoreと証拠十分性の両方を満たす候補だけを残す", () => {
    const candidates: PromotionCandidate[] = [
      { id: "1", title: "低buzz", category: null, topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 1, news: sufficientNews }) },
      { id: "2", title: "証拠薄い", category: null, topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 3, news: [] }) },
      { id: "3", title: "両方満たす", category: null, topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 3, news: sufficientNews }) },
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["3"]);
  });

  it("buzzScore降順、同点なら異なる媒体数が多い方を優先する", () => {
    const candidates: PromotionCandidate[] = [
      { id: "low", title: "l", category: null, topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 2, news: sufficientNews }) },
      { id: "high", title: "h", category: null, topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 3, news: sufficientNews }) },
      {
        id: "tie-more-outlets",
        title: "t",
        category: null,
        topicTerm: null,
        sourceUrls: [],
        evidence: ev({
          buzzScore: 3,
          news: [...sufficientNews, { title: "C", source: "読売", url: "https://c", pubDate: "", region: "domestic" }],
        }),
      },
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["tie-more-outlets", "high", "low"]);
  });

  it("limitで件数を絞る", () => {
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      title: `t${i}`,
      category: null,
      topicTerm: null,
      sourceUrls: [],
      evidence: ev({ buzzScore: 3, news: sufficientNews }),
    }));
    expect(selectTopicsForPromotion(candidates, 2, 3)).toHaveLength(3);
  });

  it("背景解説のみでは promote 対象にならない", () => {
    const candidates: PromotionCandidate[] = [
      {
        id: "bg",
        title: "背景あり",
        category: null,
        topicTerm: null,
        sourceUrls: [],
        evidence: ev({
          buzzScore: 3,
          news: [{ title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" }],
          background: { title: "T", extract: "E", url: "https://w" },
        }),
      },
    ];
    expect(selectTopicsForPromotion(candidates, 2, 3)).toHaveLength(0);
  });

  it("背景+2媒体なら promote 対象", () => {
    const candidates: PromotionCandidate[] = [
      {
        id: "ok",
        title: "ok",
        category: null,
        topicTerm: null,
        sourceUrls: [],
        evidence: ev({
          buzzScore: 3,
          news: sufficientNews,
          background: { title: "T", extract: "E", url: "https://w" },
        }),
      },
    ];
    expect(selectTopicsForPromotion(candidates, 2, 3)).toHaveLength(1);
  });

  it("同一カテゴリが上位を独占しないよう、カテゴリ上限に達したら他カテゴリに枠を譲る", () => {
    const candidates: PromotionCandidate[] = [
      { id: "econ-1", title: "e1", category: "economy", topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 4, news: sufficientNews }) },
      { id: "econ-2", title: "e2", category: "economy", topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 4, news: sufficientNews }) },
      { id: "econ-3", title: "e3", category: "economy", topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 3, news: sufficientNews }) },
      { id: "intl-1", title: "i1", category: "international", topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 2, news: sufficientNews }) },
    ];
    // maxPerCategory=2: economyは上位2件(econ-1,econ-2)まで、3件目(econ-3)は他カテゴリ(intl-1)に譲る
    const selected = selectTopicsForPromotion(candidates, 2, 3, 2);
    expect(selected.map((c) => c.id)).toEqual(["econ-1", "econ-2", "intl-1"]);
  });

  it("他カテゴリに候補が無ければ上限を無視して枠を埋める（枠を空けたままにしない）", () => {
    const candidates: PromotionCandidate[] = [
      { id: "econ-1", title: "e1", category: "economy", topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 4, news: sufficientNews }) },
      { id: "econ-2", title: "e2", category: "economy", topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 3, news: sufficientNews }) },
      { id: "econ-3", title: "e3", category: "economy", topicTerm: null, sourceUrls: [], evidence: ev({ buzzScore: 2, news: sufficientNews }) },
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3, 2);
    expect(selected.map((c) => c.id)).toEqual(["econ-1", "econ-2", "econ-3"]);
  });

  it("同じbuzzScoreでもdebatable=falseはeligibleから外す", () => {
    const candidates: PromotionCandidate[] = [
      {
        id: "not-debatable",
        title: "話題のみ",
        category: "society",
        topicTerm: null,
        sourceUrls: [],
        evidence: ev({ buzzScore: 3, news: threeOutlets, debatable: false, debateType: "norm_flare" }),
      },
      {
        id: "debatable",
        title: "減税の是非",
        category: "politics",
        topicTerm: null,
        sourceUrls: [],
        evidence: ev({ buzzScore: 3, news: threeOutlets, debatable: true, debateType: "policy" }),
      },
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["debatable"]);
  });

  it("debatable未指定（旧データ）はtrue扱いで通す", () => {
    const candidates: PromotionCandidate[] = [
      {
        id: "undefined-debatable",
        title: "減税の是非",
        category: "politics",
        topicTerm: null,
        sourceUrls: [],
        evidence: ev({ buzzScore: 3, news: threeOutlets, debateType: "policy", debatable: undefined }),
      },
      {
        id: "false-debatable",
        title: "話題のみ",
        category: "society",
        topicTerm: null,
        sourceUrls: [],
        evidence: ev({ buzzScore: 3, news: threeOutlets, debatable: false, debateType: "norm_flare" }),
      },
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["undefined-debatable"]);
  });

  it("Selection V2: debateTypeボーナスではなく Buzz'×Heat' で並ぶ", () => {
    const candidates: PromotionCandidate[] = [
      candidate("politics", {
        title: "日銀の政策金利判断",
        category: "finance",
        evidence: ev({
          buzzScore: 3,
          tweetCount: 500,
          news: threeOutlets,
          debatable: true,
          debateType: "indicator",
        }),
      }),
      candidate("sato", {
        title: "佐藤二朗と事務所の声明対立",
        category: "entertainment",
        topicTerm: "佐藤二朗",
        evidence: ev({
          buzzScore: 2,
          tweetCount: 800,
          news: threeOutlets,
          debatable: true,
          debateType: "declaration",
        }),
      }),
      candidate("hot", {
        title: "円安の家計への影響",
        category: "economy",
        evidence: ev({
          buzzScore: 4,
          tweetCount: 4000,
          news: threeOutlets,
          debatable: true,
          debateType: "indicator",
        }),
      }),
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected[0]?.id).toBe("hot");
  });
});

describe("twosidesFitBonus", () => {
  it("declaration で+2.5、媒体3社以上ならさらに+0.5", () => {
    const c = candidate("sato", {
      title: "事務所が声明、本人は反論",
      category: "entertainment",
      evidence: ev({ debatable: true, news: threeOutlets, debateType: "declaration" }),
    });
    expect(twosidesFitBonus(c, 3)).toBe(3);
  });

  it("debatable=falseならボーナス0", () => {
    const c = candidate("gossip", {
      title: "事務所が声明",
      category: "entertainment",
      evidence: ev({ debatable: false, debateType: "declaration" }),
    });
    expect(twosidesFitBonus(c, 2)).toBe(0);
  });

  it("norm_flare は +1.0", () => {
    const c = candidate("flare", {
      title: "マナー論争",
      category: "society",
      evidence: ev({ debateType: "norm_flare" }),
    });
    expect(twosidesFitBonus(c, 2)).toBe(1);
  });
});

describe("weightedPromoteScore (Selection V2)", () => {
  it("Buzz'×Click'×Debate' の積（tweet無でもコメント実測があれば非ゼロ）", () => {
    // コメント500+friction0.3でcommentHeat(0.08)×debateHeat>0 → rank>0
    const withComments = weightedPromoteScore(
      candidate("a", { evidence: ev({ buzzScore: 5, tweetCount: undefined }) }),
      2,
    );
    expect(withComments).toBeGreaterThan(0);
    // tweetCountがある方が上（tweetHeat寄与分）
    const withTweet = weightedPromoteScore(
      candidate("b", { evidence: ev({ buzzScore: 5, tweetCount: 5000 }) }),
      2,
    );
    expect(withTweet).toBeGreaterThan(withComments);
  });

  it("tweetCountが高い方が上", () => {
    const hot = weightedPromoteScore(
      candidate("a", { evidence: ev({ buzzScore: 3, tweetCount: 5000 }) }),
      2,
    );
    const mild = weightedPromoteScore(
      candidate("b", { evidence: ev({ buzzScore: 3, tweetCount: 50 }) }),
      2,
    );
    expect(hot).toBeGreaterThan(mild);
  });

  it("露出だけ強くても熱量が弱いと沈む", () => {
    const buzzOnly = weightedPromoteScore(
      candidate("a", { evidence: ev({ buzzScore: 5, tweetCount: 40 }) }),
      2,
    );
    const balanced = weightedPromoteScore(
      candidate("b", { evidence: ev({ buzzScore: 3, tweetCount: 3000 }) }),
      2,
    );
    expect(balanced).toBeGreaterThan(buzzOnly);
  });

  it("媒体数は Rank に影響しない（Gate側の証拠十分性で見る）", () => {
    const a = weightedPromoteScore(
      candidate("a", { evidence: ev({ buzzScore: 4, tweetCount: 2000 }) }),
      1,
    );
    const b = weightedPromoteScore(
      candidate("b", { evidence: ev({ buzzScore: 4, tweetCount: 2000 }) }),
      5,
    );
    expect(a).toBeCloseTo(b);
  });
});

describe("selectTopicsForPromotion: RANK_MIN", () => {
  it("コメント・摩擦・tweetCountすべて無い候補は選ばない", () => {
    const candidates: PromotionCandidate[] = [
      candidate("cold", {
        evidence: ev({
          buzzScore: 5,
          tweetCount: undefined,
          commentCount: 0, // ev()既定値(500)を0に
          commentFrictionScore: undefined, // 摩擦データも無し
          news: threeOutlets,
          debateType: "policy",
        }),
      }),
    ];
    expect(selectTopicsForPromotion(candidates, 2, 3)).toHaveLength(0);
  });
});

describe("freshnessFactor", () => {
  it("6時間以内は減衰なし", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    expect(freshnessFactor(new Date(now.getTime() - 5 * 3_600_000), now)).toBe(1);
  });

  it("36時間以上は下限0.5", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    expect(freshnessFactor(new Date(now.getTime() - 40 * 3_600_000), now)).toBe(0.5);
  });

  it("updatedAt未指定なら1（減衰なし）", () => {
    expect(freshnessFactor(undefined)).toBe(1);
  });
});

describe("commentIntensityBonus", () => {
  it("commentCount未指定は0", () => {
    expect(commentIntensityBonus(candidate("a", { evidence: ev({}) }))).toBe(0);
  });

  it("1000件以上で+0.5、3000件以上で+1", () => {
    expect(commentIntensityBonus(candidate("a", { evidence: ev({ commentCount: 1000 }) }))).toBe(0.5);
    expect(commentIntensityBonus(candidate("b", { evidence: ev({ commentCount: 3000 }) }))).toBe(1);
    expect(commentIntensityBonus(candidate("c", { evidence: ev({ commentCount: 999 }) }))).toBe(0);
  });

  it("commentCountSurgeは加点（急増中はより優先）", () => {
    const surging = candidate("a", {
      evidence: ev({ commentCount: 1000, commentCountSurge: true }),
    });
    const steady = candidate("b", { evidence: ev({ commentCount: 1000 }) });
    expect(commentIntensityBonus(surging)).toBeGreaterThan(commentIntensityBonus(steady));
  });
});

describe("divisionScoreBonus", () => {
  it("externalPoll未一致は0", () => {
    expect(divisionScoreBonus(candidate("a", { evidence: evidence({}) }))).toBe(0);
  });

  it("拮抗している設問ほど高い", () => {
    const split = candidate("a", {
      evidence: ev({
        externalPoll: {
          question: "q",
          url: "https://x",
          choices: [{ choice: "for", count: 51, percent: 51 }, { choice: "against", count: 49, percent: 49 }],
          divisionScore: 0.98,
        },
      }),
    });
    const lopsided = candidate("b", {
      evidence: ev({
        externalPoll: {
          question: "q",
          url: "https://x",
          choices: [{ choice: "for", count: 99, percent: 99 }, { choice: "against", count: 1, percent: 1 }],
          divisionScore: 0.02,
        },
      }),
    });
    expect(divisionScoreBonus(split)).toBeGreaterThan(divisionScoreBonus(lopsided));
  });

  it("externalPollが無い場合はcommentStanceSpreadをconfidence込みで使う", () => {
    const splitByComments = candidate("a", {
      evidence: evidence({ commentFrictionScore: undefined, commentStanceSpread: { split: true, confidence: 0.8 } }),
    });
    const notSplit = candidate("b", {
      evidence: evidence({ commentFrictionScore: undefined, commentStanceSpread: { split: false, confidence: 0.9 } }),
    });
    expect(divisionScoreBonus(splitByComments)).toBeCloseTo(0.8);
    expect(divisionScoreBonus(notSplit)).toBe(0);
  });

  it("externalPollとcommentStanceSpreadの両方があればexternalPollを優先する", () => {
    const both = candidate("a", {
      evidence: ev({
        externalPoll: {
          question: "q",
          url: "https://x",
          choices: [{ choice: "for", count: 60, percent: 60 }, { choice: "against", count: 40, percent: 40 }],
          divisionScore: 0.8,
        },
        commentStanceSpread: { split: true, confidence: 0.1 },
      }),
    });
    expect(divisionScoreBonus(both)).toBeCloseTo(0.8);
  });
});

describe("isLopsidedWithoutHeat", () => {
  it("externalPollが無ければ判定しない（データ無し≠一方的）", () => {
    expect(isLopsidedWithoutHeat(ev({}))).toBe(false);
  });

  it("拮抗している設問（divisionScoreが高い）は一方的とみなさない", () => {
    expect(
      isLopsidedWithoutHeat(
        ev({
          externalPoll: {
            question: "国葬を実施すべきか",
            url: "https://x",
            choices: [{ choice: "for", count: 70, percent: 70 }, { choice: "against", count: 30, percent: 30 }],
            divisionScore: 0.4,
          },
        }),
      ),
    ).toBe(false);
  });

  it("ほぼ全会一致（divisionScore低）でも白熱の実測（コメント急増）があれば一方的扱いしない", () => {
    expect(
      isLopsidedWithoutHeat(
        ev({
          externalPoll: {
            question: "q",
            url: "https://x",
            choices: [{ choice: "for", count: 99, percent: 99 }, { choice: "against", count: 1, percent: 1 }],
            divisionScore: 0.02,
          },
          commentCountSurge: true,
        }),
      ),
    ).toBe(false);
  });

  it("ほぼ全会一致かつ白熱の実測も無ければ一方的と判定する", () => {
    expect(
      isLopsidedWithoutHeat(
        ev({
          externalPoll: {
            question: "q",
            url: "https://x",
            choices: [{ choice: "for", count: 99, percent: 99 }, { choice: "against", count: 1, percent: 1 }],
            divisionScore: 0.02,
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("isLopsidedByPrediction", () => {
  it("予測値が無ければ判定しない（LLM判定失敗時はfail-open）", () => {
    expect(isLopsidedByPrediction(undefined, ev({}))).toBe(false);
  });

  it("拮抗する予測（predictedDivisionScoreが高い）は一方的とみなさない", () => {
    expect(isLopsidedByPrediction(0.4, ev({}))).toBe(false);
  });

  it("ほぼ一方的な予測でも白熱の実測（コメント急増）があれば一方的扱いしない", () => {
    expect(isLopsidedByPrediction(0.02, ev({ commentCountSurge: true }))).toBe(false);
  });

  it("ほぼ一方的な予測かつ白熱の実測も無ければ一方的と判定する（例:『殺人は良い？悪い？』型）", () => {
    expect(isLopsidedByPrediction(0.02, ev({}))).toBe(true);
  });
});

describe("selectTopicsForPromotion: 一方的トピック（2026-07-16: ハードゲート撤去、Heat'floor/DVSソフトランクのみで判定）", () => {
  it("ほぼ全会一致かつ無白熱（コメント・摩擦・tweetCountすべて無）の候補は選ばれない", () => {
    const lopsidedNoHeat: PromotionCandidate = candidate("lopsided", {
      title: "誰も擁護しない出来事への賛否",
      category: "politics",
      evidence: ev({
        buzzScore: 5,
        news: threeOutlets,
        tweetCount: undefined,
        commentCount: 0, // ev()既定値(500)を0に
        commentFrictionScore: undefined, // 摩擦データも無し
        externalPoll: {
          question: "q",
          url: "https://x",
          choices: [{ choice: "for", count: 99, percent: 99 }, { choice: "against", count: 1, percent: 1 }],
          divisionScore: 0.02,
        },
      }),
    });
    const selected = selectTopicsForPromotion([lopsidedNoHeat], 1, 5);
    expect(selected).toHaveLength(0);
  });

  it("同じくほぼ全会一致でも、白熱の実測（コメント急増）があれば選ばれる", () => {
    const lopsidedButHeated: PromotionCandidate = candidate("heated", {
      title: "1億円の国葬費用への賛否",
      category: "politics",
      evidence: ev({
        buzzScore: 5,
        news: threeOutlets,
        commentCountSurge: true,
        externalPoll: {
          question: "q",
          url: "https://x",
          choices: [{ choice: "for", count: 99, percent: 99 }, { choice: "against", count: 1, percent: 1 }],
          divisionScore: 0.02,
        },
      }),
    });
    const selected = selectTopicsForPromotion([lopsidedButHeated], 1, 5);
    expect(selected).toHaveLength(1);
  });

  it("Yahoo投票はほぼ全会一致でも、tweetCountが大きければ選ばれる（旧ハードゲートの過剰除外を修正）", () => {
    // 旧isLopsidedWithoutHeatはhasHeatEvidence（Yahooコメント数/急増のみ）しか見ておらず、
    // X上で猛烈にバズっている（tweetCount大）候補でも一律ハードゲートで弾いていた。
    // ハードゲート撤去後は、実際に強いHeat'があれば通る（DVSはランクを下げるだけ）。
    const lopsidedButTweeting: PromotionCandidate = candidate("tweeting", {
      title: "大規模バズだがYahoo投票は一方的",
      category: "politics",
      evidence: ev({
        buzzScore: 5,
        news: threeOutlets,
        tweetCount: 5000,
        externalPoll: {
          question: "q",
          url: "https://x",
          choices: [{ choice: "for", count: 99, percent: 99 }, { choice: "against", count: 1, percent: 1 }],
          divisionScore: 0.02,
        },
      }),
    });
    const selected = selectTopicsForPromotion([lopsidedButTweeting], 1, 5);
    expect(selected).toHaveLength(1);
  });
});

describe("findDuplicateActiveIssue", () => {
  const activeIssues: ActiveIssueForDedup[] = [
    { id: "issue-1", title: "国旗損壊罪の新設をどう見る？", keywords: ["国旗損壊罪"] },
    { id: "issue-2", title: "日銀の利上げ判断をどう見る？", keywords: ["日銀利上げ"] },
  ];

  it("topicTermが既存Issueのkeywordsに含まれれば同一出来事と判定する", () => {
    const match = findDuplicateActiveIssue("国旗損壊罪が参院で可決", "国旗損壊罪", activeIssues);
    expect(match?.id).toBe("issue-1");
  });

  it("keyword不一致でもタイトルのbigram類似度が十分あれば同一と判定する", () => {
    const match = findDuplicateActiveIssue("国旗損壊罪の新設は妥当か", "国旗損壊罪の新設", activeIssues);
    expect(match?.id).toBe("issue-1");
  });

  it("無関係なトピックはnullを返す（誤って統合しない）", () => {
    const match = findDuplicateActiveIssue("為替介入の是非", "為替介入", activeIssues);
    expect(match).toBeNull();
  });

  it("アクティブなIssueが無ければnull", () => {
    expect(findDuplicateActiveIssue("国旗損壊罪", "国旗損壊罪", [])).toBeNull();
  });
});

describe("dedupeSelectedCandidates", () => {
  it("同一出来事の2候補を1グループに統合し、証拠の厚い方を主候補にする", () => {
    const weaker = candidate("resign", {
      title: "山本太郎代表辞任と党運営",
      topicTerm: "山本太郎代表辞任",
      sourceUrls: [{ title: "a", url: "https://a", feed: "f" }],
      evidence: ev({
        news: [{ title: "a", source: "f", url: "https://a", pubDate: "", region: "domestic" }],
      }),
    });
    const stronger = candidate("violation", {
      title: "山本太郎代表辞任と道路交通法違反",
      topicTerm: "山本太郎代表辞任",
      sourceUrls: [
        { title: "b", url: "https://b", feed: "f" },
        { title: "c", url: "https://c", feed: "f" },
      ],
      evidence: ev({
        news: [
          { title: "b", source: "f", url: "https://b", pubDate: "", region: "domestic" },
          { title: "c", source: "f", url: "https://c", pubDate: "", region: "domestic" },
        ],
      }),
    });
    const groups = dedupeSelectedCandidates([weaker, stronger]);
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.id).toBe("violation");
    expect(groups[0].absorbed.map((c) => c.id)).toEqual(["resign"]);
    // 主候補のsourceUrls/newsに弱い方の証拠も合流している（時系列セクションの材料になる）
    expect(groups[0].primary.sourceUrls.map((s) => s.url)).toEqual(
      expect.arrayContaining(["https://a", "https://b", "https://c"]),
    );
    expect(groups[0].primary.evidence.news.map((n) => n.url)).toEqual(
      expect.arrayContaining(["https://a", "https://b", "https://c"]),
    );
  });

  it("無関係なトピックはそれぞれ独立したグループのまま", () => {
    const a = candidate("a", { title: "為替介入の是非", topicTerm: "為替介入" });
    const b = candidate("b", { title: "国旗損壊罪法案", topicTerm: "国旗損壊罪" });
    const groups = dedupeSelectedCandidates([a, b]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.absorbed.length === 0)).toBe(true);
  });

  it("候補が0件なら空配列", () => {
    expect(dedupeSelectedCandidates([])).toEqual([]);
  });
});

