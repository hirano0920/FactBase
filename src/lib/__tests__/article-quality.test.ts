import { describe, expect, it } from "vitest";
import {
  assessReportExcerptThickness,
  checkBulletsThickness,
  checkDuplicateFacts,
  checkIncidentFirst,
  enrichSummaryForDisplay,
  findStructureIssues,
  CLEAR_DECLARATION_BAD_HTML,
  CLEAR_DECLARATION_GOOD_HTML,
  MESSY_NORM_FLARE_GOOD_HTML,
  MESSY_POLICY_GOOD_HTML,
} from "@/lib/article-quality";

describe("checkIncidentFirst", () => {
  it("CLEAR_DECLARATION 悪い例: 否定先行で事件内容無し", () => {
    const issue = checkIncidentFirst(CLEAR_DECLARATION_BAD_HTML, { isReported: true });
    expect(issue?.reason).toBe("incident_first_missing");
  });

  it("CLEAR_DECLARATION 良い例: 接触・発言が先", () => {
    expect(checkIncidentFirst(CLEAR_DECLARATION_GOOD_HTML, { isReported: true })).toBeNull();
  });

  it("MESSY_POLICY（非対称な政策対立）も冒頭に具体があれば合格", () => {
    expect(checkIncidentFirst(MESSY_POLICY_GOOD_HTML, { isReported: false })).toBeNull();
  });

  it("MESSY_NORM_FLARE（声明の無い炎上）も行為が先なら合格", () => {
    expect(checkIncidentFirst(MESSY_NORM_FLARE_GOOD_HTML, { isReported: true })).toBeNull();
  });
});

describe("checkBulletsThickness", () => {
  it("メタ立場だけの両側は不合格", () => {
    const issue = checkBulletsThickness(
      [
        "報道の内容: 週刊文春がドラマ撮影中の身体的接触と楽屋での否定的な発言があったと報じたという内容です",
        "佐藤二朗さん側: 全面否定する立場",
        "週刊文春・報道側: 事実だとする立場",
      ],
      { isReported: true },
    );
    expect(issue?.reason).toBe("bullets_too_thin");
  });

  it("具体が入った bullets は合格", () => {
    expect(
      checkBulletsThickness(
        [
          "報道の内容: 週刊文春はドラマ撮影中の身体的接触と、楽屋でのキャリアに関する否定的な発言があったと報じた",
          "佐藤二朗さん側: 報道は創作であり、専門家確認でもハラスメントの定義に当たらないと主張している",
          "週刊文春・報道側: 複数の関係者取材に基づき、撮影中の接触と楽屋での発言があったとする",
        ],
        { isReported: true },
      ),
    ).toBeNull();
  });
});

describe("enrichSummaryForDisplay", () => {
  it("薄い1項目目を記事冒頭の具体で置き換える", () => {
    const enriched = enrichSummaryForDisplay(
      {
        lead: "短いlead",
        bullets: [
          "いま分かっていること: トラブルを巡る報道がある",
          "A側: 否定している",
          "B側: 事実だとしている",
        ],
        sources: [],
      },
      CLEAR_DECLARATION_GOOD_HTML,
    );
    expect(enriched.bullets[0]).toContain("接触");
  });
});

describe("checkDuplicateFacts", () => {
  it("良いCLEAR例は再掲が少ない", () => {
    expect(checkDuplicateFacts(CLEAR_DECLARATION_GOOD_HTML)).toBeNull();
  });
});

describe("findStructureIssues", () => {
  it("悪いCLEARは構造不合格", () => {
    const issues = findStructureIssues(
      {
        articleHtml: CLEAR_DECLARATION_BAD_HTML,
        bullets: ["いま分かっていること: 対立", "A: 否定", "B: 事実"],
      },
      { isReported: true },
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("良いMESSY政策は構造合格（きれいな二項でなくてよい）", () => {
    expect(
      findStructureIssues(
        {
          articleHtml: MESSY_POLICY_GOOD_HTML,
          bullets: [
            "いま分かっていること: 防衛費の引き上げ方針を閣議で決定したと政府が発表し、財源の国債依存が争点になっている",
            "賛成側が言うこと: 抑止に必要な装備更新が遅れており同盟国との負担是正が必要だと主張する",
            "反対側が言うこと: 国債増発と医療・教育予算とのトレードオフが説明不足だと指摘する",
          ],
        },
        { isReported: false },
      ),
    ).toEqual([]);
  });
});

describe("assessReportExcerptThickness", () => {
  it("抜粋0件は不合格", () => {
    expect(assessReportExcerptThickness([]).ok).toBe(false);
  });

  it("具体トークンと十分な量があれば合格", () => {
    const body =
      "週刊文春は、撮影中の身体的接触と楽屋でのキャリアに関する否定的な発言があったと報じた。".repeat(
        12,
      );
    expect(assessReportExcerptThickness([{ feed: "文春", text: body }]).ok).toBe(true);
  });
});
