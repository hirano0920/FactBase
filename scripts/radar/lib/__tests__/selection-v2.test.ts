import { describe, expect, it } from "vitest";
import {
  buzzPrime,
  heatPrime,
  clickHeat,
  debateHeat,
  selectionV2RankScore,
  passesRankMin,
  passesSelectionV2,
  tweetHeat,
  secondaryHeat,
  resolveDivisionScore,
  TWEET_REF,
  RANK_MIN_DEFAULT,
  BUZZ_MIN_DEFAULT,
  dvsPrime,
  hasMeasuredDivision,
  DVS_SOFT_FLOOR,
  CLICK_HEAT_MIN,
  DEBATE_HEAT_MIN,
} from "../selection-v2";

describe("buzzPrime", () => {
  it("effectiveScore 5 → 1", () => {
    expect(buzzPrime(5)).toBe(1);
  });
  it("effectiveScore 2 → 0.4", () => {
    expect(buzzPrime(2)).toBeCloseTo(0.4);
  });
  it("undefined → 0", () => {
    expect(buzzPrime(undefined)).toBe(0);
  });
});

describe("tweetHeat", () => {
  it("0 → 0", () => {
    expect(tweetHeat(0)).toBe(0);
  });
  it("TWEET_REF → 1", () => {
    expect(tweetHeat(TWEET_REF)).toBeCloseTo(1);
  });
  it("対数圧縮で線形より緩やか", () => {
    expect(tweetHeat(100)).toBeLessThan(tweetHeat(1000));
    expect(tweetHeat(1000)).toBeLessThan(1);
  });
});

describe("secondaryHeat（旧互換）", () => {
  it("シグナル無しは0", () => {
    expect(secondaryHeat({})).toBe(0);
  });
  it("コメント急増+1000で上がる", () => {
    expect(secondaryHeat({ commentCountSurge: true, commentCount: 1000 })).toBeGreaterThan(0.4);
  });
  it("投票分断度は副熱量には入れない（DVS'独立因子へ移した）", () => {
    expect(
      secondaryHeat({
        externalPoll: {
          question: "q",
          url: "https://x",
          choices: [],
          divisionScore: 1,
        },
      }),
    ).toBe(0);
  });
  it("コメント300〜999でも段階的に加点される", () => {
    expect(secondaryHeat({ commentCount: 300 })).toBeGreaterThan(0);
    expect(secondaryHeat({ commentCount: 500 })).toBeGreaterThan(secondaryHeat({ commentCount: 300 }));
    expect(secondaryHeat({ commentCount: 1000 })).toBeGreaterThan(secondaryHeat({ commentCount: 500 }));
  });
  it("Yahooコメントが無くてもYouTubeコメント数が多ければ加点される", () => {
    expect(secondaryHeat({ youtubeCommentCount: 3000 })).toBeGreaterThan(0);
  });
  it("コメント数はYahooとYouTubeの高い方を採用する", () => {
    const yahooOnly = secondaryHeat({ commentCount: 3000 });
    const youtubeHigher = secondaryHeat({ commentCount: 100, youtubeCommentCount: 3000 });
    expect(youtubeHigher).toBeCloseTo(yahooOnly);
  });
  it("YouTubeの返信数が多いほど加点される", () => {
    expect(secondaryHeat({ youtubeReplyCount: 300 })).toBeGreaterThan(secondaryHeat({ youtubeReplyCount: 0 }));
    expect(secondaryHeat({ youtubeReplyCount: 300 })).toBeGreaterThan(secondaryHeat({ youtubeReplyCount: 100 }));
  });
});

describe("clickHeat", () => {
  it("tweetCountありなら対数圧縮値", () => {
    const ch = clickHeat({}, 5000);
    expect(ch).toBeCloseTo(1);
  });
  it("tweetCount無しは0", () => {
    const ch = clickHeat({});
    expect(ch).toBe(0);
  });
  it("tweetCount 0は0", () => {
    const ch = clickHeat({ tweetCount: 0 });
    expect(ch).toBe(0);
  });
  it("小さいtweetCountでも段階的に上がる", () => {
    const low = clickHeat({}, 100);
    const high = clickHeat({}, 1000);
    expect(low).toBeLessThan(high);
    expect(high).toBeLessThan(1);
  });
});

