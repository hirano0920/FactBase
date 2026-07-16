import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractYahooPollListEntries,
  fetchRecentYahooPolls,
  fetchYahooPollDetail,
  computeDivisionScore,
  matchYahooPoll,
} from "../yahoo-polls";

const LIST_HTML = `<li><a href="https://news.yahoo.co.jp/polls/67570" data-x="1"><div><p class="sc-xd4tjb-3 dPxkJo">日本の金利政策について、どのように考えますか？</p></div></a></li>
<li><a href="https://news.yahoo.co.jp/polls/67705" data-x="2"><div><p class="sc-19vdvrv-0 iPgIOb">高市政権の国会運営に、最も期待する姿勢は何ですか？</p></div></a></li>`;

const DETAIL_HTML = `<script>{"question":"x","choices":[{"choice":"利上げが必要だと思う","count":720,"percent":72.9,"value":1},{"choice":"現状維持が良いと思う","count":90,"percent":9.1,"value":2},{"choice":"利下げが必要だと思う","count":153,"percent":15.5,"value":3},{"choice":"分からない","count":25,"percent":2.5,"value":4}]}</script>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractYahooPollListEntries", () => {
  it("設問一覧からurl/questionペアを抽出する", () => {
    expect(extractYahooPollListEntries(LIST_HTML)).toEqual([
      { url: "https://news.yahoo.co.jp/polls/67570", question: "日本の金利政策について、どのように考えますか？" },
      { url: "https://news.yahoo.co.jp/polls/67705", question: "高市政権の国会運営に、最も期待する姿勢は何ですか？" },
    ]);
  });

  it("マッチしない場合は空配列を返す", () => {
    expect(extractYahooPollListEntries("<html></html>")).toEqual([]);
  });
});

describe("fetchRecentYahooPolls", () => {
  it("複数ページを取得し重複を除いて集約する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(LIST_HTML) }));
    const entries = await fetchRecentYahooPolls();
    expect(entries).toHaveLength(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("fetch失敗時は空配列を返す（Radar全体を止めない）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(await fetchRecentYahooPolls()).toEqual([]);
  });
});

describe("fetchYahooPollDetail", () => {
  it("選択肢別の票数・割合を取得する", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(DETAIL_HTML) }));
    const detail = await fetchYahooPollDetail({
      url: "https://news.yahoo.co.jp/polls/67570",
      question: "日本の金利政策について、どのように考えますか？",
    });
    expect(detail?.choices).toEqual([
      { choice: "利上げが必要だと思う", count: 720, percent: 72.9, value: 1 },
      { choice: "現状維持が良いと思う", count: 90, percent: 9.1, value: 2 },
      { choice: "利下げが必要だと思う", count: 153, percent: 15.5, value: 3 },
      { choice: "分からない", count: 25, percent: 2.5, value: 4 },
    ]);
  });

  it("choicesが見つからなければnullを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve("<html></html>") }));
    expect(
      await fetchYahooPollDetail({ url: "https://news.yahoo.co.jp/polls/1", question: "q" }),
    ).toBeNull();
  });

  it("HTTPエラー・fetch失敗時はnullを返す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(
      await fetchYahooPollDetail({ url: "https://news.yahoo.co.jp/polls/1", question: "q" }),
    ).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    expect(
      await fetchYahooPollDetail({ url: "https://news.yahoo.co.jp/polls/1", question: "q" }),
    ).toBeNull();
  });
});

describe("computeDivisionScore", () => {
  it("上位2選択肢が拮抗しているほど1に近い", () => {
    expect(
      computeDivisionScore([
        { choice: "a", count: 51, percent: 51 },
        { choice: "b", count: 49, percent: 49 },
      ]),
    ).toBeCloseTo(0.98, 2);
  });

  it("一方的な結果は0に近い", () => {
    expect(
      computeDivisionScore([
        { choice: "a", count: 95, percent: 95 },
        { choice: "b", count: 5, percent: 5 },
      ]),
    ).toBeCloseTo(0.1, 2);
  });

  it("3択以上でも上位2つの差で判定する", () => {
    expect(
      computeDivisionScore([
        { choice: "a", count: 48, percent: 48 },
        { choice: "b", count: 45, percent: 45 },
        { choice: "c", count: 7, percent: 7 },
      ]),
    ).toBeCloseTo(0.97, 2);
  });

  it("選択肢が1つ以下なら0", () => {
    expect(computeDivisionScore([{ choice: "a", count: 100, percent: 100 }])).toBe(0);
  });
});

describe("matchYahooPoll", () => {
  it("トピック語に一致する設問を返す", () => {
    const list = [
      { url: "https://news.yahoo.co.jp/polls/1", question: "日本の金利政策について、どのように考えますか？" },
    ];
    expect(matchYahooPoll("金利政策", list)?.url).toBe("https://news.yahoo.co.jp/polls/1");
  });

  it("一致しなければnullを返す", () => {
    expect(matchYahooPoll("金利政策", [])).toBeNull();
  });
});
