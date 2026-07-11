import { describe, expect, it } from "vitest";
import {
  selectTopicsForPromotion,
  findDuplicateActiveIssue,
  dedupeSelectedCandidates,
  weightedPromoteScore,
  twosidesFitBonus,
  freshnessFactor,
  commentIntensityBonus,
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
    debateType: "policy",
    debatable: true,
  };
  return { ...base, ...overrides };
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
    evidence: overrides.evidence ?? evidence(),
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

  it("media consensus: バズ前でも3媒体以上の一致があれば引き取り候補を公開する", () => {
    const candidates: PromotionCandidate[] = [
      // buzzScore0だが mediaConsensus かつ 3媒体 → 通す
      {
        id: "carry",
        title: "減税法案の与野党対立",
        category: "politics",
        topicTerm: "減税",
        sourceUrls: [],
        evidence: evidence({ buzzScore: 0, news: threeOutlets, mediaConsensus: true, debateType: "policy" }),
      },
      // mediaConsensusでも2媒体どまり（CONSENSUS_MIN_OUTLETS未満）→ 落とす
      {
        id: "weak",
        title: "媒体不足",
        category: "politics",
        topicTerm: null,
        sourceUrls: [],
        evidence: evidence({ buzzScore: 0, news: sufficientNews, mediaConsensus: true, debateType: "policy" }),
      },
      // consensusフラグ無しの低buzzは従来通り落とす
      {
        id: "plain",
        title: "低buzz",
        category: "politics",
        topicTerm: null,
        sourceUrls: [],
        evidence: evidence({ buzzScore: 0, news: threeOutlets, debateType: "policy" }),
      },
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["carry"]);
  });

  it("単一プラットフォーム救済: コメントランキング一致かつ証拠十分ならminBuzzScore未満でも通す", () => {
    const candidates: PromotionCandidate[] = [
      // buzzScore1（通常ゲート2未満）だがコメントランキング一致 → 通す
      candidate("discussed", {
        category: "society",
        evidence: evidence({
          buzzScore: 1,
          news: sufficientNews,
          buzzSources: ["yahoo_comment_ranking"],
          debateType: "norm_flare",
        }),
      }),
      // buzzScore1でコメントランキング一致無し → 従来通り落とす
      candidate("not-discussed", {
        category: "society",
        evidence: evidence({ buzzScore: 1, news: sufficientNews, debateType: "norm_flare" }),
      }),
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["discussed"]);
  });

  it("debateTypeが推定不能な薄い速報は promote しない", () => {
    const candidates: PromotionCandidate[] = [
      candidate("thin", {
        title: "速報",
        category: null,
        evidence: evidence({
          buzzScore: 5,
          news: threeOutlets,
          debateType: null,
          topic: "速報",
        }),
      }),
      candidate("ok", {
        title: "減税の是非",
        category: "politics",
        evidence: evidence({ buzzScore: 2, news: sufficientNews, debateType: "policy" }),
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
        evidence: evidence({ buzzScore: 5, news: threeOutlets, debatable: false, debateType: "norm_flare" }),
      }),
    ];
    expect(selectTopicsForPromotion(candidates, 2, 3)).toHaveLength(0);
  });

  it("buzzScoreと証拠十分性の両方を満たす候補だけを残す", () => {
    const candidates: PromotionCandidate[] = [
      { id: "1", title: "低buzz", category: null, topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 1, news: sufficientNews }) },
      { id: "2", title: "証拠薄い", category: null, topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 3, news: [] }) },
      { id: "3", title: "両方満たす", category: null, topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 3, news: sufficientNews }) },
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["3"]);
  });

  it("buzzScore降順、同点なら異なる媒体数が多い方を優先する", () => {
    const candidates: PromotionCandidate[] = [
      { id: "low", title: "l", category: null, topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 2, news: sufficientNews }) },
      { id: "high", title: "h", category: null, topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 3, news: sufficientNews }) },
      {
        id: "tie-more-outlets",
        title: "t",
        category: null,
        topicTerm: null,
        sourceUrls: [],
        evidence: evidence({
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
      evidence: evidence({ buzzScore: 3, news: sufficientNews }),
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
        evidence: evidence({
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
        evidence: evidence({
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
      { id: "econ-1", title: "e1", category: "economy", topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 4, news: sufficientNews }) },
      { id: "econ-2", title: "e2", category: "economy", topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 4, news: sufficientNews }) },
      { id: "econ-3", title: "e3", category: "economy", topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 3, news: sufficientNews }) },
      { id: "intl-1", title: "i1", category: "international", topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 2, news: sufficientNews }) },
    ];
    // maxPerCategory=2: economyは上位2件(econ-1,econ-2)まで、3件目(econ-3)は他カテゴリ(intl-1)に譲る
    const selected = selectTopicsForPromotion(candidates, 2, 3, 2);
    expect(selected.map((c) => c.id)).toEqual(["econ-1", "econ-2", "intl-1"]);
  });

  it("他カテゴリに候補が無ければ上限を無視して枠を埋める（枠を空けたままにしない）", () => {
    const candidates: PromotionCandidate[] = [
      { id: "econ-1", title: "e1", category: "economy", topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 4, news: sufficientNews }) },
      { id: "econ-2", title: "e2", category: "economy", topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 3, news: sufficientNews }) },
      { id: "econ-3", title: "e3", category: "economy", topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 2, news: sufficientNews }) },
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
        evidence: evidence({ buzzScore: 3, news: threeOutlets, debatable: false, debateType: "norm_flare" }),
      },
      {
        id: "debatable",
        title: "減税の是非",
        category: "politics",
        topicTerm: null,
        sourceUrls: [],
        evidence: evidence({ buzzScore: 3, news: threeOutlets, debatable: true, debateType: "policy" }),
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
        evidence: evidence({ buzzScore: 3, news: threeOutlets, debateType: "policy", debatable: undefined }),
      },
      {
        id: "false-debatable",
        title: "話題のみ",
        category: "society",
        topicTerm: null,
        sourceUrls: [],
        evidence: evidence({ buzzScore: 3, news: threeOutlets, debatable: false, debateType: "norm_flare" }),
      },
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["undefined-debatable"]);
  });

  it("声明対立型は同buzzの政治候補より確実に1位になる（TwoSidesお手本）", () => {
    const declarationNews: EvidenceBundle["news"] = [
      { title: "事務所が声明を発表", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
      { title: "本人は疑惑を否定", source: "朝日", url: "https://b", pubDate: "", region: "domestic" },
      { title: "契約解除をめぐる反論", source: "毎日", url: "https://c", pubDate: "", region: "domestic" },
    ];
    const candidates: PromotionCandidate[] = [
      candidate("politics", {
        title: "日銀の政策金利判断",
        category: "finance",
        evidence: evidence({ buzzScore: 3, news: threeOutlets, debatable: true, debateType: "indicator" }),
      }),
      candidate("sato", {
        title: "佐藤二朗と事務所の声明対立",
        category: "entertainment",
        topicTerm: "佐藤二朗",
        evidence: evidence({
          buzzScore: 2,
          news: declarationNews,
          debatable: true,
          debateType: "declaration",
          voteQuestion: "事務所の対応をどう見る？",
        }),
      }),
      candidate("economy", {
        title: "円安の家計への影響",
        category: "economy",
        evidence: evidence({ buzzScore: 4, news: threeOutlets, debatable: true, debateType: "indicator" }),
      }),
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected[0]?.id).toBe("sato");
  });
});

