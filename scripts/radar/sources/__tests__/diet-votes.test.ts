import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentSangiinSession,
  fetchSangiinVoteIndex,
  fetchSangiinVoteDetail,
  fetchDietVoteBreakdown,
  findDefectors,
  type PartyVoteBreakdown,
  type DietVoteMember,
} from "../diet-votes";

vi.mock("../../../../src/lib/ai", () => ({
  matchDietVoteTitle: vi.fn(),
}));

vi.mock("../kokkai", () => ({
  findRecentSpeakerPosition: vi.fn(async () => null),
}));

const INDEX_HTML = `<!DOCTYPE html><html><body>
<table class="touhyo_index">
<tr><th>日付</th><th>案件名</th></tr>
<TR><TH scope="row" rowspan="2" class="touhyo_date">令和08年7月17日</TH><TD><A HREF="221-0717-v004.htm">日程第４　国旗の損壊等の処罰に関する法律案（衆議院提出）</A></TD></TR>
<TR><TD><A HREF="221-0717-v005.htm">日程第５　電気事業法の一部を改正する法律案（内閣提出、衆議院送付）</A></TD></TR>
</table>
</body></html>`;

// 政党ブロックの個人票は実サイトで確認済みの「ラベル→氏名」順（例:「賛成」→「青木　一彦」）。
// 自民党ブロックに1名だけ反対（離反者テスト用）、1名だけ欠席（棄権が離反者扱いされないことのテスト用）を混ぜる。
const DETAIL_HTML = `<!DOCTYPE html><html><body>
<p>案件名：</p>
<p>日程第４　国旗の損壊等の処罰に関する法律案（衆議院提出）</p>
<p>投票総数　242</p>
<p>賛成票　161　　　反対票　81</p>
<p>自由民主党・無所属の会(  4名)</p>
<p>賛成票   2　　　反対票   1</p>
<p>賛成</p>
<p>青木　　一彦</p>
<p>賛成</p>
<p>赤松　　　健</p>
<p>反対</p>
<p>離反　太郎</p>
<p>投票</p>
<p>なし</p>
<p>欠席　次郎</p>
<p>立憲民主・無所属( 40名)</p>
<p>賛成票   0　　　反対票  40</p>
<p>公明党( 21名)</p>
<p>賛成票   0　　　反対票  21</p>
</body></html>`;

describe("getCurrentSangiinSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("一覧トップページの先頭セッション番号を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response('<a href="/japanese/touhyoulist/221/vote_ind.htm">221</a>'),
      ),
    );
    await expect(getCurrentSangiinSession()).resolves.toBe(221);
  });

  it("パース失敗時はnull", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no links here")));
    await expect(getCurrentSangiinSession()).resolves.toBeNull();
  });
});

describe("fetchSangiinVoteIndex", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("日付をrowspan行から引き継いでentriesを返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(INDEX_HTML)));
    const entries = await fetchSangiinVoteIndex(221);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      date: "令和08年7月17日",
      title: "日程第４　国旗の損壊等の処罰に関する法律案（衆議院提出）",
      url: "https://www.sangiin.go.jp/japanese/touhyoulist/221/221-0717-v004.htm",
    });
    // rowspan対象の2件目は同じ日付を引き継ぐ
    expect(entries[1].date).toBe("令和08年7月17日");
  });

  it("取得失敗時は空配列", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    await expect(fetchSangiinVoteIndex(221)).resolves.toEqual([]);
  });
});

