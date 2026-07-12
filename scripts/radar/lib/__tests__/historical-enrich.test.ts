import { describe, expect, it } from "vitest";
import {
  buildHistoricalQueries,
  needsHistoricalEnrich,
  resolveReigniteFromSustained,
  shouldUseTimelineFirstMode,
} from "../historical-enrich";
import { isAttributedReportClaim, isTimelineWorthy } from "../../../../src/lib/radar-article";

describe("historical-enrich helpers", () => {
  it("geopolitics / イラン系トピックは historical enrich 対象", () => {
    expect(needsHistoricalEnrich({ debateType: "geopolitics", topic: "何か" })).toBe(true);
    expect(needsHistoricalEnrich({ topic: "イランのホルムズ海峡封鎖宣言" })).toBe(true);
    expect(needsHistoricalEnrich({ sustained: true, topic: "イラン情勢" })).toBe(true);
    expect(needsHistoricalEnrich({ topic: "厚生年金の受給額" })).toBe(false);
  });

  it("sustained → reignite は geopolitics/policy で連動", () => {
    expect(
      resolveReigniteFromSustained({ debateType: "geopolitics", sustained: true, reignite: false }),
    ).toBe(true);
    expect(resolveReigniteFromSustained({ debateType: "policy", sustained: true })).toBe(true);
    expect(resolveReigniteFromSustained({ debateType: "declaration", sustained: true })).toBe(false);
    expect(resolveReigniteFromSustained({ reignite: true })).toBe(true);
  });

  it("timeline-first は過去抜粋が十分かつ geopolitics/sustained", () => {
    expect(
      shouldUseTimelineFirstMode({ debateType: "geopolitics", datedExcerptCount: 5 }),
    ).toBe(true);
    expect(
      shouldUseTimelineFirstMode({ debateType: "geopolitics", datedExcerptCount: 1 }),
    ).toBe(false);
    expect(
      shouldUseTimelineFirstMode({ sustained: true, datedExcerptCount: 4 }),
    ).toBe(true);
  });

  it("historical queries に停戦・英語エンティティが含まれる", () => {
    const qs = buildHistoricalQueries("イランのホルムズ海峡封鎖");
    expect(qs.some((q) => q.includes("イラン"))).toBe(true);
    expect(qs.some((q) => /Iran|ceasefire|停戦|when:1y/i.test(q))).toBe(true);
  });
});

describe("timeline-first verification helpers", () => {
  it("帰属付き報道表現を検出する", () => {
    expect(isAttributedReportClaim("イランが封鎖を発表したと報じています")).toBe(true);
    expect(isAttributedReportClaim("ロイターによると海峡通行を認めていない")).toBe(true);
    expect(isAttributedReportClaim("イランは海峡を封鎖した")).toBe(false);
  });

  it("datedExcerptCount>=3 なら timeline worthy", () => {
    expect(isTimelineWorthy([], [], false, 3)).toBe(true);
    expect(isTimelineWorthy([], [], false, 0)).toBe(false);
  });
});
