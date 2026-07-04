import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchShugiinBills, fetchSangiinBills } from "../diet";

afterEach(() => {
  vi.unstubAllGlobals();
});

// 実データ(smartnews-smri/house-of-representatives)の列構成を模したfixture
const SHUGIIN_HEADER = ["掲載回次", "キャプション", "種類", "提出回次", "番号", "議案件名", "審議状況"];
const SHUGIIN_ROWS = [
  SHUGIIN_HEADER,
  ["142", "衆法の一覧", "", "139", "18", "古い国会の法案", "成立", "経過", "https://old.example/1"],
  ["221", "決議の一覧", "", "221", "1", "予算委員長解任決議案", "否決", "経過", "https://new.example/1"],
  ["221", "内閣提出の一覧", "", "221", "5", "新しい法案", "審議中", "経過", "https://new.example/2"],
];

const SANGIIN_HEADER = [
  "審議回次", "種類", "提出回次", "提出番号", "件名", "議案URL",
];
const SANGIIN_ROWS = [
  SANGIIN_HEADER,
  ["153", "法律案", "153", "1", "古い国会の法案", "https://old.example/s1"],
  ["221", "法律案", "221", "1", "新しい参院法案", "https://new.example/s1"],
];

describe("fetchShugiinBills", () => {
  it("最新国会（最大の掲載回次）の議案だけを対象にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SHUGIIN_ROWS) }),
    );
    const items = await fetchShugiinBills();
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.title.includes("第221回"))).toBe(true);
    expect(items.some((i) => i.title.includes("古い国会の法案"))).toBe(false);
  });

  it("審議状況をタイトルに含める（状況変化で新イベント化させるため）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SHUGIIN_ROWS) }),
    );
    const items = await fetchShugiinBills();
    const target = items.find((i) => i.title.includes("予算委員長解任決議案"));
    expect(target?.title).toContain("否決");
  });

  it("fetch失敗時は空配列", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await fetchShugiinBills()).toEqual([]);
  });

  it("配列でないJSONが返っても空配列", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ not: "array" }) }),
    );
    expect(await fetchShugiinBills()).toEqual([]);
  });
});

describe("fetchSangiinBills", () => {
  it("最新国会の議案だけを対象にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SANGIIN_ROWS) }),
    );
    const items = await fetchSangiinBills();
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("新しい参院法案");
    expect(items[0].title).toContain("第221回");
  });

  it("議決情報が無い場合は「審議中」を補う", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(SANGIIN_ROWS) }),
    );
    const items = await fetchSangiinBills();
    expect(items[0].title).toContain("審議中");
  });
});
