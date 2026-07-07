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
      { label: "🔴 速報スレ公開（報道ベース）", at: "2026-07-01T06:00:00Z" },
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
    articleHtml: `<h2>何が起きたか</h2>
<ul>
<li>2026年7月4日、アメリカ合衆国は独立宣言から250年を迎えた。</li>
<li>セミクインセンテニアル（半千年記念）として全国的な記念行事が実施された。</li>
<li>同時期は11月中間選挙に向けた政党間の攻防が本格化する時期でもある。</li>
</ul>
<h2>なぜ今注目されるか</h2>
<ul>
<li>同盟国・貿易相手国としての米国の政治安定性は、日本の外交・安全保障に直結する。</li>
<li>記念年の国内政治は、対外政策の継続性や変更のシグナルとして読まれることがある。</li>
</ul>
<h2>賛成側の論点</h2>
<ul>
<li>250年という節目は民主制度の歴史を振り返る好機であり、同盟関係の再確認にもなる。</li>
<li>日米協調の枠組みは地域安定に不可欠という見方がある。</li>
</ul>
<h2>慎重・懸念の論点</h2>
<ul>
<li>国内政治の分極化が外交・貿易政策の不確実性を高めるリスクがある。</li>
<li>記念イベントの象徴性だけでなく、政策の中身を見る必要があるという指摘がある。</li>
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
    articleHtml: `<h2>イベント概要</h2>
<ul>
<li>2026年2月: ミラノ・コルティナ冬季オリンピック</li>
<li>2026年6〜7月: FIFAワールドカップ（史上最多48チーム参加）</li>
<li>いずれも開催日程・形式が確定し、関連投資・マーケティングが本格化している。</li>
</ul>
<h2>経済波及の論点</h2>
<ul>
<li>観光・宿泊・交通需要の一時的な押し上げ</li>
<li>スポンサー契約、放送権、関連グッズ市場の拡大</li>
<li>日本企業の海外スポンサー投資・ブランディング機会</li>
</ul>
<h2>賛成側の論点</h2>
<ul>
<li>グローバルな注目イベントは関連産業全体に需要を生む。</li>
<li>48チーム制はアジア枠拡大など日本代表の露出機会増にもつながる。</li>
</ul>
<h2>慎重・懸念の論点</h2>
<ul>
<li>イベント後の需要急減（オイロットシス）やインフラ維持コストの議論がある。</li>
<li>効果を一律に肯定せず、イベントごとに評価すべきという見方もある。</li>
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
    articleHtml: `<h2>取適法の主な変更点</h2>
<ul>
<li>価格交渉の拒否や一方的な条件決定の規制強化</li>
<li>手形払いの原則禁止など、中小・小規模事業者保護の拡充</li>
<li>2026年1月施行 — 旧下請法からの大幅アップデート</li>
</ul>
<h2>労働環境とのセット</h2>
<ul>
<li>カスハラ防止法（改正労働施策総合推進法）の施行も2026年に確定</li>
<li>フリーランスや個人事業主を含む働き方全体の保護が進む</li>
</ul>
<h2>賛成側の論点</h2>
<ul>
<li>長年の下請け構造の是正と適正価格の形成に不可欠という見方</li>
<li>中小企業の経営安定と産業全体の競争力向上につながる</li>
</ul>
<h2>慎重・懸念の論点</h2>
<ul>
<li>現場の書類負担や取引関係への影響が懸念される声もある</li>
<li>実効性は運用・周知・行政指導の力度次第という指摘がある</li>
</ul>`,
    articleGeneratedAt: "2026-06-15T10:00:00Z",
    votes: { for: 2456, against: 812, undecided: 534 },
    commentCount: 4,
    createdAt: "2026-06-01T00:00:00Z",
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
