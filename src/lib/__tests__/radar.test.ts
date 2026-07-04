import { describe, expect, it } from "vitest";
import {
  decidePublish,
  dedupKey,
  hotScore,
  clusterCoherence,
  COHERENCE_THRESHOLD,
  type DecisionInput,
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
  it("複数媒体・高信頼・低リスクは自動公開（報道ベースラベル）", () => {
    const d = decidePublish(base);
    expect(d.action).toBe("publish");
    if (d.action === "publish") expect(d.confirmation).toBe("REPORTED");
  });

  it("公式発表はOFFICIALで公開", () => {
    const d = decidePublish({ ...base, classification: "official" });
    if (d.action === "publish") expect(d.confirmation).toBe("OFFICIAL");
    expect(d.action).toBe("publish");
  });

  it("ハードブロック（未成年）はスコアが高くても必ずHELD", () => {
    const d = decidePublish({
      ...base,
      eventCount: 20,
      distinctFeeds: 8,
      riskFlags: ["minor"],
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
    const d = decidePublish({ ...base, eventCount: 20, distinctFeeds: 8, riskFlags: [flag] });
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
    const d = decidePublish({ ...base, publishedToday: 8, dailyLimit: 8 });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("daily_limit");
  });

  it("政治家疑惑（named_politician_allegation）は減点されつつ公開可能", () => {
    const d = decidePublish({
      ...base,
      eventCount: 6,
      distinctFeeds: 4,
      riskFlags: ["named_politician_allegation"],
      classification: "scandal",
    });
    expect(d.action).toBe("publish");
    if (d.action === "publish") expect(d.confirmation).toBe("REPORTED"); // 疑惑は必ず報道ベース
  });

  it("低熱量の話題はreject（ゴミスレ立て防止）", () => {
    const d = decidePublish({
      ...base,
      eventCount: 2,
      distinctFeeds: 2,
      minutesSinceLatest: 300,
      maxTrustWeight: 40,
    });
    expect(d.action).toBe("reject");
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
