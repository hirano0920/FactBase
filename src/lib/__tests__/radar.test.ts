import { describe, expect, it } from "vitest";
import {
  decidePublish,
  dedupKey,
  hotScore,
  clusterCoherence,
  COHERENCE_THRESHOLD,
  isOutOfScopeTopic,
  isBreakingNews,
  hasPrimarySource,
  shouldRegenerateFollowUp,
  type DecisionInput,
  type FollowUpAggregate,
} from "@/lib/radar";

const base: DecisionInput = {
  eventCount: 4,
  distinctFeeds: 3,
  minutesSinceLatest: 15,
  maxTrustWeight: 70,
  riskFlags: [],
  classification: "report",
  publishedToday: 0,
  dailyLimit: 8,
};

describe("decidePublish（Radar公開判断）", () => {
  it("報道のみの日常ネタは公開しない（一次情報なし）", () => {
    const d = decidePublish(base);
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("no_primary_source");
  });

  it("公式発表はOFFICIALで公開", () => {
    const d = decidePublish({ ...base, classification: "official" });
    if (d.action === "publish") expect(d.confirmation).toBe("OFFICIAL");
    expect(d.action).toBe("publish");
  });

  it("省庁フィード由来はOFFICIALで公開", () => {
    const d = decidePublish({
      ...base,
      classification: "report",
      feedNames: ["boj-whatsnew", "nhk-economy"],
    });
    expect(d.action).toBe("publish");
    if (d.action === "publish") expect(d.confirmation).toBe("OFFICIAL");
  });

  it("戦争・事件の速報はREPORTED（LIVE続報）で公開", () => {
    const d = decidePublish({
      ...base,
      classification: "incident",
      riskFlags: ["foreign_conflict"],
      clusterTitle: "中東で大規模空爆、複数国が声明",
    });
    expect(d.action).toBe("publish");
    if (d.action === "publish") expect(d.confirmation).toBe("REPORTED");
  });

  it("ハードブロック（未成年）はスコアが高くても必ずHELD", () => {
    const d = decidePublish({
      ...base,
      eventCount: 20,
      distinctFeeds: 8,
      riskFlags: ["minor"],
      classification: "official",
    });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("hard_block");
  });

  it.each([
    "private_individual",
    "sexual_crime",
    "minor",
    "suicide_or_victim",
    "discrimination",
    "unverified_crime_assertion",
  ])("ハードブロックフラグ %s は自動公開されない", (flag) => {
    const d = decidePublish({
      ...base,
      eventCount: 20,
      distinctFeeds: 8,
      riskFlags: [flag],
      classification: "official",
    });
    expect(d.action).toBe("hold");
  });

  it("単一媒体のスクープは公開しない（誤報対策）", () => {
    const d = decidePublish({ ...base, distinctFeeds: 1, classification: "scandal" });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("single_source");
  });

  it("単一媒体でも公式発表なら通る", () => {
    const d = decidePublish({ ...base, distinctFeeds: 1, classification: "official", maxTrustWeight: 100 });
    expect(d.action).toBe("publish");
  });

  it("日次上限到達後はHELDに落ちる（コスト暴走防止）", () => {
    const d = decidePublish({ ...base, classification: "official", publishedToday: 8, dailyLimit: 8 });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("daily_limit");
  });

  it("政治家疑惑だけでは公開しない（一次情報なし）", () => {
    const d = decidePublish({
      ...base,
      eventCount: 6,
      distinctFeeds: 4,
      riskFlags: ["named_politician_allegation"],
      classification: "scandal",
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("no_primary_source");
  });

  it("低熱量の話題はreject（ゴミスレ乱発防止）", () => {
    const d = decidePublish({
      ...base,
      eventCount: 2,
      distinctFeeds: 2,
      minutesSinceLatest: 300,
      maxTrustWeight: 40,
    });
    expect(d.action).toBe("reject");
  });

  it("スポーツ・エンタメフラグは却下", () => {
    const d = decidePublish({ ...base, riskFlags: ["sports_entertainment"] });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("out_of_scope");
  });
});

describe("isOutOfScopeTopic", () => {
  it("W杯・試合結果は対象外", () => {
    expect(isOutOfScopeTopic("日本対米国のW杯試合をどう見る？", ["Japan beat USA at World Cup"])).toBe(true);
  });

  it("はやぶさ・小惑星は対象外", () => {
    expect(
      isOutOfScopeTopic("はやぶさ2の小惑星接近をどう評価する？", ["はやぶさ2が小惑星に接近"]),
    ).toBe(true);
  });

  it("政策絡みのスポーツ予算は対象", () => {
    expect(
      isOutOfScopeTopic("スポーツ振興予算案", ["政府、スポーツ基本法改正案を閣議決定"]),
    ).toBe(false);
  });
});

describe("isBreakingNews / hasPrimarySource", () => {
  it("incident + foreign_conflict は速報", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: ["foreign_conflict"],
        clusterTitle: "ウクライナ東部で激戦",
      }),
    ).toBe(true);
  });

  it("古い incident は速報扱いしない", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        minutesSinceLatest: 500,
        riskFlags: ["foreign_conflict"],
      }),
    ).toBe(false);
  });

  it("boj フィードは一次情報", () => {
    expect(hasPrimarySource({ ...base, feedNames: ["boj-whatsnew"] })).toBe(true);
  });
});

