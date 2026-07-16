import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ judgeIssueTitleQuality: vi.fn() }));
vi.mock("../../../../src/lib/ai", () => ({
  composeIssueTitle: vi.fn(),
  judgeIssueTitleQuality: mocks.judgeIssueTitleQuality,
}));

import {
  deriveIssueTitle,
  fallbackIssueTitle,
  isAbstractIssueTitle,
  isDullIssueTitle,
  isMonotonousQuestion,
  isMostlyEnglish,
  isVagueIssueTitle,
  pickBestIssueTitle,
} from "../issue-title";

beforeEach(() => {
  vi.clearAllMocks();
});

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

  it("政策ジャーゴンが無くても、フックが無ければ dull（旧実装はCONCRETE_SIGNAL前提でこれをすり抜けていた）", () => {
    expect(isDullIssueTitle("被災対応は適切だと思いますか？")).toBe(true);
  });

  it("具体的な被害・決壊等の語があれば、生活影響ワードが無くても dull ではない", () => {
    expect(isDullIssueTitle("中国南部台風被害でダム決壊、被災対応の適否は？")).toBe(false);
  });

  it("人権・抗議等、生活/お金以外のフックでも dull ではない", () => {
    expect(isDullIssueTitle("国旗損壊罪法案、表現の自由をめぐる議論—塩村・鬼木両議員は追及")).toBe(false);
    expect(isDullIssueTitle("国会前デモ2万7千人、高市政権に抗議 参加者は何を訴えたのか？")).toBe(false);
  });

  it("生活影響が無くても「一転」等の展開の劇的さフックがあれば dull ではない（短文でも）", () => {
    expect(isDullIssueTitle("絶賛から一転、学位取消しへ")).toBe(false);
    expect(isDullIssueTitle("一転して学位取消し、大学の説明は二転三転")).toBe(false);
  });
});

describe("isMonotonousQuestion / isMostlyEnglish", () => {
  it("あなたはどう見る？だけの設問は単調", () => {
    expect(isMonotonousQuestion("入管法改正、あなたはどう見る？")).toBe(true);
  });

  it("「自分が〜なら」「私が〜なら」等の空虚な仮定フックは単調（当事者性の見せかけ）", () => {
    expect(isMonotonousQuestion("中国作家の論文盗用で学位剥奪—自分が学生ならどう感じる？")).toBe(true);
    expect(isMonotonousQuestion("詐欺疑惑企業のCM放映、私が被害者なら許される？")).toBe(true);
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

describe("ISSUE_TITLE_PROMPTの10パターン例文は全てdull/monotonousを通過する", () => {
  const goodExamples = [
    "日銀利上げ、住宅ローン負担は増える？",
    "一転して学位取消し、大学の説明は二転三転",
    "厚生年金15万円超は何世帯？老後資金への影響",
    "絶賛から一転、学位取消しへ",
    "『増税ではない』、首相答弁に食い違いの指摘",
    "ホルムズ海峡封鎖、イランと米の言い分どちらが妥当？",
    "国会前デモ2万7千人、何を訴えたのか",
    "解雇は無効と判断、企業への影響は",
    "最低賃金、G7で最下位級——なぜ上がらない",
    "堤防決壊のおそれ、避難情報の見方",
    // 2026-07-15: composeIssueTitleの実ライブ生成で確認した実例（当初dull誤判定だった戦争被害系の穴を修正）
    "国連、民間人死者293人、長距離攻撃の正当化に疑問",
    "宮崎麗果、脱税約1億5700万円で有罪判決 妥当性は？",
  ];

  it.each(goodExamples)("%s は dull でも monotonous でもない", (title) => {
    expect(isDullIssueTitle(title)).toBe(false);
    expect(isMonotonousQuestion(title)).toBe(false);
  });
});

describe("pickBestIssueTitle", () => {
  it("空虚な仮定フックの案を除外し、残りをnano選抜に回す", async () => {
    mocks.judgeIssueTitleQuality.mockResolvedValue({
      best: "一転して学位取消し、大学の説明は二転三転",
      reason: "具体的で自然",
    });
    const picked = await pickBestIssueTitle([
      "中国作家の論文盗用で学位剥奪—自分が学生ならどう感じる？", // 空虚な仮定フックで除外される
      "一転して学位取消し、大学の説明は二転三転",
      "学位取消しが一夜で決定——大学の説明は二転三転",
    ]);
    expect(picked).toBe("一転して学位取消し、大学の説明は二転三転");
    expect(mocks.judgeIssueTitleQuality).toHaveBeenCalledOnce();
    const passedCandidates = mocks.judgeIssueTitleQuality.mock.calls[0][0];
    expect(passedCandidates).toHaveLength(2);
    expect(passedCandidates).not.toContain(
      "中国作家の論文盗用で学位剥奪—自分が学生ならどう感じる？",
    );
  });

  it("1件しか通過しなければnano呼び出しをせずそのまま返す", async () => {
    const picked = await pickBestIssueTitle([
      "詐欺疑惑企業のCM放映、私が被害者なら許される？", // 空虚な仮定フックで除外
      "厚生年金15万円超は何世帯？老後資金への影響",
    ]);
    expect(picked).toBe("厚生年金15万円超は何世帯？老後資金への影響");
    expect(mocks.judgeIssueTitleQuality).not.toHaveBeenCalled();
  });

  it("全滅すればnullを返す（呼び出し側のフォールバックに委ねる）", async () => {
    const picked = await pickBestIssueTitle([
      "詐欺疑惑企業のCM放映、私が被害者なら許される？",
      "中国作家の論文盗用で学位剥奪—自分が学生ならどう感じる？",
    ]);
    expect(picked).toBeNull();
  });
});
