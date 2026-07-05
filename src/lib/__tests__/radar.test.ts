import { describe, expect, it } from "vitest";
import {
  decidePublish,
  dedupKey,
  hotScore,
  matchesTrending,
  buzzTitleMatch,
  isPlausibleFollowUp,
  extractBillTitle,
  clusterCoherence,
  COHERENCE_THRESHOLD,
  isOutOfScopeTopic,
  isBreakingNews,
  hasPrimarySource,
  shouldRegenerateFollowUp,
  type DecisionInput,
  type FollowUpAggregate,
} from "@/lib/radar";

const base: DecisionInput = {
  eventCount: 4,
  distinctFeeds: 3,
  minutesSinceLatest: 15,
  maxTrustWeight: 70,
  riskFlags: [],
  classification: "report",
  publishedToday: 0,
  dailyLimit: 8,
};

describe("decidePublish（Radar公開判断）", () => {
  it("報道のみの日常ネタは公開しない（一次情報なし）", () => {
    const d = decidePublish(base);
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("no_primary_source");
  });

  it("公式発表はOFFICIALで公開", () => {
    const d = decidePublish({ ...base, classification: "official" });
    if (d.action === "publish") expect(d.confirmation).toBe("OFFICIAL");
    expect(d.action).toBe("publish");
  });

  it("省庁フィード由来はOFFICIALで公開", () => {
    const d = decidePublish({
      ...base,
      classification: "report",
      feedNames: ["boj-whatsnew", "nhk-economy"],
    });
    expect(d.action).toBe("publish");
    if (d.action === "publish") expect(d.confirmation).toBe("OFFICIAL");
  });

  it("戦争・事件の速報はREPORTED（LIVE続報）で公開", () => {
    const d = decidePublish({
      ...base,
      classification: "incident",
      riskFlags: ["foreign_conflict"],
      clusterTitle: "中東で大規模空爆、複数国が声明",
    });
    expect(d.action).toBe("publish");
    if (d.action === "publish") expect(d.confirmation).toBe("REPORTED");
  });

  it("ハードブロック（未成年）はスコアが高くても必ずHELD", () => {
    const d = decidePublish({
      ...base,
      eventCount: 20,
      distinctFeeds: 8,
      riskFlags: ["minor"],
      classification: "official",
    });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("hard_block");
  });

  it.each([
    "private_individual",
    "sexual_crime",
    "minor",
    "suicide_or_victim",
    "discrimination",
    "unverified_crime_assertion",
  ])("ハードブロックフラグ %s は自動公開されない", (flag) => {
    const d = decidePublish({
      ...base,
      eventCount: 20,
      distinctFeeds: 8,
      riskFlags: [flag],
      classification: "official",
    });
    expect(d.action).toBe("hold");
  });

  it("単一媒体のスクープは公開しない（誤報対策）", () => {
    const d = decidePublish({ ...base, distinctFeeds: 1, classification: "scandal" });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("single_source");
  });

  it("単一媒体でも公式発表なら通る", () => {
    const d = decidePublish({ ...base, distinctFeeds: 1, classification: "official", maxTrustWeight: 100 });
    expect(d.action).toBe("publish");
  });

  it("日次上限到達後はHELDに落ちる（コスト暴走防止）", () => {
    const d = decidePublish({ ...base, classification: "official", publishedToday: 8, dailyLimit: 8 });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("daily_limit");
  });

  it("政治家疑惑だけでは公開しない（一次情報なし）", () => {
    const d = decidePublish({
      ...base,
      eventCount: 6,
      distinctFeeds: 4,
      riskFlags: ["named_politician_allegation"],
      classification: "scandal",
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("no_primary_source");
  });

  it("低熱量の話題はreject（ゴミスレ乱発防止）", () => {
    const d = decidePublish({
      ...base,
      eventCount: 2,
      distinctFeeds: 2,
      minutesSinceLatest: 300,
      maxTrustWeight: 40,
    });
    expect(d.action).toBe("reject");
  });

  it("スポーツ・エンタメフラグは却下", () => {
    const d = decidePublish({ ...base, riskFlags: ["sports_entertainment"] });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("out_of_scope");
  });
});

describe("isOutOfScopeTopic", () => {
  it("W杯・試合結果は対象外", () => {
    expect(isOutOfScopeTopic("日本対米国のW杯試合をどう見る？", ["Japan beat USA at World Cup"])).toBe(true);
  });

  it("はやぶさ・小惑星は対象外", () => {
    expect(
      isOutOfScopeTopic("はやぶさ2の小惑星接近をどう評価する？", ["はやぶさ2が小惑星に接近"]),
    ).toBe(true);
  });

  it("政策絡みのスポーツ予算は対象", () => {
    expect(
      isOutOfScopeTopic("スポーツ振興予算案", ["政府、スポーツ基本法改正案を閣議決定"]),
    ).toBe(false);
  });
});

describe("isBreakingNews / hasPrimarySource", () => {
  it("incident + foreign_conflict は速報", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: ["foreign_conflict"],
        clusterTitle: "ウクライナ東部で激戦",
      }),
    ).toBe(true);
  });

  it("古い incident は速報扱いしない", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        minutesSinceLatest: 500,
        riskFlags: ["foreign_conflict"],
      }),
    ).toBe(false);
  });

  it("boj フィードは一次情報", () => {
    expect(hasPrimarySource({ ...base, feedNames: ["boj-whatsnew"] })).toBe(true);
  });

  it("大規模災害（disasterフラグ）は速報LIVE対象", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: ["disaster"],
        clusterTitle: "南海トラフ沿いで大地震が発生",
      }),
    ).toBe(true);
  });

  it("大規模火災・山火事はキーワードだけでも速報LIVE対象", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: [],
        clusterTitle: "住宅街の対応をどう見る？",
        memberTitles: ["市街地で大規模火災、数百世帯に避難指示"],
      }),
    ).toBe(true);
  });

  it("震度6弱以上のキーワードは元見出し側にあってもLIVE判定できる（nanoの中立化タイトル対策）", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: [],
        clusterTitle: "関東地方の地震への対応をどう見る？",
        memberTitles: ["関東で震度6強の地震 交通機関に乱れ"],
      }),
    ).toBe(true);
  });

  it("震度3など日常の地震報道はLIVE扱いしない", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: [],
        clusterTitle: "北海道で震度3の地震",
        memberTitles: ["北海道で震度3 津波の心配なし"],
      }),
    ).toBe(false);
  });

  it("震度5弱・5強は日常寄りのためLIVE扱いしない（震度6弱未満は対象外）", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: [],
        clusterTitle: "東北で震度5強の地震",
        memberTitles: ["東北で震度5強の地震、一部で停電"],
      }),
    ).toBe(false);
  });
});

