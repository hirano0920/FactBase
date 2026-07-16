import { describe, expect, it } from "vitest";
import {
  assessReportExcerptThickness,
  autoRepairArticle,
  checkBulletsThickness,
  checkDuplicateFacts,
  checkIncidentFirst,
  checkLeadOpeningMatch,
  checkRelatabilityBridge,
  checkSentenceLength,
  checkSidesGrounding,
  enrichSummaryForDisplay,
  findStructureIssues,
  normalizeArticleSurfaces,
  finalizeArticleForSave,
  CLEAR_DECLARATION_BAD_HTML,
  CLEAR_DECLARATION_GOOD_HTML,
  MESSY_NORM_FLARE_GOOD_HTML,
  MESSY_POLICY_GOOD_HTML,
  SIDES_UNGROUNDED_BAD_HTML,
} from "@/lib/article-quality";

describe("checkIncidentFirst", () => {
  it("CLEAR_DECLARATION 悪い例: 否定先行で事件内容無し", () => {
    const issue = checkIncidentFirst(CLEAR_DECLARATION_BAD_HTML, { isReported: true });
    expect(issue?.reason).toBe("incident_first_missing");
  });

  it("CLEAR_DECLARATION 良い例: 接触・発言が先", () => {
    expect(checkIncidentFirst(CLEAR_DECLARATION_GOOD_HTML, { isReported: true })).toBeNull();
  });

  it("MESSY_POLICY（非対称な政策対立）も冒頭に具体があれば合格", () => {
    expect(checkIncidentFirst(MESSY_POLICY_GOOD_HTML, { isReported: false })).toBeNull();
  });

  it("MESSY_NORM_FLARE（声明の無い炎上）も行為が先なら合格", () => {
    expect(checkIncidentFirst(MESSY_NORM_FLARE_GOOD_HTML, { isReported: true })).toBeNull();
  });
});

describe("checkSentenceLength", () => {
  it("複数事実を1文に詰め込んだ長文（帰属の使い回し）は不合格", () => {
    const html =
      "<h2>いま分かっていること</h2><p>Yahoo!ニュースは中央日報の報道を基に中国の作家蔣方舟氏が2019年に提出した修士学位論文で海外論文との重複と引用表記の欠如が確認され中国人民大学から学位を取り消されたと伝えています。さらに週刊文春は別の関係者の独自取材として学位取り消しの背景に大学内部の政治的事情が関与していた可能性にも言及しておりこの点について大学側はコメントを避けていると報じておりさらに文部科学省も事実関係の確認を始めたと各社が伝えており与野党の間では今後の学会の在り方を巡り議論が続いており予断を許さない状況とされている。</p>";
    const issue = checkSentenceLength({ articleHtml: html });
    expect(issue?.reason).toBe("sentence_too_long");
  });

  it("同じ帰属を保ったまま文を分割していれば合格", () => {
    const html =
      "<h2>いま分かっていること</h2><p>中央日報は、蔣方舟氏が2019年に修士論文を提出したと伝えています。Yahoo!ニュースは、その論文に海外論文との重複が確認され学位が取り消されたとも報じています。</p>";
    expect(checkSentenceLength({ articleHtml: html })).toBeNull();
  });
});

