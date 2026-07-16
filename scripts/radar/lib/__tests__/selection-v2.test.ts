import { describe, expect, it } from "vitest";
import {
  buzzPrime,
  heatPrime,
  selectionV2RankScore,
  passesRankMin,
  passesSelectionV2,
  tweetHeat,
  secondaryHeat,
  resolveDivisionScore,
  TWEET_REF,
  RANK_MIN_DEFAULT,
  BUZZ_MIN_DEFAULT,
  HEAT_MIN_DEFAULT,
  dvsPrime,
  hasMeasuredDivision,
  DVS_SOFT_FLOOR,
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

describe("secondaryHeat", () => {
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
  it("YouTubeの返信数が多いほど加点される（いいね数ではなく応酬の実測）", () => {
    expect(secondaryHeat({ youtubeReplyCount: 300 })).toBeGreaterThan(secondaryHeat({ youtubeReplyCount: 0 }));
    expect(secondaryHeat({ youtubeReplyCount: 300 })).toBeGreaterThan(secondaryHeat({ youtubeReplyCount: 100 }));
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
    expect(r.dvsPrime).toBe(1);
  });

  it("積: 両方高いと上位", () => {
    const hot = selectionV2RankScore({ buzzScore: 4 }, { tweetCountOverride: 5000 });
    const mild = selectionV2RankScore({ buzzScore: 4 }, { tweetCountOverride: 50 });
    expect(hot.rankScore).toBeGreaterThan(mild.rankScore);
  });

  it("露出だけ強い（buzz高・tweet低）より熱量もある方が上", () => {
    const buzzOnly = selectionV2RankScore({ buzzScore: 5 }, { tweetCountOverride: 20 });
    const balanced = selectionV2RankScore({ buzzScore: 3 }, { tweetCountOverride: 3000 });
    expect(balanced.rankScore).toBeGreaterThan(buzzOnly.rankScore);
  });

  it("熱量なしではDVSが偏っている（低い）と順位が下がる", () => {
    const base = { buzzScore: 4, youtubeReplyCount: 150 }; // 副熱量だけ確保（heat guard非トリガー）
    const unknown = selectionV2RankScore(base); // Conflict'=1.0
    const split = selectionV2RankScore({ ...base, commentFrictionScore: 0.95 }); // Conflict'=0.95
    const lopsidedCold = selectionV2RankScore({
      ...base,
      externalPoll: { question: "q", url: "https://x", choices: [], divisionScore: 0.05 },
    }); // Conflict'=0.15
    // DVSが極端に偏っている（lopsided）はunknownより低くなる
    expect(lopsidedCold.rankScore).toBeLessThan(unknown.rankScore);
    expect(split.rankScore).toBeGreaterThan(lopsidedCold.rankScore); // 高DVS>低DVS
    expect(unknown.dvsPrime).toBe(1);
  });

  it("熱量あり（tweetCount>0）ではDVSに関わらずConflict'は中立", () => {
    const base = { buzzScore: 4, tweetCount: 2000 };
    const unknown = selectionV2RankScore(base);
    const lopsidedWithHeat = selectionV2RankScore({
      ...base,
      externalPoll: { question: "q", url: "https://x", choices: [], divisionScore: 0.05 },
    });
    // 熱量があるのでDVS偏りでもrankScoreは同じ
    expect(lopsidedWithHeat.rankScore).toBe(unknown.rankScore);
    expect(unknown.dvsPrime).toBe(1);
  });
});

describe("passesRankMin", () => {
  it("閾値未満は false", () => {
    expect(passesRankMin(RANK_MIN_DEFAULT - 0.01)).toBe(false);
    expect(passesRankMin(RANK_MIN_DEFAULT)).toBe(true);
  });
});

describe("passesSelectionV2", () => {
  it("Buzz・Heat・積のすべてが下限以上でないと通さない", () => {
    // buzz高・heatゼロ
    expect(
      passesSelectionV2({ buzzPrime: 1, heatPrime: 0, rankScore: 0 }),
    ).toBe(false);
    // heatだけあるが buzz 不足
    expect(
      passesSelectionV2({
        buzzPrime: BUZZ_MIN_DEFAULT - 0.01,
        heatPrime: 0.5,
        rankScore: 0.2,
      }),
    ).toBe(false);
    // 両方十分
    const ok = selectionV2RankScore({ buzzScore: 3, tweetCount: 2000 });
    expect(ok.buzzPrime).toBeGreaterThanOrEqual(BUZZ_MIN_DEFAULT);
    expect(ok.heatPrime).toBeGreaterThanOrEqual(HEAT_MIN_DEFAULT);
    expect(passesSelectionV2(ok)).toBe(true);
  });
});