describe("hotScore", () => {
  it("直近・多媒体ほど高い", () => {
    const hotNow = hotScore({ ...base, minutesSinceLatest: 5 });
    const hotOld = hotScore({ ...base, minutesSinceLatest: 300 });
    expect(hotNow).toBeGreaterThan(hotOld);
  });

  it("trending加点でスコアが上がる（テーマ選定の優先度に反映）", () => {
    const plain = hotScore(base);
    const trending = hotScore({ ...base, trending: true });
    expect(trending).toBeGreaterThan(plain);
  });

  it("socialBuzz加点はtrendingより弱い（検索急増>継続関心の重み付け）", () => {
    const plain = hotScore(base);
    const social = hotScore({ ...base, socialBuzz: true });
    const trending = hotScore({ ...base, trending: true });
    expect(social).toBeGreaterThan(plain);
    expect(trending).toBeGreaterThan(social);
  });
});

describe("matchesTrending", () => {
  it("急上昇ワードが見出しに含まれていれば真", () => {
    expect(matchesTrending(["入管法改正案が閣議決定"], ["入管法改正"])).toBe(true);
  });

  it("含まれていなければ偽", () => {
    expect(matchesTrending(["消費税減税法案、衆院で可決へ"], ["入管法改正"])).toBe(false);
  });

  it("急上昇ワードが空なら常に偽", () => {
    expect(matchesTrending(["何でもいい見出し"], [])).toBe(false);
  });
});

