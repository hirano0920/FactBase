import { describe, expect, it } from "vitest";
import {
  deriveIssueTitle,
  fallbackIssueTitle,
  isAbstractIssueTitle,
  isDullIssueTitle,
  isMonotonousQuestion,
  isMostlyEnglish,
  isVagueIssueTitle,
} from "../issue-title";

describe("isVagueIssueTitle / isAbstractIssueTitle / isDullIssueTitle", () => {
  it("EU公式発表のような抽象タイトルは vague", () => {
    expect(isVagueIssueTitle("EU公式発表をどう受け止める？あなたはどう見る？")).toBe(true);
  });

  it("中身のない声明＋妥当問いは abstract", () => {
    expect(isAbstractIssueTitle("EUのエネルギー政策声明、妥当だと思いますか？")).toBe(true);
  });

  it("正確だが自分ごとフックが無い wire 見出しは dull", () => {
    expect(isDullIssueTitle("EU、2030年までに再エネ50%目標を表明——支持？")).toBe(true);
  });

  it("出来事＋生活への影響があれば dull ではない", () => {
    expect(isDullIssueTitle("欧州の再エネ半分宣言——日本の電気代に波及？")).toBe(false);
    expect(isDullIssueTitle("日銀利上げ、住宅ローン負担は増える？")).toBe(false);
  });
});

describe("isMonotonousQuestion / isMostlyEnglish", () => {
  it("あなたはどう見る？だけの設問は単調", () => {
    expect(isMonotonousQuestion("入管法改正、あなたはどう見る？")).toBe(true);
  });

  it("英語見出しは mostly English", () => {
    expect(isMostlyEnglish("Opening statement by Commissioner Dombrovskis")).toBe(true);
  });
});

describe("fallbackIssueTitle", () => {
  it("英語見出しだけでは具体タイトルを作れず null", () => {
    expect(
      fallbackIssueTitle({
        question: "EU公式発表をどう受け止める？あなたはどう見る？",
        clusterTitle: "EU委員会の声明",
        confirmation: "OFFICIAL",
        classification: "official",
        category: "international",
        sources: [
          {
            feed: "eu-commission",
            title: "Opening statement by Commissioner Dombrovskis on energy policy",
          },
        ],
      }),
    ).toBeNull();
  });
});

describe("deriveIssueTitle（同期・APIなし）", () => {
  it("自分ごとフック付きの日本語タイトルはそのまま使う", () => {
    expect(
      deriveIssueTitle({
        question: "日銀利上げ、住宅ローン負担は増える？",
        clusterTitle: "日銀金融政策",
        confirmation: "OFFICIAL",
        sources: [],
      }),
    ).toBe("日銀利上げ、住宅ローン負担は増える？");
  });

  it("dull な設問は null（compose に回す）", () => {
    expect(
      deriveIssueTitle({
        question: "EU、2030年再エネ50%目標を表明——支持？",
        clusterTitle: "EUエネルギー",
        confirmation: "OFFICIAL",
        sources: [],
      }),
    ).toBeNull();
  });
});