describe("fetchSangiinVoteDetail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("総数と政党別内訳を正しく抽出する（最初の出現が総数）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(DETAIL_HTML)));
    const result = await fetchSangiinVoteDetail({
      date: "令和08年7月17日",
      title: "日程第４　国旗の損壊等の処罰に関する法律案（衆議院提出）",
      url: "https://www.sangiin.go.jp/japanese/touhyoulist/221/221-0717-v004.htm",
    });
    expect(result).not.toBeNull();
    expect(result?.billTitle).toBe("国旗の損壊等の処罰に関する法律案（衆議院提出）");
    expect(result?.totalFor).toBe(161);
    expect(result?.totalAgainst).toBe(81);
    expect(result?.parties).toEqual([
      { party: "自由民主党・無所属の会", memberCount: 4, for: 2, against: 1 },
      { party: "立憲民主・無所属", memberCount: 40, for: 0, against: 40 },
      { party: "公明党", memberCount: 21, for: 0, against: 21 },
    ]);
  });

  it("政党ブロック内の個人票（ラベル→氏名）を正しい対応で抽出する", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(DETAIL_HTML)));
    const result = await fetchSangiinVoteDetail({
      date: "令和08年7月17日",
      title: "日程第４　国旗の損壊等の処罰に関する法律案（衆議院提出）",
      url: "https://www.sangiin.go.jp/japanese/touhyoulist/221/221-0717-v004.htm",
    });
    const ldp = result?.members.filter((m) => m.party === "自由民主党・無所属の会");
    expect(ldp).toEqual([
      { name: "青木　　一彦", party: "自由民主党・無所属の会", vote: "for" },
      { name: "赤松　　　健", party: "自由民主党・無所属の会", vote: "for" },
      { name: "離反　太郎", party: "自由民主党・無所属の会", vote: "against" },
      { name: "欠席　次郎", party: "自由民主党・無所属の会", vote: "abstain" },
    ]);
  });

  it("会派の多数派と逆に投票した1名だけを離反者として検出する（棄権は離反扱いしない）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(DETAIL_HTML)));
    const result = await fetchSangiinVoteDetail({
      date: "令和08年7月17日",
      title: "日程第４　国旗の損壊等の処罰に関する法律案（衆議院提出）",
      url: "https://www.sangiin.go.jp/japanese/touhyoulist/221/221-0717-v004.htm",
    });
    expect(result?.defectors).toEqual([
      { name: "離反　太郎", party: "自由民主党・無所属の会", vote: "against", role: null },
    ]);
  });

  it("政党内訳が見つからないページはnull", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>賛成票 10 反対票 5</body></html>")),
    );
    const result = await fetchSangiinVoteDetail({
      date: "x",
      title: "x",
      url: "https://www.sangiin.go.jp/japanese/touhyoulist/221/x.htm",
    });
    expect(result).toBeNull();
  });
});

describe("findDefectors", () => {
  it("「各派に属しない議員」は党議拘束が無いので離反者扱いしない", () => {
    const parties: PartyVoteBreakdown[] = [{ party: "各派に属しない議員", memberCount: 3, for: 1, against: 2 }];
    const members: DietVoteMember[] = [
      { name: "A", party: "各派に属しない議員", vote: "for" },
      { name: "B", party: "各派に属しない議員", vote: "against" },
      { name: "C", party: "各派に属しない議員", vote: "against" },
    ];
    expect(findDefectors(parties, members)).toEqual([]);
  });

  it("賛否同数で多数派が決まらない会派は離反者判定の対象外", () => {
    const parties: PartyVoteBreakdown[] = [{ party: "拮抗党", memberCount: 2, for: 1, against: 1 }];
    const members: DietVoteMember[] = [
      { name: "A", party: "拮抗党", vote: "for" },
      { name: "B", party: "拮抗党", vote: "against" },
    ];
    expect(findDefectors(parties, members)).toEqual([]);
  });

  it("多数派に一致する票は離反者に含めない", () => {
    const parties: PartyVoteBreakdown[] = [{ party: "結束党", memberCount: 3, for: 3, against: 0 }];
    const members: DietVoteMember[] = [
      { name: "A", party: "結束党", vote: "for" },
      { name: "B", party: "結束党", vote: "for" },
      { name: "C", party: "結束党", vote: "for" },
    ];
    expect(findDefectors(parties, members)).toEqual([]);
  });
});

describe("fetchDietVoteBreakdown", () => {
  beforeEach(async () => {
    const ai = await import("../../../../src/lib/ai");
    vi.mocked(ai.matchDietVoteTitle).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("bigram共有が無いトピックはnanoを呼ばずnull", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("touhyoulist.html")) {
        return new Response('<a href="/japanese/touhyoulist/221/vote_ind.htm">221</a>');
      }
      if (url.includes("vote_ind.htm")) return new Response(INDEX_HTML);
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const ai = await import("../../../../src/lib/ai");
    const result = await fetchDietVoteBreakdown("キオクシア株価急落");
    expect(result).toBeNull();
    expect(ai.matchDietVoteTitle).not.toHaveBeenCalled();
  });

  it("bigram共有がある通称トピックはnano照合で正しい議案に一致させる", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("touhyoulist.html")) {
        return new Response('<a href="/japanese/touhyoulist/221/vote_ind.htm">221</a>');
      }
      if (url.includes("vote_ind.htm")) return new Response(INDEX_HTML);
      if (url.includes("221-0717-v004.htm")) return new Response(DETAIL_HTML);
      return new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const ai = await import("../../../../src/lib/ai");
    vi.mocked(ai.matchDietVoteTitle).mockResolvedValue(0);

    const result = await fetchDietVoteBreakdown("国旗損壊罪");
    expect(result?.totalAgainst).toBe(81);
    expect(result?.parties.find((p) => p.party === "立憲民主・無所属")).toEqual({
      party: "立憲民主・無所属",
      memberCount: 40,
      for: 0,
      against: 40,
    });
  });
});