describe("checkBulletsThickness", () => {
  it("メタ立場だけの両側は不合格", () => {
    const issue = checkBulletsThickness(
      [
        "報道の内容: 週刊文春がドラマ撮影中の身体的接触と楽屋での否定的な発言があったと報じたという内容です",
        "佐藤二朗さん側: 全面否定する立場",
        "週刊文春・報道側: 事実だとする立場",
      ],
      { isReported: true },
    );
    expect(issue?.reason).toBe("bullets_too_thin");
  });

  it("具体が入った bullets は合格", () => {
    expect(
      checkBulletsThickness(
        [
          "報道の内容: 週刊文春はドラマ撮影中の身体的接触と、楽屋でのキャリアに関する否定的な発言があったと報じた",
          "佐藤二朗さん側: 報道は創作であり、専門家確認でもハラスメントの定義に当たらないと主張している",
          "週刊文春・報道側: 複数の関係者取材に基づき、撮影中の接触と楽屋での発言があったとする",
        ],
        { isReported: true },
      ),
    ).toBeNull();
  });

  it("1項目目が対立の構図の説明だけで実際の発言・行為の中身が無い場合は不合格", () => {
    // 実例: 「発言」「解雇」等のトークンはINCIDENT_SUBSTANCEに一致するため、
    // 対立の構図を説明しているだけの文でも従来は合格していた（読者が争点の中身を
    // 把握できず投票できないという実際の報告を受けて追加）
    const issue = checkBulletsThickness(
      [
        "争点の軸: 車掌の車内アナウンスでの外国人向け発言と、それに対する即時解雇処分の是非を巡る規範的な対立",
        "擁護側: 車掌とオープンな対話を重ね将来的な再雇用の機会を判断する。根拠として責任者の意向が報じられている",
        "批判側: 乗客を侮辱したり排除したりする言動を一切容認せず即時解雇した。根拠として謝罪声明がある",
      ],
      { isReported: true },
    );
    expect(issue?.reason).toBe("bullets_too_thin");
  });
});

describe("checkSidesGrounding", () => {
  it("片側が教科書一般論だけの記事は不合格", () => {
    const issue = checkSidesGrounding(SIDES_UNGROUNDED_BAD_HTML);
    expect(issue?.reason).toMatch(/sides_ungrounded|sides_asymmetric/);
  });

  it("両側に帰属があるCLEAR例は合格", () => {
    expect(checkSidesGrounding(CLEAR_DECLARATION_GOOD_HTML)).toBeNull();
  });

  it("両側に帰属がある政策例は合格", () => {
    expect(checkSidesGrounding(MESSY_POLICY_GOOD_HTML)).toBeNull();
  });
});

describe("checkLeadOpeningMatch", () => {
  it("leadと冒頭が別内容なら不合格", () => {
    const issue = checkLeadOpeningMatch({
      lead: "本日のニュースでは経済指標の発表があり市場が反応しましたが詳細はまだ不明で議論が続いています。専門家は追加の説明を求めており、今後の政策判断にも影響が出るとみられています。別件の要約です。",
      articleHtml: CLEAR_DECLARATION_GOOD_HTML,
    });
    expect(issue?.reason).toBe("lead_opening_mismatch");
  });

  it("短いスタブリードはスキップ", () => {
    expect(
      checkLeadOpeningMatch({ lead: "短いlead", articleHtml: CLEAR_DECLARATION_GOOD_HTML }),
    ).toBeNull();
  });
});

describe("checkRelatabilityBridge", () => {
  it("タイトルに貿易フックがあるのに本文に波及が無いと不合格", () => {
    const html = `<h2>いま何が論点か</h2><p>政府は防衛費の引き上げ方針を閣議決定したと発表しています。与野党で賛否が分かれています。装備更新の是非が焦点です。</p>
<h2>どこで意見が分かれるか</h2><ul><li><strong>推進:</strong> 抑止が必要</li><li><strong>慎重:</strong> 財源が不安</li></ul>`;
    const issue = checkRelatabilityBridge(html, "防衛費増—貿易・円相場への波及は？");
    expect(issue?.reason).toBe("relatability_missing");
  });

  it("フックが本文にあれば合格", () => {
    expect(
      checkRelatabilityBridge(SIDES_UNGROUNDED_BAD_HTML, "ロシア諜報—貿易・安全保障に波及は？"),
    ).toBeNull();
  });
});