describe("debateHeat", () => {
  it("シグナル無しは0", () => {
    expect(debateHeat({})).toBe(0);
  });
  it("コメント急増+1000で高い", () => {
    expect(debateHeat({ commentCountSurge: true, commentCount: 1000 })).toBeGreaterThan(0.6);
  });
  it("投票分断度が高いと加点される（secondaryHeatとの違い）", () => {
    const withPoll = debateHeat({
      externalPoll: { question: "q", url: "https://x", choices: [], divisionScore: 0.8 },
    });
    const withoutPoll = debateHeat({});
    expect(withPoll).toBeGreaterThan(withoutPoll);
  });
  it("コメント300〜999でも段階的に加点される", () => {
    expect(debateHeat({ commentCount: 300 })).toBeGreaterThan(0);
    expect(debateHeat({ commentCount: 500 })).toBeGreaterThan(debateHeat({ commentCount: 300 }));
    expect(debateHeat({ commentCount: 1000 })).toBeGreaterThan(debateHeat({ commentCount: 500 }));
  });
  it("Yahooコメントが無くてもYouTubeコメント数が多ければ加点される", () => {
    expect(debateHeat({ youtubeCommentCount: 3000 })).toBeGreaterThan(0);
  });
  it("コメント摩擦度が高いと加点される", () => {
    expect(debateHeat({ commentFrictionScore: 0.5 })).toBeGreaterThan(debateHeat({}));
    expect(debateHeat({ commentFrictionScore: 0.3 })).toBeGreaterThan(0);
  });
  it("YouTubeの返信数が多いほど加点される", () => {
    expect(debateHeat({ youtubeReplyCount: 300 })).toBeGreaterThan(debateHeat({ youtubeReplyCount: 0 }));
  });
});

describe("resolveDivisionScore", () => {
  it("シグナルが何も無ければ0", () => {
    expect(resolveDivisionScore({})).toBe(0);
  });

  it("externalPollが最優先される（commentFrictionScoreがあっても）", () => {
    const score = resolveDivisionScore({
      externalPoll: { question: "q", url: "https://x", choices: [], divisionScore: 0.9 },
      commentFrictionScore: 0.1,
    });
    expect(score).toBeCloseTo(0.9);
  });

  it("externalPollが無ければcommentFrictionScoreを使う", () => {
    expect(resolveDivisionScore({ commentFrictionScore: 0.6 })).toBeCloseTo(0.6);
  });

  it("commentFrictionScoreも無ければcommentStanceSpreadにフォールバックする", () => {
    expect(
      resolveDivisionScore({ commentStanceSpread: { split: true, confidence: 0.7 } }),
    ).toBeCloseTo(0.7);
  });

  it("commentStanceSpread.split=falseなら0", () => {
    expect(
      resolveDivisionScore({ commentStanceSpread: { split: false, confidence: 0.9 } }),
    ).toBe(0);
  });

  it("他が無ければpredictedDivisionScore（Gateの予測）にフォールバックする（最後の手段）", () => {
    expect(resolveDivisionScore({ predictedDivisionScore: 0.3 })).toBeCloseTo(0.3);
  });

  it("predictedDivisionScoreより実測(commentFrictionScore)が優先される", () => {
    expect(
      resolveDivisionScore({ commentFrictionScore: 0.8, predictedDivisionScore: 0.1 }),
    ).toBeCloseTo(0.8);
  });
});

describe("heatPrime", () => {
  it("tweetCountありなら主85%+副15%", () => {
    const h = heatPrime({ commentCount: 0 }, 5000);
    expect(h.hasTweetCount).toBe(true);
    expect(h.heatPrime).toBeCloseTo(0.85 * 1 + 0.15 * 0);
  });
  it("tweetCount無しは副のみ・上限0.55", () => {
    const h = heatPrime({ commentCountSurge: true, commentCount: 5000 });
    expect(h.hasTweetCount).toBe(false);
    expect(h.heatPrime).toBeLessThanOrEqual(0.55);
    expect(h.heatPrime).toBeGreaterThan(0);
  });
});

describe("dvsPrime", () => {
  it("シグナル不明なら1（ペナルティなし）", () => {
    const d = dvsPrime({});
    expect(d.hasMeasured).toBe(false);
    expect(d.dvsPrime).toBe(1);
    expect(hasMeasuredDivision({})).toBe(false);
  });
  it("実測が高いと1に近い", () => {
    const d = dvsPrime({ commentFrictionScore: 0.9 });
    expect(d.hasMeasured).toBe(true);
    expect(d.dvsPrime).toBeCloseTo(0.9);
  });
  it("極端に低い実測でもソフト下限で完全0にはしない", () => {
    const d = dvsPrime({
      externalPoll: { question: "q", url: "https://x", choices: [], divisionScore: 0.02 },
    });
    expect(d.dvsPrime).toBeCloseTo(DVS_SOFT_FLOOR);
  });
});

