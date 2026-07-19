import { describe, expect, it } from "vitest";
import {
  isNewsishTopicClass,
  resolveIssueTrack,
  trackLabel,
  parseIssueTrack,
} from "../issue-track";

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

  it("キオクシア型: stock_crash + 高摩擦でもNews（摩擦だけではDebateにしない）", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "stock_crash",
        commentFrictionScore: 0.51,
        claimDiffConflictCount: 1,
        hasRealExternalPoll: false,
      }),
    ).toBe("news");
  });

  it("iPhone値上げ型: consumer_price → News", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "consumer_price",
        commentFrictionScore: 0.36,
        hasRealExternalPoll: false,
      }),
    ).toBe("news");
  });

  it("利益相反型: fact_scandal → News", () => {
    expect(
      resolveIssueTrack({
        legitimate: false,
        topicClass: "fact_scandal",
        commentFrictionScore: 0.13,
      }),
    ).toBe("news");
  });

  it("newsishでもYahoo実測投票が割れていればDebate可", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "stock_crash",
        hasRealExternalPoll: true,
        externalPollDivision: 0.4,
      }),
    ).toBe("debate");
  });

  it("強い両論シグナル＋legitimate・一般政治 → Debate", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "politics",
        commentFrictionScore: 0.4,
        claimDiffConflictCount: 2,
      }),
    ).toBe("debate");
  });

  it("国旗損壊罪(legal) + 摩擦 → Debate", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "legal",
        commentFrictionScore: 0.38,
      }),
    ).toBe("debate");
  });

  it("Legitimacy不合格 → News（HELDしない）", () => {
    expect(
      resolveIssueTrack({
        legitimate: false,
        topicClass: "politics",
      }),
    ).toBe("news");
  });

  it("corporateで摩擦薄くてもNews", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "corporate",
        commentFrictionScore: 0.1,
      }),
    ).toBe("news");
  });

  it("ウクライナAIドローン(war_tech_foreign) → News", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "war_tech_foreign",
        commentFrictionScore: 0.4,
      }),
    ).toBe("news");
  });

  it("懸賞金(foreign_spectacle) → News", () => {
    expect(
      resolveIssueTrack({
        legitimate: true,
        topicClass: "foreign_spectacle",
        commentFrictionScore: 0.3,
      }),
    ).toBe("news");
  });
});

describe("isNewsishTopicClass", () => {
  it("newsishクラスを判定", () => {
    expect(isNewsishTopicClass("stock_crash")).toBe(true);
    expect(isNewsishTopicClass("consumer_price")).toBe(true);
    expect(isNewsishTopicClass("fact_scandal")).toBe(true);
    expect(isNewsishTopicClass("legal")).toBe(false);
    expect(isNewsishTopicClass("politics")).toBe(false);
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
