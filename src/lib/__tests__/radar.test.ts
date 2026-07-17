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
  isRoutineOfficialUpdate,
  isBreakingNews,
  hasPrimarySource,
  shouldRegenerateFollowUp,
  computeBuzzScore,
  toIssueCategory,
  shouldDeferToBuzzPipeline,
  shouldUseInternationalReports,
  looksLikeDeclarationConflict,
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

  it("戦争・事件の速報はREPORTED（LIVE緊急）で公開", () => {
    const d = decidePublish({
      ...base,
      classification: "incident",
      riskFlags: ["foreign_conflict"],
      clusterTitle: "隣国への軍事侵攻が始まる",
      memberTitles: ["全面侵攻が報じられる", "複数国が声明"],
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

/** 運用上「出したくない」典型。detect.ts の decidePublish 経路の回帰防止 */
describe("decidePublish — 公開しないべき典型", () => {
  it("2媒体の日常報道（バズ・一次情報・LIVEなし）は出さない", () => {
    const d = decidePublish({
      ...base,
      classification: "report",
      clusterTitle: "地方の小さなイベントが話題に",
      memberTitles: ["〇〇市で地域イベント開催", "△△新聞がイベントを紹介"],
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("no_primary_source");
  });

  it("Trends一致でも単一媒体スクープは出さない", () => {
    const d = decidePublish({
      ...base,
      distinctFeeds: 1,
      trending: true,
      classification: "scandal",
      clusterTitle: "政治家の不倫疑惑が浮上",
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("single_source");
  });

  it("Trends一致でもスコア不足なら出さない（古い・低信頼の2媒体ネタ）", () => {
    const d = decidePublish({
      ...base,
      eventCount: 2,
      distinctFeeds: 2,
      minutesSinceLatest: 300,
      maxTrustWeight: 40,
      trending: true,
      classification: "report",
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("below_threshold");
  });

  it("芸能ゴシップは対象外", () => {
    const d = decidePublish({
      ...base,
      riskFlags: ["celebrity_gossip"],
      trending: true,
      classification: "report",
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("out_of_scope");
  });

  it("天気予報のみは対象外", () => {
    const d = decidePublish({
      ...base,
      riskFlags: ["pure_weather"],
      classification: "report",
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("out_of_scope");
  });

  it("軽微犯罪（万引き等）はLIVE扱いせず一次情報なしなら出さない", () => {
    const d = decidePublish({
      ...base,
      classification: "incident",
      riskFlags: ["crime_related"],
      clusterTitle: "スーパーで万引き、40代男を逮捕",
      memberTitles: ["万引き容疑で逮捕", "警察が窃盗容疑で聴取"],
    });
    expect(isBreakingNews({
      ...base,
      classification: "incident",
      riskFlags: ["crime_related"],
      clusterTitle: "スーパーで万引き、40代男を逮捕",
      memberTitles: ["万引き容疑で逮捕", "警察が窃盗容疑で聴取"],
    })).toBe(false);
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("no_primary_source");
  });

  it("LIVEキーワードでも単一媒体なら出さない（誤報スクープ待ち）", () => {
    const input = {
      ...base,
      distinctFeeds: 1,
      classification: "incident",
      clusterTitle: "繁華街で銃撃事件",
      memberTitles: ["繁華街で銃撃、複数人が負傷"],
    };
    expect(isBreakingNews(input)).toBe(false);
    const d = decidePublish(input);
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("single_source");
  });

  it("日次上限到達後の超重大事件も自動公開はしない（翌日HELD復活はdetect側の別経路）", () => {
    const d = decidePublish({
      ...base,
      classification: "incident",
      riskFlags: ["foreign_conflict"],
      clusterTitle: "大規模空爆が発生",
      publishedToday: 8,
      dailyLimit: 8,
    });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("daily_limit");
  });
});

/** 運用上「必ず拾いたい」典型。公開経路（OFFICIAL / breaking / buzz）まで含めて検証 */
describe("decidePublish — 公開すべき典型", () => {
  it("閣議決定・公式発表はOFFICIALで公開", () => {
    const d = decidePublish({
      ...base,
      classification: "official",
      clusterTitle: "政府、新経済対策を閣議決定",
      feedNames: ["kantei-news"],
    });
    expect(d.action).toBe("publish");
    if (d.action === "publish") {
      expect(d.confirmation).toBe("OFFICIAL");
      expect(d.reason).toContain("primary");
    }
  });

  it("経済指標（indicator分類）も一次情報としてOFFICIAL公開", () => {
    const d = decidePublish({
      ...base,
      classification: "indicator",
      clusterTitle: "日銀、政策金利を据え置き",
      feedNames: ["boj-whatsnew", "nhk-economy"],
    });
    expect(d.action).toBe("publish");
    if (d.action === "publish") expect(d.confirmation).toBe("OFFICIAL");
  });

  it("震度6強+甚大被害の地震はREPORTED（LIVE緊急）で公開", () => {
    const input = {
      ...base,
      classification: "incident",
      clusterTitle: "関東の地震への対応をどう見る？",
      memberTitles: ["関東で震度6強の地震", "死者多数・甚大な被害"],
    };
    expect(isBreakingNews(input)).toBe(true);
    const d = decidePublish(input);
    expect(d.action).toBe("publish");
    if (d.action === "publish") {
      expect(d.confirmation).toBe("REPORTED");
      expect(d.reason).toContain("breaking");
    }
  });

  it("要人暗殺・テロ報道はREPORTED（breaking経路）で公開", () => {
    const input = {
      ...base,
      classification: "incident",
      clusterTitle: "要人暗殺事件への対応をどう見る？",
      memberTitles: ["要人が暗殺される", "テロの可能性も"],
    };
    expect(isBreakingNews(input)).toBe(true);
    const d = decidePublish(input);
    expect(d.action).toBe("publish");
    if (d.action === "publish") {
      expect(d.confirmation).toBe("REPORTED");
      expect(d.reason).toContain("breaking");
    }
  });

  it("大津波警報・津波警報はLIVE（大災害としてREPORTED公開）", () => {
    const input = {
      ...base,
      classification: "incident",
      clusterTitle: "太平洋沿岸の津波警報をどう見る？",
      memberTitles: ["大津波警報を発表", "沿岸部に避難指示"],
    };
    expect(isBreakingNews(input)).toBe(true);
    const d = decidePublish(input);
    expect(d.action).toBe("publish");
    if (d.action === "publish") expect(d.confirmation).toBe("REPORTED");
  });

  it("津波注意報どまりはLIVEにしない（警報級のみ）", () => {
    const input = {
      ...base,
      classification: "incident",
      clusterTitle: "津波注意報をどう見る？",
      memberTitles: ["津波注意報を発表", "海に近づかないよう呼びかけ"],
    };
    expect(isBreakingNews(input)).toBe(false);
  });

  it("噴火警戒レベル5・原子力緊急事態もLIVE対象", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        clusterTitle: "噴火をどう見る？",
        memberTitles: ["噴火警戒レベル5に引き上げ", "全島避難を指示"],
      }),
    ).toBe(true);
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        clusterTitle: "原発の状況は",
        memberTitles: ["原子力緊急事態宣言を発令", "周辺住民に避難指示"],
      }),
    ).toBe(true);
  });

  it("Trends+2媒体の報道錯綜はdetectでは出さずpromoteへ", () => {
    const d = decidePublish({
      ...base,
      classification: "report",
      trending: true,
      clusterTitle: "入管法改正案が話題に",
      memberTitles: ["入管法改正案が衆院通過", "与野党で攻防"],
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("defer_buzz_pipeline");
  });

  it("YouTubeバズ+2媒体もdetectでは出さない", () => {
    const d = decidePublish({
      ...base,
      classification: "report",
      socialBuzz: true,
      clusterTitle: "消費税減税法案が話題に",
      memberTitles: ["消費税減税法案、衆院で可決へ", "与野党の攻防続く"],
    });
    expect(d.action).toBe("reject");
    expect(d.reason).toContain("defer_buzz_pipeline");
  });

  it("衆院選開票速報はLIVE緊急", () => {
    const input = {
      ...base,
      classification: "report",
      clusterTitle: "衆院選の結果をどう見る？",
      memberTitles: ["衆院選の開票速報", "与党が議席を確保"],
    };
    expect(isBreakingNews(input)).toBe(true);
    const d = decidePublish(input);
    expect(d.action).toBe("publish");
    if (d.action === "publish") expect(d.reason).toContain("breaking");
  });

  it("新内閣成立はLIVE緊急", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "official",
        clusterTitle: "新内閣の政策をどう評価する？",
        memberTitles: ["新内閣が成立", "閣僚人事を発表"],
      }),
    ).toBe(true);
  });

  it("LIVE緊急の日次上限に達するとHELD", () => {
    const d = decidePublish({
      ...base,
      classification: "incident",
      clusterTitle: "首都でテロが発生",
      memberTitles: ["テロ攻撃で死者", "複数国が声明"],
      publishedToday: 3,
      publishedReportedToday: 3,
      reportedDailyLimit: 3,
      dailyLimit: 8,
    });
    expect(d.action).toBe("hold");
    expect(d.reason).toContain("reported_daily_limit");
  });
});

describe("shouldDeferToBuzzPipeline", () => {
  it("Trends+報道錯綜はバズ経路へ譲る", () => {
    const input: DecisionInput = {
      ...base,
      classification: "report",
      trending: true,
    };
    const decision = decidePublish(input);
    expect(decision.action).toBe("reject");
  });

  it("LIVE緊急は譲らない", () => {
    const input: DecisionInput = {
      ...base,
      classification: "incident",
      clusterTitle: "首都でテロが発生",
      memberTitles: ["テロ攻撃で死者", "複数国が声明"],
    };
    const decision = decidePublish(input);
    expect(decision.action).toBe("publish");
    expect(shouldDeferToBuzzPipeline(input, decision)).toBe(false);
  });

  it("公式OFFICIALは譲らない", () => {
    const input: DecisionInput = { ...base, classification: "official", trending: true };
    const decision = decidePublish(input);
    expect(decision.action).toBe("publish");
    expect(shouldDeferToBuzzPipeline(input, decision)).toBe(false);
  });
});

describe("isRoutineOfficialUpdate", () => {
  it("開廷期日情報はルーティン更新", () => {
    expect(
      isRoutineOfficialUpdate("最高裁判所開廷期日情報が更新されました (fp:abc)", ["courts-kijitsu"]),
    ).toBe(true);
  });

  it("判決・重大声明はルーティンではない", () => {
    expect(isRoutineOfficialUpdate("最高裁、違憲判決を言い渡し", ["courts-news"])).toBe(false);
  });

  it("decidePublishはルーティン更新をrejectする", () => {
    const decision = decidePublish({
      ...base,
      classification: "official",
      clusterTitle: "最高裁判所開廷期日情報が更新されました",
      feedNames: ["courts-kijitsu"],
      memberTitles: ["最高裁判所開廷期日情報が更新されました (fp:deadbeef01)"],
    });
    expect(decision.action).toBe("reject");
    expect(decision.reason).toContain("routine_admin_update");
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

  it("声明対立型の芸能ニュース（事務所vs本人の声明）は機械的な除外パターンでも通す", () => {
    expect(
      isOutOfScopeTopic("事務所が声明を発表、本人は不倫を否定", ["所属事務所が謝罪声明"]),
    ).toBe(false);
    expect(
      isOutOfScopeTopic("ハラスメント疑惑で契約解除、本人は反論", ["会社側が契約解除を発表"]),
    ).toBe(false);
  });

  it("声明対立の無い単なる熱愛・結婚報告は引き続き対象外", () => {
    expect(isOutOfScopeTopic("芸能人カップルが熱愛発覚", ["交際3年で結婚へ"])).toBe(true);
  });
});

describe("looksLikeDeclarationConflict", () => {
  it("声明・反論・契約解除などの火種シグナルを検出する", () => {
    expect(looksLikeDeclarationConflict("事務所が声明を発表", "本人は否定")).toBe(true);
    expect(looksLikeDeclarationConflict("日銀の政策金利判断")).toBe(false);
  });
});

describe("isBreakingNews / hasPrimarySource", () => {
  it("軍事侵攻報道はLIVE緊急", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: ["foreign_conflict"],
        clusterTitle: "隣国への軍事侵攻",
        memberTitles: ["全面侵攻が始まる"],
      }),
    ).toBe(true);
  });

  it("継続中の紛争報道（侵攻・開戦なし）はLIVEにしない", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: ["foreign_conflict"],
        clusterTitle: "ウクライナ東部で激戦",
      }),
    ).toBe(false);
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

  it("disasterフラグ単独ではLIVEにしない", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: ["disaster"],
        clusterTitle: "南海トラフ沿いで大地震が発生",
      }),
    ).toBe(false);
  });

  it("crime_relatedフラグ単独ではLIVEにしない", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: ["crime_related"],
        clusterTitle: "会社員が万引きで逮捕される",
      }),
    ).toBe(false);
  });

  it("テロ・銃撃報道はLIVE緊急", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: ["crime_related"],
        clusterTitle: "繁華街で発砲事件、複数人が巻き込まれ死者",
        memberTitles: ["現場で銃撃、死者複数か"],
      }),
    ).toBe(true);
  });

  it("大規模火災だけではLIVEにしない", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: [],
        clusterTitle: "住宅街の対応をどう見る？",
        memberTitles: ["市街地で大規模火災、数百世帯に避難指示"],
      }),
    ).toBe(false);
  });

  it("震度6強+被害キーワードはLIVE", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: [],
        clusterTitle: "関東地方の地震への対応をどう見る？",
        memberTitles: ["関東で震度6強の地震", "倒壊家屋多数・死者確認"],
      }),
    ).toBe(true);
  });

  it("震度6強のみ（被害記述なし）はLIVEにしない", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        riskFlags: [],
        clusterTitle: "関東地方の地震への対応をどう見る？",
        memberTitles: ["関東で震度6強の地震 交通機関に乱れ"],
      }),
    ).toBe(false);
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

