import { describe, expect, it } from "vitest";
import { json3ToText } from "../abema-transcript";

describe("json3ToText", () => {
  it("events/segsからテキストを連結する", () => {
    const data = {
      events: [
        { segs: [{ utf8: "こんにちは" }] },
        { segs: [{ utf8: "、世界" }, { utf8: "。\n" }] },
      ],
    };
    expect(json3ToText(data)).toBe("こんにちは、世界。");
  });

  it("segsが無いイベントは無視する", () => {
    const data = { events: [{}, { segs: [{ utf8: "テスト" }] }] };
    expect(json3ToText(data)).toBe("テスト");
  });

  it("eventsが空なら空文字", () => {
    expect(json3ToText({ events: [] })).toBe("");
    expect(json3ToText({})).toBe("");
  });

  it("連続する改行を1つに畳む", () => {
    const data = { events: [{ segs: [{ utf8: "A\n\n\nB" }] }] };
    expect(json3ToText(data)).toBe("A\nB");
  });
});
