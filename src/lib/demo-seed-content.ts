/**
 * デモ・テスト用の争点・コメント・投票データ。
 * mock-data（DB未接続時）と scripts/seed-demo-data.ts（Neon投入）で共用。
 */
import type { CategoryId, VoteChoiceId } from "@/lib/constants";

export interface DemoIssueDef {
  slug: string;
  title: string;
  category: CategoryId;
  status: "active" | "trending" | "passed";
  confirmation: "official" | "reported" | null;
  /** LIVE（reported）のみ。確定記事は null */
  monitoringUntil: string | null;
  summary: {
    lead: string;
    bullets: string[];
    sources: { label: string; url: string }[];
  };
  articleHtml: string | null;
  articleGeneratedAt: string | null;
  votes: { for: number; against: number; undecided: number };
  commentCount: number;
  createdAt: string;
  timeline?: { label: string; sourceUrl?: string; at: string }[];
}

export interface DemoCommentDef {
  slug: string;
  userName: string;
  userPlan: "FREE" | "COMMENT" | "FACTCHECK";
  userCommentCount: number;
  userTotalLikes: number;
  stance: VoteChoiceId;
  body: string;
  likeCount: number;
  helpfulCount: number;
  createdAt: string;
}

export const DEMO_ISSUES: DemoIssueDef[] = [
  {
    slug: "boj-normalization-yen-depreciation",
    title: "日本の金融政策正常化と歴史的な円安の進行",
    category: "finance",
    status: "trending",
    confirmation: "reported",
    monitoringUntil: "2026-10-01T00:00:00Z",
    summary: {
      lead:
        "日本は長年のデフレと超低金利政策から脱却し、政策金利を1.0%まで引き上げるなど「金利のある世界」への移行過程にあります。市場では1ドル161円台という約40年ぶりの円安水準が継続し、日米金利差と構造的円安要因を巡る議論が白熱しています。",
      bullets: [
        "状況: 日銀は段階的な金融政策正常化を進め、政策金利は1.0%水準まで引き上げられている",
        "論点（メリット）: 銀行収益の改善、マイナス金利下の副作用是正など",
        "論点（懸念）: 国債利払い負担の増大、家計・企業の負債コスト上昇、円安の持続",
        "注視: 政府の為替介入姿勢と日銀の今後の利上げペースが連日議論の焦点",
      ],
      sources: [
        { label: "日本銀行", url: "https://www.boj.or.jp/" },
        { label: "財務省", url: "https://www.mof.go.jp/" },
      ],
    },
    articleHtml: null,
    articleGeneratedAt: null,
    votes: { for: 1842, against: 1695, undecided: 1310 },
    commentCount: 4,
    createdAt: "2026-07-01T06:00:00Z",
    timeline: [
      { label: "速報スレ公開（報道ベース）", at: "2026-07-01T06:00:00Z" },
      { label: "円相場が161円台に — 続報", sourceUrl: "https://www.boj.or.jp/", at: "2026-07-02T09:30:00Z" },
      { label: "日銀、政策金利据え置きを決定 — 声明を整理", at: "2026-07-03T14:00:00Z" },
    ],
  },
  {
    slug: "us-semiquincentennial-2026",
    title: "米国建国250周年（セミクインセンテニアル）",
    category: "politics",
    status: "active",
    confirmation: "official",
    monitoringUntil: null,
    summary: {
      lead:
        "2026年7月4日、アメリカは1776年の独立宣言から250周年という歴史的な節目を迎えました。国家的アイデンティティの再確認と同時に、11月の中間選挙に向けた政治的前哨戦の時期でもあります。",
      bullets: [
        "2026年7月4日が建国250周年の節目",
        "記念行事とともに中間選挙前の政治動向が注目される",
        "経済・外交・安全保障の国家運営ビジョンが世界の関心を集める",
      ],
      sources: [
        { label: "U.S. Semiquincentennial Commission", url: "https://www.america250.org/" },
        { label: "外務省", url: "https://www.mofa.go.jp/" },
      ],
    },
    articleHtml: `<h2>ポイント</h2>
<ul>
<li><strong>何が起きたか:</strong> 2026年7月4日、米国が独立宣言から<strong>250年</strong>の節目（セミクインセンテニアル）を迎え、全国的な記念行事が実施された。</li>
<li><strong>なぜ今:</strong> 11月の中間選挙を控え、政党間の攻防が本格化する時期と重なった。</li>
<li><strong>誰に影響:</strong> 同盟国・貿易相手国としての米国の政治的安定性は、日本の外交・安全保障・通商政策に直結する。</li>
</ul>
<h2>詳しく（背景と経緯）</h2>
<ul>
<li>米国建国250周年委員会（America250）が主導し、全米各地で記念式典・展示が催された。</li>
<li>記念年は例年以上に国内政治の分極化が意識される時期と重なっており、報道各社も選挙情勢とあわせて扱っている。</li>
</ul>
<h2>国内外の報道比較</h2>
<ul>
<li><strong>国内:</strong> 節目の意義と同盟国への影響を中心に、外交・安全保障の観点から報じる論調が目立つ。</li>
<li><strong>海外:</strong> 記念行事そのものに加え、国内政治の分極化や中間選挙前の党派対立を強調する報道が多い。</li>
</ul>
<h2>賛成の主な理由</h2>
<ul>
<li>250年という節目は民主制度の歴史を振り返る好機であり、同盟関係を再確認する機会になる。</li>
<li>日米協調の枠組みは地域の安定に不可欠という見方が強い。</li>
<li>記念行事を通じた国民的一体感の醸成は、政治的分極化への一定の歯止めになり得る。</li>
</ul>
<h2>反対の主な理由</h2>
<ul>
<li>国内政治の分極化が外交・貿易政策の不確実性を高めるリスクがあるという懸念がある。</li>
<li>記念イベントの象徴性だけでなく、実際の政策の中身を見るべきだという指摘がある。</li>
<li>中間選挙前の政治的パフォーマンスとして利用されているという見方もある。</li>
</ul>
<h2>現時点で確認できないこと</h2>
<ul>
<li>中間選挙後の対外政策（通商・安全保障）が実際にどう変化するかは未確定。</li>
</ul>
<h2>今後の見通し</h2>
<ul>
<li>11月の中間選挙結果と、その後の政権運営の方向性が焦点になる。</li>
</ul>
<h2>出典</h2>
<ul>
<li><a href="https://www.america250.org/">U.S. Semiquincentennial Commission</a></li>
<li><a href="https://www.mofa.go.jp/">外務省</a></li>
</ul>`,
    articleGeneratedAt: "2026-07-04T12:00:00Z",
    votes: { for: 892, against: 654, undecided: 1455 },
    commentCount: 4,
    createdAt: "2026-07-04T00:00:00Z",
  },
  {
    slug: "global-sports-events-2026",
    title: "2026年国際スポーツイベントと経済波及効果",
    category: "economy",
    status: "active",
    confirmation: "official",
    monitoringUntil: null,
    summary: {
      lead:
        "2026年はミラノ・コルティナ冬季五輪（2月）やFIFAワールドカップ（6〜7月）など、世界規模のスポーツイベントが確定事項として実施されました。観光需要・インフラ投資・広告市場への波及が議論されています。",
      bullets: [
        "ミラノ・コルティナ2026冬季五輪、FIFAワールドカップ2026（48チーム制）が実施",
        "観光需要の喚起、スポンサー・メディア関連の経済効果が注目",
        "ナショナリズムと経済が交差する大規模イベントとして位置づけられる",
      ],
      sources: [
        { label: "IOC", url: "https://olympics.com/" },
        { label: "FIFA", url: "https://www.fifa.com/" },
      ],
    },
    articleHtml: `<h2>ポイント</h2>
<ul>
<li><strong>何を決定・発表したか:</strong> 2026年2月のミラノ・コルティナ冬季五輪、6〜7月のFIFAワールドカップ（史上最多<strong>48チーム</strong>参加）が確定事項として実施された。</li>
<li><strong>理由や背景:</strong> いずれも開催日程・形式が既に確定し、関連投資・マーケティングが本格化している。</li>
<li><strong>市場や生活への影響:</strong> 観光需要・インフラ投資・広告市場への波及効果が議論の中心。</li>
</ul>
<h2>詳しく（背景と経緯）</h2>
<ul>
<li>観光・宿泊・交通需要の一時的な押し上げが見込まれる。</li>
<li>スポンサー契約・放送権・関連グッズ市場の拡大が進んでいる。</li>
<li>日本企業の海外スポンサー投資・ブランディング機会としても注目されている。</li>
</ul>
<h2>国内外の報道比較</h2>
<ul>
<li><strong>国内:</strong> 日本代表の露出機会や国内企業のスポンサー効果を中心に報じられている。</li>
<li><strong>海外:</strong> 開催地の経済効果・インフラ投資・チケット需要を中心に報じられており、大きな論調の違いは確認できない。</li>
</ul>
<h2>賛成の主な理由</h2>
<ul>
<li>グローバルな注目イベントは観光・宿泊・広告など関連産業全体に需要を生む。</li>
<li>48チーム制はアジア枠拡大など日本代表の露出機会増にもつながる。</li>
<li>日本企業にとって海外スポンサー投資・ブランディングの好機になる。</li>
</ul>
<h2>反対の主な理由</h2>
<ul>
<li>イベント後の需要急減やインフラ維持コストが懸念されている。</li>
<li>効果を一律に肯定せず、五輪とW杯それぞれの費用対効果を個別に評価すべきという指摘がある。</li>
<li>経済効果の恩恵は地域・企業によって偏りがあるという見方もある。</li>
</ul>
<h2>出典</h2>
<ul>
<li><a href="https://olympics.com/">IOC</a></li>
<li><a href="https://www.fifa.com/">FIFA</a></li>
</ul>`,
    articleGeneratedAt: "2026-07-01T08:00:00Z",
    votes: { for: 2103, against: 987, undecided: 756 },
    commentCount: 4,
    createdAt: "2026-06-20T00:00:00Z",
  },
  {
    slug: "subcontract-fair-trade-act-2026",
    title: "中小受託取引適正化法の施行と労働環境の法整備",
    category: "law",
    status: "active",
    confirmation: "official",
    monitoringUntil: null,
    summary: {
      lead:
        "2026年1月より、旧下請法を大幅にアップデートした「中小受託取引適正化法（取適法）」が施行されています。価格交渉の拒否や一方的な条件決定、手形払いの禁止などが厳格化され、カスハラ防止法の施行も確定しています。",
      bullets: [
        "2026年1月: 中小受託取引適正化法（取適法）施行 — 価格転嫁拒否・手形払い等を規制",
        "フリーランス・個人事業主を含む働き手保護の強化",
        "カスハラ防止法（改正労働施策総合推進法）の施行も確定",
        "適正な取引価格形成と労働環境整備が産業構造改革の柱として位置づけられる",
      ],
      sources: [
        { label: "公正取引委員会", url: "https://www.jftc.go.jp/" },
        { label: "厚生労働省", url: "https://www.mhlw.go.jp/" },
      ],
    },
    articleHtml: `<h2>ポイント</h2>
<ul>
<li><strong>何が変わる:</strong> 価格交渉の拒否や一方的な条件決定、手形払いが原則<strong>禁止</strong>となり、中小・小規模事業者の保護が拡充された。</li>
<li><strong>なぜ今:</strong> 旧下請法では対応しきれなかった取引実態に合わせ、フリーランス・個人事業主を含む形に大幅アップデートされた。</li>
<li><strong>誰に影響:</strong> 中小受託事業者・フリーランスと、発注側の大企業・中堅企業の双方の取引実務に影響する。</li>
</ul>
<h2>詳しく（背景と経緯）</h2>
<ul>
<li>長年の下請け構造では価格転嫁の拒否や支払い遅延が課題として指摘されてきた。</li>
<li>カスハラ防止法（改正労働施策総合推進法）の施行も同時期に確定し、働き方全体の保護強化とセットで進められている。</li>
</ul>
<h2>時系列</h2>
<ul>
<li><strong>2025年12月:</strong> 取適法・カスハラ防止法の施行日が確定と発表。</li>
<li><strong>2026年1月:</strong> 中小受託取引適正化法（取適法）が施行。</li>
<li><strong>2026年6月:</strong> 施行後半年の運用状況について、業界団体からガイドライン明確化の要望が報じられている。</li>
</ul>
<h2>法的な位置づけ</h2>
<ul>
<li>正式名称は中小受託取引適正化法。旧・下請代金支払遅延等防止法（下請法）を全面改定した現行法。</li>
</ul>
<h2>各立場の主張</h2>
<ul>
<li><strong>与党（自民・公明）:</strong> 中小企業の適正な価格転嫁を後押しする改革として施行を推進。</li>
<li><strong>野党:</strong> 保護強化の方向性自体は支持しつつ、運用面での実効性確保を政府に求めている。</li>
<li><strong>専門家・業界団体:</strong> 制度の趣旨には賛同する一方、現場の書類負担やガイドラインの明確化を求める声がある。</li>
</ul>
<h2>賛成の主な理由</h2>
<ul>
<li>長年の下請け構造の是正と適正価格の形成に不可欠だという見方が強い。</li>
<li>中小企業の経営安定と産業全体の競争力向上につながる。</li>
<li>フリーランス・個人事業主を含めた働き手保護の強化は時代の要請に合っている。</li>
</ul>
<h2>反対の主な理由</h2>
<ul>
<li>現場の書類負担や取引先との関係悪化を懸念する声がある。</li>
<li>実効性は運用・周知・行政指導の力度次第という指摘がある。</li>
<li>中小企業側のコンプライアンスコスト増を無視できないという見方もある。</li>
</ul>
<h2>現時点で確認できないこと</h2>
<ul>
<li>施行から半年時点での違反是正件数など、定量的な効果検証データはまだ確認できない。</li>
</ul>
<h2>今後の見通し</h2>
<ul>
<li>公正取引委員会によるガイドライン運用状況の公表と、違反事例への対応が焦点になる。</li>
</ul>
<h2>出典</h2>
<ul>
<li><a href="https://www.jftc.go.jp/">公正取引委員会</a></li>
<li><a href="https://www.mhlw.go.jp/">厚生労働省</a></li>
</ul>`,
    articleGeneratedAt: "2026-06-15T10:00:00Z",
    votes: { for: 2456, against: 812, undecided: 534 },
    commentCount: 4,
    createdAt: "2026-06-01T00:00:00Z",
    timeline: [
      { label: "取適法・カスハラ防止法の施行日確定", at: "2025-12-10T00:00:00Z" },
      { label: "中小受託取引適正化法（取適法）施行", sourceUrl: "https://www.jftc.go.jp/", at: "2026-01-05T00:00:00Z" },
      { label: "業界団体がガイドライン明確化を要望 — 続報", sourceUrl: "https://www.mhlw.go.jp/", at: "2026-06-10T00:00:00Z" },
    ],
  },
];