/** LIVE緊急キーワードの回帰防止 */
describe("isBreakingNews — 超重大事件（必ずLIVE判定）", () => {
  const incidentBase = {
    ...base,
    classification: "incident" as const,
    riskFlags: [] as string[],
  };

  it.each([
    { label: "暗殺", clusterTitle: "要人暗殺", memberTitles: ["要人が暗殺される"] },
    { label: "テロ", clusterTitle: "首都でテロが発生", memberTitles: ["テロ攻撃"] },
    { label: "爆発", clusterTitle: "工場で大規模爆発", memberTitles: ["現場で爆発"] },
    { label: "空爆", clusterTitle: "中東で空爆", memberTitles: ["複数の空爆が報告される"] },
    { label: "侵攻", clusterTitle: "隣国への侵攻が始まる", memberTitles: ["軍事侵攻"] },
    { label: "開戦", clusterTitle: "開戦の可能性", memberTitles: ["両国が開戦を宣言"] },
    { label: "震度7", clusterTitle: "東日本の地震", memberTitles: ["最大震度７を観測"] },
    { label: "衆院選開票", clusterTitle: "衆院選", memberTitles: ["衆院選の開票速報"] },
    { label: "内閣成立", clusterTitle: "新政権", memberTitles: ["新内閣が成立"] },
    {
      label: "assassination（英字）",
      clusterTitle: "World reacts to assassination",
      memberTitles: ["Assassination reported in capital"],
    },
    {
      label: "mass shooting（英字）",
      clusterTitle: "US mass shooting",
      memberTitles: ["Deadly mass shooting at school"],
    },
    {
      label: "missile strike（英字）",
      clusterTitle: "Missile strike reported",
      memberTitles: ["Several killed in missile strike"],
    },
  ])("$label はLIVE緊急", ({ clusterTitle, memberTitles }) => {
    expect(isBreakingNews({ ...incidentBase, clusterTitle, memberTitles })).toBe(true);
  });

  it.each([
    { label: "暗殺", clusterTitle: "要人暗殺", memberTitles: ["要人が暗殺される"] },
    {
      label: "震度6強+被害",
      clusterTitle: "関東の地震",
      memberTitles: ["震度6強を観測", "死者多数・甚大な被害"],
    },
  ])("超重大: $label は decidePublish まで通ってREPORTED公開", ({ clusterTitle, memberTitles }) => {
    const input = { ...incidentBase, clusterTitle, memberTitles };
    expect(isBreakingNews(input)).toBe(true);
    const d = decidePublish(input);
    expect(d.action).toBe("publish");
    if (d.action === "publish") {
      expect(d.confirmation).toBe("REPORTED");
      expect(d.reason).toContain("breaking");
    }
  });
});

