import { describe, expect, it } from "vitest";
import { evaluatePromotionCandidate } from "@/lib/radar-pipeline-inspect";

describe("evaluatePromotionCandidate", () => {
  const freshSince = new Date(Date.now() - 36 * 60 * 60_000);

  it("buzzScore不足を理由付けで返す", () => {
    const row = {
      id: "1",
      title: "テスト",
      topicTerm: "テスト",
      status: "PENDING",
      discoverySource: "buzz",
      issueId: null,
      updatedAt: new Date(),
      evidenceJson: {
        buzzScore: 1,
        buzzSources: ["google_trends"],
        dietSpeeches: [],
        laws: [],
        news: [
          { title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
          { title: "B", source: "朝日", url: "https://b", pubDate: "", region: "domestic" },
        ],
        internationalNews: [],
        background: null,
        officialEvents: [],
      },
    };
    const ev = evaluatePromotionCandidate(row, {
      minBuzzScore: 2,
      freshSince,
      selectedIds: new Set(),
      eligibleRank: new Map(),
    });
    expect(ev.skipReason).toBe("buzz_score_low");
    expect(ev.wouldSelect).toBe(false);
  });

  it("条件を満たし selectedIds に含まれると would_publish", () => {
    const row = {
      id: "ok",
      title: "テスト",
      topicTerm: "テスト",
      status: "PENDING",
      discoverySource: "buzz",
      issueId: null,
      updatedAt: new Date(),
      evidenceJson: {
        buzzScore: 3,
        buzzSources: ["google_trends", "yahoo_realtime"],
        dietSpeeches: [],
        laws: [],
        news: [
          { title: "A", source: "産経", url: "https://a", pubDate: "", region: "domestic" },
          { title: "B", source: "朝日", url: "https://b", pubDate: "", region: "domestic" },
        ],
        internationalNews: [],
        background: null,
        officialEvents: [],
      },
    };
    const ev = evaluatePromotionCandidate(row, {
      minBuzzScore: 2,
      freshSince,
      selectedIds: new Set(["ok"]),
      eligibleRank: new Map([["ok", 1]]),
    });
    expect(ev.skipReason).toBe("would_publish");
    expect(ev.wouldSelect).toBe(true);
  });
});
