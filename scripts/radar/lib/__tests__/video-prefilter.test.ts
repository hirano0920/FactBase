import { describe, expect, it } from "vitest";
import { isObviousNonDebateVideoTitle } from "../video-prefilter";

describe("isObviousNonDebateVideoTitle", () => {
  it("実際にGemini解析でexclude判定されたタイトルを弾く", () => {
    expect(
      isObviousNonDebateVideoTitle(
        "「年上女性に甘えたい…」蘭丸が特殊性癖を告白！？婚前交渉はアリ？専業主婦は甘え？男女関係の悩みに物申す",
      ),
    ).toBe(true);
    expect(
      isObviousNonDebateVideoTitle(
        "「K-POPアイドルの細さは異常…」病的な”痩せブーム”に警告！痩せ薬でガリガリ",
      ),
    ).toBe(true);
    expect(isObviousNonDebateVideoTitle("東大女子は本当にモテない？本音激白")).toBe(true);
  });

  it("実在の法律名を絡めた性風俗タブロイド企画（法律名があるので一見公共的に見える）も弾く", () => {
    expect(
      isObviousNonDebateVideoTitle(
        "「AV女優に憧れるのは危険すぎ…」性で稼ぐのはアリ？風営法改正の中、過激化する”男女ビジネス”の現実",
      ),
    ).toBe(true);
  });

  it("政治・経済・社会問題のタイトルは弾かない", () => {
    expect(isObviousNonDebateVideoTitle("国旗損壊罪成立、表現の自由との兼ね合いは")).toBe(false);
    expect(isObviousNonDebateVideoTitle("財務省に大反論！減税で増収できる？名古屋市を見よ")).toBe(
      false,
    );
    expect(
      isObviousNonDebateVideoTitle("やまゆり園事件で19人殺害…真相解明のため？意義を考える"),
    ).toBe(false);
  });
});
