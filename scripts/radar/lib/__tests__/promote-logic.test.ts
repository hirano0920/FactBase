import { describe, expect, it } from "vitest";
import {
  selectTopicsForPromotion,
  findDuplicateActiveIssue,
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
  };
  return { ...base, ...overrides };
}

describe("selectTopicsForPromotion", () => {
  const sufficientNews: EvidenceBundle["news"] = [
    { title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
    { title: "B", source: "朝日", url: "https://b", pubDate: "", region: "domestic" },
  ];

  const threeOutlets: EvidenceBundle["news"] = [
    { title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
    { title: "B", source: "朝日", url: "https://b", pubDate: "", region: "domestic" },
    { title: "C", source: "毎日", url: "https://c", pubDate: "", region: "domestic" },
  ];

  it("media consensus: バズ前でも3媒体以上の一致があれば引き取り候補を公開する", () => {
    const candidates: PromotionCandidate[] = [
      // buzzScore0だが mediaConsensus かつ 3媒体 → 通す
      { id: "carry", title: "引き取り", category: null, topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 0, news: threeOutlets, mediaConsensus: true }) },
      // mediaConsensusでも2媒体どまり（CONSENSUS_MIN_OUTLETS未満）→ 落とす
      { id: "weak", title: "媒体不足", category: null, topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 0, news: sufficientNews, mediaConsensus: true }) },
      // consensusフラグ無しの低buzzは従来通り落とす
      { id: "plain", title: "低buzz", category: null, topicTerm: null, sourceUrls: [], evidence: evidence({ buzzScore: 0, news: threeOutlets }) },
    ];
    const selected = selectTopicsForPromotion(candidates, 2, 3);
    expect(selected.map((c) => c.id)).toEqual(["carry"]);
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