describe("autoRepairArticle", () => {
  it("混在する側から教科書一般論の<li>だけ落とす", () => {
    const html = `<h2>いま何が論点か</h2><p>政府は防衛費の引き上げ方針を閣議決定したと発表しています。与野党で財源と抑止の是非が論点です。</p>
<h2>賛成側が言うこと</h2><ul><li>与党議員は抑止に必要な装備更新が遅れていると指摘する</li><li>防衛省関係者は同盟国との負担是正が必要だと述べている</li><li>過度な規制が国際競争力を損なう恐れがある</li></ul>
<h2>反対側が言うこと</h2><ul><li>野党は国債増発で将来世代の負担が増えると主張する</li><li>野党議員は医療・教育予算とのトレードオフが説明不足だと国会で指摘した</li></ul>
<h2>出典</h2><ul><li><a href="https://example.com">例</a></li></ul>`;
    const repaired = autoRepairArticle(
      {
        lead: "短い",
        bullets: [
          "いま分かっていること: 防衛費の引き上げ方針を閣議で決定したと政府が発表し財源が争点になっている",
          "賛成側: 装備更新の遅れを指摘する",
          "反対側: 国債増発の負担を主張する",
        ],
        articleHtml: html,
      },
      { issueTitle: "防衛費—家計・税金への影響は？" },
    );
    expect(repaired.articleHtml).toContain("家計");
    expect(repaired.articleHtml).not.toContain("国際競争力を損なう恐れがある");
    expect(repaired.articleHtml).toContain("装備更新が遅れている");
    expect(checkSidesGrounding(repaired.articleHtml)).toBeNull();
  });

  it("全員が教科書一般論の側は0円では触らず残す（mini修理前提）", () => {
    const repaired = autoRepairArticle(
      {
        lead: "短い",
        bullets: ["a", "b", "c"],
        articleHtml: SIDES_UNGROUNDED_BAD_HTML,
      },
      { issueTitle: "ロシア諜報" },
    );
    expect(repaired.articleHtml).toContain("国際競争力を損なう恐れがある");
    expect(checkSidesGrounding(repaired.articleHtml)?.reason).toMatch(
      /sides_ungrounded|sides_asymmetric/,
    );
  });

  it("lead不一致は正規化で解消される", () => {
    const repaired = autoRepairArticle(
      {
        lead: "本日のニュースでは経済指標の発表があり市場が反応しましたが詳細はまだ不明で議論が続いています。専門家は追加の説明を求めており、今後の政策判断にも影響が出るとみられています。別件の要約です。",
        bullets: [
          "報道の内容: 週刊文春はドラマ撮影中の身体的接触と楽屋でのキャリアに関する否定的な発言があったと報じた",
          "佐藤二朗さん側: 報道は創作であり専門家確認でもハラスメント定義に当たらないと主張している",
          "週刊文春・報道側: 複数の関係者取材に基づき撮影中の接触と楽屋での発言があったとする",
        ],
        articleHtml: CLEAR_DECLARATION_GOOD_HTML,
      },
      { issueTitle: "声明対立のテスト" },
    );
    expect(checkLeadOpeningMatch(repaired)).toBeNull();
  });
});

describe("normalizeArticleSurfaces", () => {
  it("leadを冒頭セクションに揃え、薄いbulletsを両側から補う", () => {
    const synced = normalizeArticleSurfaces({
      lead: "短い別要約",
      bullets: [
        "いま分かっていること: トラブル",
        "慎重派: 現行法で対応可能だ",
        "警戒派: 反対",
      ],
      articleHtml: CLEAR_DECLARATION_GOOD_HTML,
    });
    expect(synced.lead).toContain("週刊文春");
    expect(synced.bullets[0]).toContain("接触");
    expect(synced.bullets[1].length).toBeGreaterThan(40);
  });
});

describe("finalizeArticleForSave", () => {
  it("normalizeArticleSurfaces同期後にfindStructureIssuesを実行し、両方の結果を返す", () => {
    const result = finalizeArticleForSave(
      {
        lead: "短い別要約",
        bullets: [
          "いま分かっていること: トラブル",
          "慎重派: 現行法で対応可能だ",
          "警戒派: 反対",
        ],
        articleHtml: CLEAR_DECLARATION_GOOD_HTML,
      },
      { isReported: true },
    );
    expect(result.article.lead).toContain("週刊文春");
    expect(Array.isArray(result.issues)).toBe(true);
  });
});

