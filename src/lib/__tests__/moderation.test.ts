import { describe, expect, it } from "vitest";
import { moderateOnSubmit } from "@/lib/moderation";

const validBody = (extra = "") =>
  `消費税の一時的な引き下げについて、財源の内訳が国会で十分に説明されているかを確認したいと考えています。${extra}`;

describe("moderateOnSubmit", () => {
  it("50字以上500字以内の通常コメントを許可する", () => {
    expect(moderateOnSubmit(validBody())).toEqual({ allowed: true });
  });

  it("50字未満を拒否する", () => {
    const result = moderateOnSubmit("短すぎるコメント");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("TOO_SHORT");
  });

  it("500字超を拒否する", () => {
    const result = moderateOnSubmit("あ".repeat(501));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("TOO_LONG");
  });

  it("暴力表現を拒否する", () => {
    const result = moderateOnSubmit(validBody("こんな政治家は死ね。"));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("ABUSE");
  });

  it("侮辱表現（複合形）を拒否する", () => {
    const result = moderateOnSubmit(validBody("賛成派はバカ共だ。"));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("INSULT");
  });

  it("NGワード（伏せ字）を拒否する", () => {
    const result = moderateOnSubmit(validBody("氏ねと思う。"));
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("NG_WORD");
  });

  it("リンク3つ以上のスパムを拒否する", () => {
    const result = moderateOnSubmit(
      validBody("https://a.example https://b.example https://c.example"),
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("SPAM");
  });

  it("政治的意見そのものは立場を問わず許可する", () => {
    expect(
      moderateOnSubmit(
        "この法案には明確に反対です。財源の説明が不十分であり、将来世代への負担の先送りになると考えるためです。",
      ),
    ).toEqual({ allowed: true });
  });
});