/** LIVE誤検知・見落としの境界。閾値変更時に意図せず壊れないよう固定 */
describe("isBreakingNews — 境界・落とし穴", () => {
  const breakingInput = {
    ...base,
    classification: "incident" as const,
    clusterTitle: "要人暗殺",
    memberTitles: ["要人が暗殺される"],
  };

  it("report/scandal分類でもLIVEキーワード一致ならLIVE（選挙等）", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "report",
        clusterTitle: "衆院選",
        memberTitles: ["衆院選の開票速報"],
      }),
    ).toBe(true);
  });

  it("distinctFeeds=1 ではキーワード一致でもLIVEにしない", () => {
    expect(isBreakingNews({ ...breakingInput, distinctFeeds: 1 })).toBe(false);
  });

  it("6時間超の古いテロ報道はLIVEにしない", () => {
    expect(
      isBreakingNews({
        ...breakingInput,
        minutesSinceLatest: 361,
      }),
    ).toBe(false);
  });

  it("ちょうど360分はLIVE対象（境界値）", () => {
    expect(
      isBreakingNews({
        ...breakingInput,
        minutesSinceLatest: 360,
      }),
    ).toBe(true);
  });

  it("nanoが中立化したクラスタタイトルだけでは落ちるが元見出しで救済できる", () => {
    expect(
      isBreakingNews({
        ...base,
        classification: "incident",
        clusterTitle: "首都での事件への対応をどう見る？",
        memberTitles: ["首都でテロ攻撃、複数人が負傷"],
      }),
    ).toBe(true);
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

describe("computeBuzzScore", () => {
  const sources = {
    googleTerms: ["国旗損壊罪"],
    yahooRealtimeTerms: ["国旗損壊"],
    newsRankingTitles: ["国旗損壊罪の法案が参院で審議入り"],
    youtubeTrendingTitles: ["国旗損壊罪の法案が参院で審議入り"],
  };

  it("4ソースすべて一致すればscore=4、effectiveScore=5（YouTube+YahooRT検証ボーナス+1）", () => {
    const hit = computeBuzzScore("国旗損壊罪", sources);
    expect(hit.inGoogleTrends).toBe(true);
    expect(hit.inYahooRealtime).toBe(true);
    expect(hit.inNewsRanking).toBe(true);
    expect(hit.inYouTubeTrending).toBe(true);
    expect(hit.score).toBe(4);
    expect(hit.youtubeYahooVerified).toBe(true);
    expect(hit.effectiveScore).toBe(5);
  });

  it("どのソースにも無ければscore=0", () => {
    const hit = computeBuzzScore("全然関係ない話題", sources);
    expect(hit.score).toBe(0);
    expect(hit.effectiveScore).toBe(0);
  });

  it("検索語系は部分一致（互いに含む/含まれる）で判定する", () => {
    expect(
      computeBuzzScore("国旗損壊", {
        ...sources,
        googleTerms: [],
        newsRankingTitles: [],
        youtubeTrendingTitles: [],
      }).inYahooRealtime,
    ).toBe(true);
  });

  it("争点アンカー語でニュースと検索語を横断一致する", () => {
    const hit = computeBuzzScore("高市首相", {
      googleTerms: [],
      yahooRealtimeTerms: ["高市首相"],
      newsRankingTitles: ["高市首相、NATO首脳会議を欠席へ"],
      youtubeTrendingTitles: [],
    });
    expect(hit.inYahooRealtime).toBe(true);
    expect(hit.inNewsRanking).toBe(true);
    expect(hit.score).toBe(2);
  });
});

describe("toIssueCategory", () => {
  it("既知のcategoryをIssueCategoryにマップする", () => {
    expect(toIssueCategory("law")).toBe("LAW");
    expect(toIssueCategory("finance")).toBe("FINANCE");
  });

  it("nano独自のカテゴリ(rights/international)はPOLITICSに畳み込む", () => {
    expect(toIssueCategory("rights")).toBe("POLITICS");
    expect(toIssueCategory("international")).toBe("POLITICS");
  });

  it("society/entertainmentは専用カテゴリにマップする", () => {
    expect(toIssueCategory("society")).toBe("SOCIETY");
    expect(toIssueCategory("entertainment")).toBe("ENTERTAINMENT");
  });

  it("未知のcategoryはPOLITICSにフォールバック", () => {
    expect(toIssueCategory("unknown")).toBe("POLITICS");
  });
});

describe("shouldUseInternationalReports", () => {
  it("internationalカテゴリや戦争・外交トピックは海外報道を使う", () => {
    expect(shouldUseInternationalReports("international", "何か")).toBe(true);
    expect(shouldUseInternationalReports(null, "ウクライナ情勢の停戦交渉")).toBe(true);
    expect(shouldUseInternationalReports("politics", "米国の対中関税引き上げ")).toBe(true);
  });

  it("国内主の社会・経済トピックは海外報道を使わない", () => {
    expect(shouldUseInternationalReports("society", "著名人のハラスメント疑惑と本人の反論")).toBe(false);
    expect(shouldUseInternationalReports("economy", "最低賃金引き上げ論議")).toBe(false);
    expect(shouldUseInternationalReports("finance", "日銀の政策金利判断")).toBe(false);
  });
});