describe("enrichSummaryForDisplay", () => {
  it("薄い1項目目を記事冒頭の具体で置き換える", () => {
    const enriched = enrichSummaryForDisplay(
      {
        lead: "短いlead",
        bullets: [
          "いま分かっていること: トラブルを巡る報道がある",
          "A側: 否定している",
          "B側: 事実だとしている",
        ],
        sources: [],
      },
      CLEAR_DECLARATION_GOOD_HTML,
    );
    expect(enriched.bullets[0]).toContain("接触");
    expect(enriched.lead).toContain("週刊文春");
  });
});

describe("checkDuplicateFacts", () => {
  it("良いCLEAR例は再掲が少ない", () => {
    expect(checkDuplicateFacts(CLEAR_DECLARATION_GOOD_HTML)).toBeNull();
  });
});

describe("findStructureIssues", () => {
  it("悪いCLEARは構造不合格", () => {
    const issues = findStructureIssues(
      {
        articleHtml: CLEAR_DECLARATION_BAD_HTML,
        bullets: ["いま分かっていること: 対立", "A: 否定", "B: 事実"],
      },
      { isReported: true },
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("良いMESSY政策は構造合格（きれいな二項でなくてよい）", () => {
    expect(
      findStructureIssues(
        {
          articleHtml: MESSY_POLICY_GOOD_HTML,
          lead: "政府は来年度予算案で防衛費をGDP比2%超まで引き上げる方針を閣議決定したと発表しています。与党内にも財源の国債依存を不安視する声があり、野党は社会保障との両立を問題視しています。数字の是非だけでなく、何を削って何を積むかが争点です。",
          bullets: [
            "いま分かっていること: 防衛費の引き上げ方針を閣議で決定したと政府が発表し、財源の国債依存が争点になっている",
            "賛成側が言うこと: 抑止に必要な装備更新が遅れており同盟国との負担是正が必要だと主張する",
            "反対側が言うこと: 国債増発と医療・教育予算とのトレードオフが説明不足だと指摘する",
          ],
        },
        { isReported: false },
      ),
    ).toEqual([]);
  });

  it("教科書一般論の片側記事はsides系で不合格", () => {
    const issues = findStructureIssues(
      {
        articleHtml: SIDES_UNGROUNDED_BAD_HTML,
        lead: "ニューヨーク・タイムズは、ロシアが日本をスパイ活動の拠点とし、制裁回避で工作機械や電子部品を入手している可能性を報じています。テンプル大学の教授は防諜体制の脆弱さに警鐘を鳴らしました。貿易や安全保障への波及が論点です。",
        bullets: [
          "いま分かっていること: ロシアのスパイ活動と部品調達の可能性が報じられ防諜体制が論点になっている",
          "警戒強化派: ニューヨーク・タイムズは工作員が先端技術を狙っていると報じている",
          "慎重派: 現行法で対応可能で過度な規制が国際競争力を損なう恐れがある",
        ],
      },
      {
        isReported: true,
        issueTitle: "ロシア諜報機関員—貿易・円相場・安全保障に波及は現実的か？",
      },
    );
    expect(issues.some((i) => i.reason === "sides_ungrounded" || i.reason === "sides_asymmetric")).toBe(
      true,
    );
  });
});

describe("assessReportExcerptThickness", () => {
  it("抜粋0件は不合格", () => {
    expect(assessReportExcerptThickness([]).ok).toBe(false);
  });

  it("具体トークンと十分な量があれば合格", () => {
    // 新閾値: totalChars >= 1500, concreteSignal >= 3, outlets >= 2
    const excerpt1 =
      "文春は、逮捕された元議員の起訴決定を報じた。検察は公選法違反での立件を発表し、押収した証拠を分析している。裁判所は保釈を認める決定をしたが、検察側は即時抗告する方針だ。".repeat(
        15,
      );
    const excerpt2 =
      "朝日も同事件を報じ、公選法違反での起訴に踏み切った検察の判断を伝えている。被告人側は不起訴を求めていたが、起訴決定が下された。今後の裁判で証拠の信用性が争点になる。".repeat(
        15,
      );
    expect(
      assessReportExcerptThickness([
        { feed: "文春", text: excerpt1 },
        { feed: "朝日", text: excerpt2 },
      ]).ok,
    ).toBe(true);
  });
});
