import { describe, expect, it } from "vitest";
import { buildClaimDiff, formatClaimDiffBlock, EMPTY_CLAIM_DIFF } from "../claim-diff";

describe("buildClaimDiff", () => {
  it("抜粋が2件未満なら空diffを返しnano呼び出しをスキップする", async () => {
    expect(await buildClaimDiff([])).toEqual(EMPTY_CLAIM_DIFF);
    expect(await buildClaimDiff([{ feed: "A社", title: "t", text: "text" }])).toEqual(EMPTY_CLAIM_DIFF);
  });

  it("媒体が1社しかない場合（同一媒体の複数記事）も空diffを返す", async () => {
    const result = await buildClaimDiff([
      { feed: "A社", title: "t1", text: "text1" },
      { feed: "A社", title: "t2", text: "text2" },
    ]);
    expect(result).toEqual(EMPTY_CLAIM_DIFF);
  });
});

describe("formatClaimDiffBlock", () => {
  it("3カテゴリすべて空なら空文字を返す（プロンプトに何も追加しない）", () => {
    expect(formatClaimDiffBlock(EMPTY_CLAIM_DIFF)).toBe("");
  });

  it("各社共通・食い違い・単独媒体をセクションとして整形する", () => {
    const block = formatClaimDiffBlock({
      agreements: ["首相が会見で謝罪した"],
      conflicts: ["A社は辞任を否定と報じる一方、B社は辞任検討中と報じる"],
      outletOnly: [{ outlet: "C社", claim: "韓国の類似事例" }],
    });
    expect(block).toContain("各社共通");
    expect(block).toContain("首相が会見で謝罪した");
    expect(block).toContain("媒体間で食い違い");
    expect(block).toContain("辞任を否定");
    expect(block).toContain("特定媒体限定");
    expect(block).toContain("[C社] 韓国の類似事例");
  });

  it("outletOnlyのみでも整形される（食い違い判定の前段として単独主張だけ検出されるケース）", () => {
    const block = formatClaimDiffBlock({
      agreements: [],
      conflicts: [],
      outletOnly: [{ outlet: "D社", claim: "未確認情報" }],
    });
    expect(block).toContain("D社");
    expect(block).not.toContain("各社共通:\n");
  });
});