describe("buzzTitleMatch（はてブ人気エントリとの類似判定）", () => {
  it("同じ出来事を指す記事タイトル同士は一致と判定する", () => {
    expect(
      buzzTitleMatch(
        ["入管法改正案が衆院で可決", "入管法改正案が衆院通過"],
        ["入管法改正案が衆院通過、支援団体から懸念の声"],
      ),
    ).toBe(true);
  });

  it("無関係なタイトルは一致しない", () => {
    expect(
      buzzTitleMatch(["消費税減税法案、衆院で可決へ"], ["猫の写真がかわいいと話題に"]),
    ).toBe(false);
  });

  it("コーパスが空なら偽", () => {
    expect(buzzTitleMatch(["何かの見出し"], [])).toBe(false);
  });
});

describe("isPlausibleFollowUp（nano続報マッチの機械裏取り）", () => {
  const issue = {
    title: "入管法改正案の成立、あなたはどう見る？",
    keywords: ["入管法改正案が衆院通過", "出入国管理及び難民認定法改正案"],
  };

  it("Issueキーワードが見出しに含まれていれば続報と認める", () => {
    expect(
      isPlausibleFollowUp("入管法改正の続報", ["「出入国管理及び難民認定法改正案」→ 参院で審議入り"], issue),
    ).toBe(true);
  });

  it("タイトル類似が十分あれば続報と認める", () => {
    expect(
      isPlausibleFollowUp("入管法改正案が参院で可決", ["入管法改正案、参院本会議で可決・成立"], issue),
    ).toBe(true);
  });

  it("無関係な出来事は続報と認めない（タイムライン汚染防止）", () => {
    expect(
      isPlausibleFollowUp("プロ野球の開幕戦が延期", ["雨天のため開幕戦が順延に"], issue),
    ).toBe(false);
  });

  // TopicCandidate（未公開候補）はkeywordsを持たないため、match_candidate_idの裏取りでは
  // keywords: [] を渡してタイトル類似のみで判定する。累積判定の核となる経路なので個別に検証する
  describe("keywordsが空（未公開候補とのマッチング用途）", () => {
    const candidate = { title: "国旗損壊罪の新設をどう見る？", keywords: [] as string[] };

    it("言い回しが変わっても同じ出来事ならタイトル類似で続報と認める", () => {
      expect(
        isPlausibleFollowUp(
          "国旗を傷つける行為への罰則、賛否は",
          ["国旗損壊罪の新設を含む刑法改正案が衆院委員会で審議入り"],
          candidate,
        ),
      ).toBe(true);
    });

    it("無関係な出来事はkeywordsが空でも続報と認めない", () => {
      expect(
        isPlausibleFollowUp("消費税減税法案、衆院で可決へ", ["消費税減税法案が衆院通過"], candidate),
      ).toBe(false);
    });
  });
});

describe("extractBillTitle（議案フィードからの法案名抽出）", () => {
  it("「」内の法案名を取り出す", () => {
    expect(
      extractBillTitle("衆議院第218回: 「国旗損壊罪を新設する刑法改正案」→ 委員会審査中"),
    ).toBe("国旗損壊罪を新設する刑法改正案");
  });

  it("「」がなければnull", () => {
    expect(extractBillTitle("衆議院第218回: 法案審議")).toBe(null);
  });

  it("短すぎる抽出結果はnull（誤マッチ防止）", () => {
    expect(extractBillTitle("参議院第218回: 「予算」→ 可決")).toBe(null);
  });
});

