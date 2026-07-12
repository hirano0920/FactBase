import { describe, expect, it } from "vitest";
import {
  assessReportExcerptThickness,
  checkDuplicateFacts,
  checkIncidentFirst,
  findStructureIssues,
  SATO_STYLE_BAD_HTML,
  SATO_STYLE_GOOD_HTML,
} from "@/lib/article-quality";

describe("checkIncidentFirst（佐藤二朗スタイル・ゴールデン）", () => {
  it("悪い例: 否定が先で事件内容が無い → incident_first_missing", () => {
    const issue = checkIncidentFirst(SATO_STYLE_BAD_HTML, { isReported: true });
    expect(issue?.reason).toBe("incident_first_missing");
    expect(issue?.message).toContain("具体内容");
  });

  it("良い例: 接触・発言が先で否定が後 → 合格", () => {
    expect(checkIncidentFirst(SATO_STYLE_GOOD_HTML, { isReported: true })).toBeNull();
  });

  it("冒頭見出しが無い旧形式HTMLはスキップ", () => {
    expect(checkIncidentFirst("<h2>ポイント</h2><p>短い</p>", { isReported: true })).toBeNull();
  });
});

describe("checkDuplicateFacts", () => {
  it("良い例は冒頭と各社で事実の再掲が少ない", () => {
    expect(checkDuplicateFacts(SATO_STYLE_GOOD_HTML)).toBeNull();
  });

  it("冒頭と同じ長文を各社にコピーすると不合格", () => {
    const opening =
      "週刊文春は撮影中の身体的接触と楽屋でのキャリア否定発言があったと報じています。これは重複検出用の十分に長い具体文です。";
    const html = `<h2>いま何が論点か</h2><p>${opening}</p>
<h2>各社は何を伝えているか</h2><ul><li>${opening}</li></ul>`;
    const issue = checkDuplicateFacts(html);
    expect(issue?.reason).toBe("duplicate_facts");
  });
});

describe("findStructureIssues", () => {
  it("悪いゴールデンは構造不合格を返す", () => {
    const issues = findStructureIssues(
      { articleHtml: SATO_STYLE_BAD_HTML, lead: "短い" },
      { isReported: true },
    );
    expect(issues.some((i) => i.reason === "incident_first_missing")).toBe(true);
  });

  it("良いゴールデンは構造合格", () => {
    expect(
      findStructureIssues({ articleHtml: SATO_STYLE_GOOD_HTML }, { isReported: true }),
    ).toEqual([]);
  });
});

describe("assessReportExcerptThickness", () => {
  it("抜粋0件は不合格", () => {
    expect(assessReportExcerptThickness([]).ok).toBe(false);
  });

  it("短い抽象文だけは不合格", () => {
    const r = assessReportExcerptThickness([
      { feed: "A", text: "芸能人のトラブルをめぐる報道が話題になっています。".repeat(5) },
    ]);
    expect(r.ok).toBe(false);
  });

  it("具体トークンと十分な量があれば合格", () => {
    const body =
      "週刊文春は、撮影中の身体的接触と楽屋でのキャリアに関する否定的な発言があったと報じた。".repeat(
        12,
      );
    const r = assessReportExcerptThickness([{ feed: "文春", text: body }]);
    expect(r.ok).toBe(true);
    expect(r.concreteSignalCount).toBeGreaterThanOrEqual(1);
  });
});