export const DEMO_COMMENTS: DemoCommentDef[] = [
  // 金融政策 LIVE
  {
    slug: "boj-normalization-yen-depreciation",
    userName: "マクロ経済ウォッチャー",
    userPlan: "COMMENT",
    userCommentCount: 18,
    userTotalLikes: 86,
    stance: "for",
    body: "日銀の正常化は長年の異常な金融緩和からの脱却として必要だと考えます。負の実質金利が続いた副作用も大きかった。ただし国債利払い増は財政健全化議論とセットで見るべきで、政府側の説明責任も重要です。",
    likeCount: 34,
    helpfulCount: 21,
    createdAt: "2026-07-02T08:15:00Z",
  },
  {
    slug: "boj-normalization-yen-depreciation",
    userName: "地方銀行勤務",
    userPlan: "FREE",
    userCommentCount: 5,
    userTotalLikes: 12,
    stance: "against",
    body: "金利上昇ペースが速すぎると住宅ローンや中小企業の資金繰りに直撃します。円安対策も金融政策だけでは限界があり、介入より構造要因の整理が先ではないかと懸念しています。",
    likeCount: 28,
    helpfulCount: 15,
    createdAt: "2026-07-02T11:40:00Z",
  },
  {
    slug: "boj-normalization-yen-depreciation",
    userName: "為替アナリスト志望",
    userPlan: "COMMENT",
    userCommentCount: 42,
    userTotalLikes: 210,
    stance: "undecided",
    body: "日米金利差と構造的円安要因が重なっており、政策金利だけでどこまで為替をコントロールできるかは未知数です。日銀と財務省の発言の整合性を見ながら、現時点では様子見の立場です。",
    likeCount: 19,
    helpfulCount: 11,
    createdAt: "2026-07-03T06:20:00Z",
  },
  {
    slug: "boj-normalization-yen-depreciation",
    userName: "公認会計士",
    userPlan: "FACTCHECK",
    userCommentCount: 67,
    userTotalLikes: 340,
    stance: "for",
    body: "政策金利1.0%への段階的引き上げは日銀の公式説明でも正常化路線の一環とされています。161円台の円安は介入基準との関係で財務省のコメントも注視点。ただし利上げと円安が同時進行するメカニズムは単純ではありません。",
    likeCount: 41,
    helpfulCount: 29,
    createdAt: "2026-07-03T16:55:00Z",
  },
  // 米国250周年
  {
    slug: "us-semiquincentennial-2026",
    userName: "国際政治マニア",
    userPlan: "COMMENT",
    userCommentCount: 31,
    userTotalLikes: 95,
    stance: "undecided",
    body: "250年という節目の意義と、中間選挙前の政治的分極化が同時に進む複雑なタイミングです。日本への直接影響は限定的かもしれませんが、同盟・貿易の観点では注視すべき局面だと思います。",
    likeCount: 15,
    helpfulCount: 8,
    createdAt: "2026-07-04T14:10:00Z",
  },
  {
    slug: "us-semiquincentennial-2026",
    userName: "外交安全保障",
    userPlan: "COMMENT",
    userCommentCount: 22,
    userTotalLikes: 58,
    stance: "for",
    body: "同盟国としての日米関係の安定は日本の安全保障上不可欠です。記念年は関係再確認の機会にもなり得ると考えます。政治空白期が長引かないことが重要です。",
    likeCount: 22,
    helpfulCount: 14,
    createdAt: "2026-07-04T18:30:00Z",
  },
  {
    slug: "us-semiquincentennial-2026",
    userName: "メディア批評",
    userPlan: "FREE",
    userCommentCount: 8,
    userTotalLikes: 0,
    stance: "against",
    body: "記念行事の華やかさだけが報じられがちで、国内政治の混乱が国際協調に与えるリスクは見過ごされがちです。節目として整理する価値はあるが、楽観は禁物だと感じます。",
    likeCount: 11,
    helpfulCount: 6,
    createdAt: "2026-07-05T09:00:00Z",
  },
  {
    slug: "us-semiquincentennial-2026",
    userName: "貿易実務",
    userPlan: "COMMENT",
    userCommentCount: 14,
    userTotalLikes: 33,
    stance: "undecided",
    body: "関税・通商政策との連動性は未知数で、250周年そのものより今後数か月の政策運営が実務上の焦点です。歴史的節目として情報整理する段階で、賛否を急ぐ必要はないと思います。",
    likeCount: 9,
    helpfulCount: 5,
    createdAt: "2026-07-05T11:20:00Z",
  },
  // スポーツイベント
  {
    slug: "global-sports-events-2026",
    userName: "スポーツビジネス",
    userPlan: "COMMENT",
    userCommentCount: 27,
    userTotalLikes: 112,
    stance: "for",
    body: "W杯48チーム制や五輪は観光・広告・関連インフラに確実な需要を生みます。日本企業のスポンサー投資も大きく、経済効果は一定規模あると見てよいと考えます。",
    likeCount: 38,
    helpfulCount: 24,
    createdAt: "2026-06-25T10:00:00Z",
  },
  {
    slug: "global-sports-events-2026",
    userName: "観光統計好き",
    userPlan: "FREE",
    userCommentCount: 6,
    userTotalLikes: 4,
    stance: "for",
    body: "アジア枠拡大を含むW杯は日本代表の露出機会も増えます。ブランド価値・Inbound需要の観点からもプラス評価です。ただし効果の持続性は別問題として見る必要があります。",
    likeCount: 25,
    helpfulCount: 13,
    createdAt: "2026-06-26T15:45:00Z",
  },
  {
    slug: "global-sports-events-2026",
    userName: "地方自治体職員",
    userPlan: "COMMENT",
    userCommentCount: 11,
    userTotalLikes: 19,
    stance: "against",
    body: "イベント後の需要急減やインフラ維持コスト、地方負担の議論もあります。効果を一律に肯定するのは早計で、五輪とW杯は別々に費用対効果を評価すべきだと思います。",
    likeCount: 17,
    helpfulCount: 10,
    createdAt: "2026-06-28T08:30:00Z",
  },
  {
    slug: "global-sports-events-2026",
    userName: "広告代理店",
    userPlan: "FACTCHECK",
    userCommentCount: 39,
    userTotalLikes: 156,
    stance: "undecided",
    body: "メディア露出は五輪とW杯で分散する可能性があり、スポンサーごとのROIは案件次第です。マクロな経済効果はある一方、個別企業・地域への恩恵は均等ではないと考えます。",
    likeCount: 14,
    helpfulCount: 9,
    createdAt: "2026-07-01T12:00:00Z",
  },
  // 取適法
  {
    slug: "subcontract-fair-trade-act-2026",
    userName: "中小製造業",
    userPlan: "COMMENT",
    userCommentCount: 16,
    userTotalLikes: 72,
    stance: "for",
    body: "下請けへの価格転嫁拒否や手形払い規制は現場では待望されていました。施行は遅くなかったと感じます。周知と実効性が伴えば、産業全体の適正化につながるはずです。",
    likeCount: 45,
    helpfulCount: 31,
    createdAt: "2026-06-10T09:00:00Z",
  },
  {
    slug: "subcontract-fair-trade-act-2026",
    userName: "フリーランスデザイナー",
    userPlan: "COMMENT",
    userCommentCount: 33,
    userTotalLikes: 128,
    stance: "for",
    body: "カスハラ防止法と合わせてフリーランス保護が進むのは時代に合っています。適正価格の形成はクリエイター側の生活安定にも直結するので、支持します。",
    likeCount: 52,
    helpfulCount: 38,
    createdAt: "2026-06-12T14:20:00Z",
  },
  {
    slug: "subcontract-fair-trade-act-2026",
    userName: "経理担当",
    userPlan: "FREE",
    userCommentCount: 4,
    userTotalLikes: 0,
    stance: "against",
    body: "書類負担や取引先との関係悪化の声も聞きます。中小企業側のコンプライアンスコスト増は無視できません。周知期間とガイドラインの整備が十分か疑問です。",
    likeCount: 18,
    helpfulCount: 9,
    createdAt: "2026-06-18T11:00:00Z",
  },
  {
    slug: "subcontract-fair-trade-act-2026",
    userName: "労働法勉強中",
    userPlan: "COMMENT",
    userCommentCount: 9,
    userTotalLikes: 22,
    stance: "undecided",
    body: "条文上は手堅いが、実効性は運用と行政の指導力次第です。取引適正化と労働環境整備をセットで見ていきたい。半年経過後のデータが出てから評価を更新したいと思います。",
    likeCount: 12,
    helpfulCount: 7,
    createdAt: "2026-06-22T16:40:00Z",
  },
];