describe("dedupKey", () => {
  it("表記ゆれを吸収して同一キーになる", () => {
    expect(dedupKey("「消費税減税」を巡る議論、活発化")).toBe(
      dedupKey("消費税減税を巡る議論 活発化"),
    );
  });
});

describe("clusterCoherence（nanoクラスタリングの誤結合検出）", () => {
  it("同じ出来事を報じた見出し群は高い類似度になる", () => {
    const titles = [
      "消費税減税法案、衆院で可決へ",
      "消費税減税法案が衆院通過 与野党の攻防続く",
      "衆院、消費税減税法案を可決",
    ];
    expect(clusterCoherence(titles)).toBeGreaterThanOrEqual(COHERENCE_THRESHOLD);
  });

  it("無関係な見出しの寄せ集めは低い類似度になる", () => {
    const titles = [
      "消費税減税法案、衆院で可決へ",
      "大谷翔平が今季30号本塁打",
      "北海道で震度4の地震",
    ];
    expect(clusterCoherence(titles)).toBeLessThan(COHERENCE_THRESHOLD);
  });

  it("単一タイトルは比較不能として通す（1.0）", () => {
    expect(clusterCoherence(["単独の見出し"])).toBe(1);
  });

  it("空配列は1を返す", () => {
    expect(clusterCoherence([])).toBe(1);
  });
});

describe("shouldRegenerateFollowUp（続報再生成の頻度ゲート）", () => {
  const now = new Date("2026-07-05T12:00:00Z");

  const reportedBase: FollowUpAggregate = {
    confirmation: "REPORTED",
    articleGeneratedAt: new Date("2026-07-05T11:00:00Z"), // 60分前
    newEventCount: 1,
    newDistinctFeeds: 1,
    maxNewTrustWeight: 50,
  };

  it("新着イベントが0件なら再生成しない", () => {
    expect(shouldRegenerateFollowUp({ ...reportedBase, newEventCount: 0, newDistinctFeeds: 0 }, now)).toBe(
      false,
    );
  });

  it("REPORTED: 新着1媒体以上・30分以上経過で再生成する", () => {
    expect(shouldRegenerateFollowUp(reportedBase, now)).toBe(true);
  });

  it("REPORTED: 30分未満なら再生成しない（ちょうど29分は不可）", () => {
    const recent = { ...reportedBase, articleGeneratedAt: new Date("2026-07-05T11:31:00Z") };
    expect(shouldRegenerateFollowUp(recent, now)).toBe(false);
  });

  it("REPORTED: ちょうど30分は再生成する（境界値）", () => {
    const exact = { ...reportedBase, articleGeneratedAt: new Date("2026-07-05T11:30:00Z") };
    expect(shouldRegenerateFollowUp(exact, now)).toBe(true);
  });

  const officialBase: FollowUpAggregate = {
    confirmation: "OFFICIAL",
    articleGeneratedAt: new Date("2026-07-05T09:00:00Z"), // 3時間前
    newEventCount: 1,
    newDistinctFeeds: 1,
    maxNewTrustWeight: 90,
  };

  it("OFFICIAL: 一次情報級の新着(trust>=85)・2時間以上経過で再生成する", () => {
    expect(shouldRegenerateFollowUp(officialBase, now)).toBe(true);
  });

  it("OFFICIAL: 新着が一次情報級でなければ再生成しない", () => {
    expect(shouldRegenerateFollowUp({ ...officialBase, maxNewTrustWeight: 60 }, now)).toBe(false);
  });

  it("OFFICIAL: 2時間未満なら一次情報級でも再生成しない", () => {
    const recent = { ...officialBase, articleGeneratedAt: new Date("2026-07-05T11:00:00Z") };
    expect(shouldRegenerateFollowUp(recent, now)).toBe(false);
  });

  it("MANUAL争点は対象外", () => {
    expect(shouldRegenerateFollowUp({ ...reportedBase, confirmation: "MANUAL" }, now)).toBe(false);
  });
});