describe("twosidesFitBonus", () => {
  it("declaration で+2.5、媒体3社以上ならさらに+0.5", () => {
    const c = candidate("sato", {
      title: "事務所が声明、本人は反論",
      category: "entertainment",
      evidence: evidence({ debatable: true, news: threeOutlets, debateType: "declaration" }),
    });
    expect(twosidesFitBonus(c, 3)).toBe(3);
  });

  it("debatable=falseならボーナス0", () => {
    const c = candidate("gossip", {
      title: "事務所が声明",
      category: "entertainment",
      evidence: evidence({ debatable: false, debateType: "declaration" }),
    });
    expect(twosidesFitBonus(c, 2)).toBe(0);
  });

  it("norm_flare は +1.0", () => {
    const c = candidate("flare", {
      title: "マナー論争",
      category: "society",
      evidence: evidence({ debateType: "norm_flare" }),
    });
    expect(twosidesFitBonus(c, 2)).toBe(1);
  });
});

describe("weightedPromoteScore", () => {
  it("debatable=falseはスコアを0.4倍に減点する", () => {
    expect(
      weightedPromoteScore(
        candidate("a", { evidence: evidence({ buzzScore: 5, debatable: true, debateType: "policy" }) }),
        2,
      ),
    ).toBeCloseTo(5.25);
    expect(
      weightedPromoteScore(
        candidate("b", { evidence: evidence({ buzzScore: 5, debatable: false, debateType: "policy" }) }),
        2,
      ),
    ).toBe(2);
  });

  it("媒体数が2未満だとoutletsFactorで比例減点される", () => {
    expect(
      weightedPromoteScore(candidate("a", { evidence: evidence({ buzzScore: 4, debateType: "policy" }) }), 1),
    ).toBeCloseTo(2.25);
    expect(
      weightedPromoteScore(candidate("b", { evidence: evidence({ buzzScore: 4, debateType: "policy" }) }), 0),
    ).toBeCloseTo(0.25);
  });

  it("媒体数2以上はoutletsFactor満点（3以上でも頭打ち）", () => {
    expect(
      weightedPromoteScore(candidate("a", { evidence: evidence({ buzzScore: 4, debateType: "policy" }) }), 2),
    ).toBeCloseTo(4.25);
    expect(
      weightedPromoteScore(candidate("b", { evidence: evidence({ buzzScore: 4, debateType: "policy" }) }), 5),
    ).toBeCloseTo(4.25);
  });

  it("声明対立はbuzz2でもbuzz4の一般候補を逆転できる", () => {
    const declaration = candidate("sato", {
      title: "事務所が声明を発表、本人は否定",
      category: "entertainment",
      evidence: evidence({ buzzScore: 2, debatable: true, news: threeOutlets, debateType: "declaration" }),
    });
    const plain = candidate("rate", {
      title: "日銀の政策金利",
      category: "finance",
      evidence: evidence({ buzzScore: 4, debatable: true, news: threeOutlets, debateType: "indicator" }),
    });
    expect(weightedPromoteScore(declaration, 3)).toBeGreaterThan(weightedPromoteScore(plain, 3));
  });

  it("鮮度減衰: 古い候補ほどスコアが下がる（updatedAt未指定は減衰なし＝後方互換）", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    const fresh = candidate("fresh", {
      evidence: evidence({ buzzScore: 4, debateType: "policy" }),
      updatedAt: new Date(now.getTime() - 1 * 3_600_000),
    });
    const stale = candidate("stale", {
      evidence: evidence({ buzzScore: 4, debateType: "policy" }),
      updatedAt: new Date(now.getTime() - 30 * 3_600_000),
    });
    const noUpdatedAt = candidate("none", { evidence: evidence({ buzzScore: 4, debateType: "policy" }) });

    expect(weightedPromoteScore(fresh, 2, now)).toBeGreaterThan(weightedPromoteScore(stale, 2, now));
    expect(weightedPromoteScore(fresh, 2, now)).toBe(weightedPromoteScore(noUpdatedAt, 2, now));
  });

  it("36時間以上経過しても0にはならない（下限0.5倍で残る）", () => {
    const now = new Date("2026-07-10T12:00:00Z");
    const veryStale = candidate("very-stale", {
      evidence: evidence({ buzzScore: 4, debateType: "policy" }),
      updatedAt: new Date(now.getTime() - 100 * 3_600_000),
    });
    expect(weightedPromoteScore(veryStale, 2, now)).toBeGreaterThan(0);
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
    expect(commentIntensityBonus(candidate("a", { evidence: evidence({}) }))).toBe(0);
  });

  it("1000件以上で+0.5、3000件以上で+1", () => {
    expect(commentIntensityBonus(candidate("a", { evidence: evidence({ commentCount: 1000 }) }))).toBe(0.5);
    expect(commentIntensityBonus(candidate("b", { evidence: evidence({ commentCount: 3000 }) }))).toBe(1);
    expect(commentIntensityBonus(candidate("c", { evidence: evidence({ commentCount: 999 }) }))).toBe(0);
  });

  it("commentCountSurgeは加点（急増中はより優先）", () => {
    const surging = candidate("a", {
      evidence: evidence({ commentCount: 1000, commentCountSurge: true }),
    });
    const steady = candidate("b", { evidence: evidence({ commentCount: 1000 }) });
    expect(commentIntensityBonus(surging)).toBeGreaterThan(commentIntensityBonus(steady));
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
      evidence: evidence({
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
      evidence: evidence({
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