describe("hotScore", () => {
  it("直近・多媒体ほど高い", () => {
    const hotNow = hotScore({ ...base, minutesSinceLatest: 5 });
    const hotOld = hotScore({ ...base, minutesSinceLatest: 300 });
    expect(hotNow).toBeGreaterThan(hotOld);
  });
});

describe("dedupKey", () => {
  it("表記ゆれを吸収して同一キーになる", () => {
    expect(dedupKey("「消費税減税」を巡る議論、活発化")).toBe(
      dedupKey("消費税減税を巡る議論 活発化"),
    );
  });
});

describe("clusterCoherence（nanoクラスタリングの誤結合検出）", () => {
  it("同じ出来事を報じた見出し群は高い類似度になる", () => {
    const titles = [
      "消費税減税法案、衆院で可決へ",
      "消費税減税法案が衆院通過 与野党の攻防続く",
      "衆院、消費税減税法案を可決",
    ];
    expect(clusterCoherence(titles)).toBeGreaterThanOrEqual(COHERENCE_THRESHOLD);
  });

  it("無関係な見出しの寄せ集めは低い類似度になる", () => {
    const titles = [
      "消費税減税法案、衆院で可決へ",
      "大谷翔平が今季30号本塁打",
      "北海道で震度4の地震",
    ];
    expect(clusterCoherence(titles)).toBeLessThan(COHERENCE_THRESHOLD);
  });

  it("単一タイトルは比較不能として通す（1.0）", () => {
    expect(clusterCoherence(["単独の見出し"])).toBe(1);
  });

  it("空配列は1を返す", () => {
    expect(clusterCoherence([])).toBe(1);
  });
});

describe("shouldRegenerateFollowUp（続報再生成の頻度ゲート）", () => {
  const now = new Date("2026-07-05T12:00:00Z");

  const reportedBase: FollowUpAggregate = {
    confirmation: "REPORTED",
    articleGeneratedAt: new Date("2026-07-05T11:00:00Z"), // 60分前
    newEventCount: 1,
    newDistinctFeeds: 1,
    maxNewTrustWeight: 50,
  };

  it("新着イベントが0件なら再生成しない", () => {
    expect(shouldRegenerateFollowUp({ ...reportedBase, newEventCount: 0, newDistinctFeeds: 0 }, now)).toBe(
      false,
    );
  });

  it("REPORTED: 新着1媒体以上・30分以上経過で再生成する", () => {
    expect(shouldRegenerateFollowUp(reportedBase, now)).toBe(true);
  });

  it("REPORTED: 30分未満なら再生成しない（ちょうど29分は不可）", () => {
    const recent = { ...reportedBase, articleGeneratedAt: new Date("2026-07-05T11:31:00Z") };
    expect(shouldRegenerateFollowUp(recent, now)).toBe(false);
  });

  it("REPORTED: ちょうど30分は再生成する（境界値）", () => {
    const exact = { ...reportedBase, articleGeneratedAt: new Date("2026-07-05T11:30:00Z") };
    expect(shouldRegenerateFollowUp(exact, now)).toBe(true);
  });

  const officialBase: FollowUpAggregate = {
    confirmation: "OFFICIAL",
    articleGeneratedAt: new Date("2026-07-05T09:00:00Z"), // 3時間前
    newEventCount: 1,
    newDistinctFeeds: 1,
    maxNewTrustWeight: 90,
  };

  it("OFFICIAL: 一次情報級の新着(trust>=85)・2時間以上経過で再生成する", () => {
    expect(shouldRegenerateFollowUp(officialBase, now)).toBe(true);
  });

  it("OFFICIAL: 新着が一次情報級でなければ再生成しない", () => {
    expect(shouldRegenerateFollowUp({ ...officialBase, maxNewTrustWeight: 60 }, now)).toBe(false);
  });

  it("OFFICIAL: 2時間未満なら一次情報級でも再生成しない", () => {
    const recent = { ...officialBase, articleGeneratedAt: new Date("2026-07-05T11:00:00Z") };
    expect(shouldRegenerateFollowUp(recent, now)).toBe(false);
  });

  it("MANUAL争点は対象外", () => {
    expect(shouldRegenerateFollowUp({ ...reportedBase, confirmation: "MANUAL" }, now)).toBe(false);
  });
});