describe("selectionV2RankScore", () => {
  it("積: buzzだけ高くても heat 0 なら score 0", () => {
    const r = selectionV2RankScore({ buzzScore: 5 });
    expect(r.rankScore).toBe(0);
    expect(r.clickHeat).toBe(0);
    expect(r.debateHeat).toBe(0);
  });

  it("積: 両方高いと上位", () => {
    const hot = selectionV2RankScore(
      { buzzScore: 4, commentCount: 2000, commentFrictionScore: 0.5 },
      { tweetCountOverride: 5000 },
    );
    const mild = selectionV2RankScore(
      { buzzScore: 4, commentCount: 200, commentFrictionScore: 0.1 },
      { tweetCountOverride: 50 },
    );
    expect(hot.rankScore).toBeGreaterThan(mild.rankScore);
    expect(hot.rankScore).toBeGreaterThan(0);
    expect(mild.rankScore).toBeGreaterThan(0);
  });

  it("clickだけ高くdebateが低いとrankScoreは低い", () => {
    const clickOnly = selectionV2RankScore(
      { buzzScore: 5, tweetCount: 5000, commentFrictionScore: 0 },
      { tweetCountOverride: 5000 },
    );
    const bothHigh = selectionV2RankScore(
      { buzzScore: 5, tweetCount: 5000, commentCount: 2000 },
      { tweetCountOverride: 5000 },
    );
    expect(clickOnly.debateHeat).toBe(0);
    expect(bothHigh.debateHeat).toBeGreaterThan(0);
    expect(bothHigh.rankScore).toBeGreaterThan(clickOnly.rankScore);
  });

  it("debateだけ高くclickが低いとrankScoreは低い", () => {
    const debateOnly = selectionV2RankScore(
      { buzzScore: 4, commentCount: 5000, commentFrictionScore: 0.8 },
      { tweetCountOverride: 0 },
    );
    const bothHigh = selectionV2RankScore(
      { buzzScore: 4, tweetCount: 5000, commentCount: 5000 },
      { tweetCountOverride: 5000 },
    );
    expect(debateOnly.clickHeat).toBe(0);
    expect(debateOnly.rankScore).toBe(0);
    expect(bothHigh.rankScore).toBeGreaterThan(0);
  });

  it("露出だけ強い（buzz高・click低）よりバランスが良い方が上", () => {
    const buzzOnly = selectionV2RankScore(
      { buzzScore: 5, commentCount: 100, commentFrictionScore: 0.1 },
      { tweetCountOverride: 20 },
    );
    const balanced = selectionV2RankScore(
      { buzzScore: 3, commentCount: 500, commentFrictionScore: 0.4 },
      { tweetCountOverride: 3000 },
    );
    expect(buzzOnly.rankScore).toBeGreaterThan(0);
    expect(balanced.rankScore).toBeGreaterThan(0);
    expect(balanced.rankScore).toBeGreaterThan(buzzOnly.rankScore);
  });

  it("clickHeatとdebateHeatが breakdown に含まれる", () => {
    const r = selectionV2RankScore(
      { buzzScore: 4, tweetCount: 5000, commentCount: 2000, commentFrictionScore: 0.5 },
      { tweetCountOverride: 5000 },
    );
    expect(r.clickHeat).toBeGreaterThan(0);
    expect(r.debateHeat).toBeGreaterThan(0);
    expect(r.rankScore).toBe(r.buzzPrime * r.clickHeat * r.debateHeat);
  });
});

describe("passesRankMin", () => {
  it("閾値未満は false", () => {
    expect(passesRankMin(RANK_MIN_DEFAULT - 0.01)).toBe(false);
    expect(passesRankMin(RANK_MIN_DEFAULT)).toBe(true);
  });
});

describe("passesSelectionV2", () => {
  it("Buzz・Click・Debate・積のすべてが下限以上でないと通さない", () => {
    // buzzだけ高く他ゼロ
    expect(
      passesSelectionV2({
        buzzPrime: 1,
        heatPrime: 0,
        clickHeat: 0,
        debateHeat: 0,
        rankScore: 0,
      }),
    ).toBe(false);
    // click高・debateゼロ（議論が無い）
    expect(
      passesSelectionV2({
        buzzPrime: 0.5,
        heatPrime: 0.5,
        clickHeat: 0.5,
        debateHeat: 0,
        rankScore: 0,
      }),
    ).toBe(false);
    // debate高・clickゼロ（ツイートが無い）
    expect(
      passesSelectionV2({
        buzzPrime: 0.5,
        heatPrime: 0.3,
        clickHeat: 0,
        debateHeat: 0.5,
        rankScore: 0,
      }),
    ).toBe(false);
    // 全部十分
    const ok = selectionV2RankScore({ buzzScore: 3, tweetCount: 2000, commentCount: 500 });
    expect(ok.buzzPrime).toBeGreaterThanOrEqual(BUZZ_MIN_DEFAULT);
    expect(ok.clickHeat).toBeGreaterThan(0);
    expect(ok.debateHeat).toBeGreaterThanOrEqual(DEBATE_HEAT_MIN);
    expect(passesSelectionV2(ok)).toBe(true);
  });
});
