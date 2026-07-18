import { describe, expect, it } from "vitest";
import { resolveIssueTrack, trackLabel, parseIssueTrack } from "../issue-track";

describe("resolveIssueTrack", () => {
  it("debatable=falseは即News", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        debatable: false,
        commentFrictionScore: 0.9,
      }),
    ).toBe("news");
  });

  it("強い両論シグナル＋legitimate → Debate", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        commentFrictionScore: 0.4,
        claimDiffConflictCount: 2,
      }),
    ).toBe("debate");
  });

  it("キオクシア型（stock_crash・摩擦薄い）→ News", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "stock_crash",
        commentFrictionScore: 0.05,
        claimDiffConflictCount: 0,
      }),
    ).toBe("news");
  });

  it("Legitimacy不合格 → News（HELDしない）", () => {
    expect(
      resolveIssueTrack({
        legitimate: false,
        topicClass: "politics",
      }),
    ).toBe("news");
  });

  it("corporateで摩擦薄い → News", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "corporate",
        commentFrictionScore: 0.1,
      }),
    ).toBe("news");
  });

  it("legitimateで摩擦あり・一般政治 → Debate", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "politics",
        externalPollDivision: 0.3,
      }),
    ).toBe("debate");
  });
});

describe("track helpers", () => {
  it("trackLabel", () => {
    expect(trackLabel("news")).toBe("News");
    expect(trackLabel("debate")).toBe("Debate");
  });

  it("parseIssueTrack", () => {
    expect(parseIssueTrack("NEWS")).toBe("news");
    expect(parseIssueTrack("DEBATE")).toBe("debate");
    expect(parseIssueTrack(null)).toBe("debate");
  });
});
