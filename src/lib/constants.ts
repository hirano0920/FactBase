export const PLANS = {
  FREE: "free",
  COMMENT: "comment", // 500円
  FACTCHECK: "factcheck", // 980円
} as const;

export type Plan = (typeof PLANS)[keyof typeof PLANS];

export const PLAN_PRICES = {
  [PLANS.COMMENT]: 500,
  [PLANS.FACTCHECK]: 980,
} as const;

export const CATEGORIES = [
  { id: "politics", label: "政治" },
  { id: "law", label: "法律" },
  { id: "economy", label: "経済" },
  { id: "finance", label: "金融" },
  { id: "education", label: "教育" },
  { id: "society", label: "社会" },
  { id: "entertainment", label: "エンタメ" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const ISSUE_STATUSES = [
  { id: "active", label: "審議中" },
  { id: "trending", label: "注目" },
  { id: "passed", label: "成立" },
  { id: "archived", label: "アーカイブ" },
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number]["id"];

export const VOTE_CHOICES = [
  { id: "for", label: "賛成", color: "for" as const },
  { id: "against", label: "反対", color: "against" as const },
  { id: "undecided", label: "わからない", color: "neutral" as const },
] as const;

export type VoteChoiceId = (typeof VOTE_CHOICES)[number]["id"];

/**
 * Radar生成のカスタム投票選択肢（voteLabelsJson）の文字数上限。
 * 3列固定幅ボタンに収める想定。プロンプト側（TOPIC_FILTER_PROMPT/VOTE_QUESTION_PROMPT）にも
 * 同じ上限を明記しているが、AI出力の暴走に備えてUI側・生成コード側の両方で防御的にtruncateする。
 * 旧12字は「法案に賛成」等の抽象テンプレしか収まらず争点固有の名詞が削られがちだったため
 * 16字に拡張（「増税に賛成」等、対象名詞込みでも収まる幅）。
 */
export const VOTE_CHOICE_MAX_CHARS = 16;

export const SITE = {
  name: "TwoSides",
  /** ヘッダーロゴ等の表示名 */
  displayName: "TwoSides",
  fullName: "TwoSides-日本の議論をもっと分かりやすく、クリーンに。",
  tagline: "日本の議論をもっと分かりやすく、クリーンに。",
  description:
    "偏向報道でもSNSのフィルターバブルでもない、第3のメディア。争点整理・投票・スプリット議論ができる中立な討論会場。",
  url: "https://www.twosides.jp",
} as const;

// NGワードは別ファイルで管理・定期更新
export const COMMENT_LIMITS = {
  minLength: 50,
  maxLength: 500,
  /** 同一争点での連投クールダウン（秒） */
  sameThreadCooldownSec: 120,
} as const;

/** 返信（1階層のみ）は会話の続きなので、新規コメントより短く気軽に投稿できるようにする */
export const REPLY_LIMITS = {
  minLength: 2,
  maxLength: 300,
  /** 1コメントあたり最初に表示する返信数（一覧取得時のDB負荷を抑える。全件は「他N件」表示） */
  visibleCount: 5,
} as const;

export const COMMENT_SORTS = [
  { id: "new", label: "新着" },
  { id: "helpful", label: "役に立った順" },
] as const;

export type CommentSortId = (typeof COMMENT_SORTS)[number]["id"];

/** 賛成派・反対派の代表意見（対決表示）を出す最低コメント数。少数のうちは意味が無いため出さない */
export const DEBATE_HIGHLIGHT_MIN_COMMENTS = 10;

/** 越境評価（ブリッジングランキング）: これ未満のhelpfulCountは単純helpful順にフォールバックする */
export const BRIDGING_MIN_SAMPLE = 3;
/** 越境評価: 相手陣営からのhelpfulにかける重み */
export const BRIDGING_CROSS_WEIGHT = 5;
/** 越境評価: 中立（UNDECIDED）からのhelpfulにかける重み（反対派よりさらに高く） */
export const BRIDGING_NEUTRAL_WEIGHT = 4;

/** 未ログインのゲストが閲覧できるコメント数の上限。投票結果は制限なしで見える。 */
export const GUEST_COMMENT_LIMIT = 5;

/** ホームフィード1ページあたりのスレッド数 */
export const HOME_FEED_PAGE_SIZE = 12;

/** 2カラムレイアウト（メイン + サイドバー） */
export const MAIN_SIDEBAR_GRID = "lg:grid-cols-[1fr_300px]" as const;

/**
 * ホーム専用のレイアウト（X方式）。段階的に縮退する:
 * xl+: 左(参加したスレッド) / 中央(フィード) / 右(Hotなスレッド) の3カラム
 * lg〜xl未満: 中央 + 右(Hotなスレッド)の2カラム（左は隠す）
 * lg未満: 1カラム（両方隠してモバイル表示）
 *
 * 中央列は`1fr`ではなく`minmax(0,720px)`で幅を打ち止めにする。`1fr`のまま中身にだけ
 * max-widthを付けると、トラック自体は幅いっぱいに広がるため、中身の右端〜右カラムの間に
 * 使われない帯状の空白ができてしまう（実際に起きたレイアウト崩れ）。
 */
export const HOME_THREE_COL_GRID =
  "lg:grid-cols-[minmax(0,720px)_340px] xl:grid-cols-[300px_minmax(0,720px)_340px]" as const;

export type IssueSortId = "created" | "comments" | "votes";

/** プロフィールの一言自己紹介の最大文字数 */
export const BIO_MAX_LENGTH = 80;
/** 表示名の最大文字数 */
export const DISPLAY_NAME_MAX_LENGTH = 30;

/** 選べる絵文字アバターの一覧（画像アップロード無しで個性を出せるようにする） */
export const AVATAR_EMOJIS = [
  "🔥", "📊", "🗳️", "💬", "🧠", "⚖️",
  "📚", "🌏", "🎯", "✨", "🚀", "🦅",
  "☕", "🌱", "⚡", "🎓",
] as const;

export const MODERATION = {
  newAccountCommentHours: 24,
  reportNanoEnabled: true,
  velocityTriggerPerDay: 100,
  monitoringDays: 60,
  /** この人数の別ユーザーが「不適切」を押すと一時非表示→AI判定 */
  reportAutoHideThreshold: 3,
  /** nano判定の確度がこれ以上なら自動処理、未満は人間キュー行き */
  aiConfidenceThreshold: 0.8,
} as const;

/** ワンタップFCの1日あたり回数制限（プラン別） */
export const FC_DAILY_LIMITS = {
  FREE: 0,
  COMMENT: 5, // Plus・500円
  FACTCHECK: 20, // Pro・980円
} as const;

/** バーストトラフィック時のレート制限・同時実行上限（10万PV級を想定） */
export const BURST = {
  /** 同一IPからのAPI呼び出し上限（/分） */
  apiPerIpPerMin: 300,
  /** 同一IPからのコメント一覧GET上限（/分）。ゲストDDoS対策 */
  commentsGetPerIpPerMin: 60,
  /** SSE接続上限（同一IP・/分）。EventSourceの自動再接続を考慮して緩め */
  ssePerIpPerMin: 60,
  /** SSE poll間隔（ms）。Redis読み取り頻度を抑える */
  ssePollMs: 5_000,
  /** 争点メタのRedisキャッシュTTL（秒）。更新時は invalidate + revalidatePath */
  issueCacheSec: 3600,
  /** コメント一覧のRedisキャッシュTTL（秒） */
  commentsCacheSec: 30,
  /** タイムラインのRedisキャッシュTTL（秒） */
  timelineCacheSec: 60,
  /** クライアントのタイムライン poll 間隔（ms） */
  timelinePollMs: 30_000,
  /** グローバルLIVEタイムラインのRedisキャッシュTTL（秒） */
  globalTimelineCacheSec: 30,
  /** 争点一覧のRedisキャッシュTTL（秒） */
  issuesListCacheSec: 60,
  /** ランキングのRedisキャッシュTTL（秒） */
  rankingCacheSec: 60,
  /** FC embeddingキャッシュTTL（秒）。同一文面の再embeddingを防ぐ */
  fcEmbedCacheSec: 86_400,
  /** 同時FC AI呼び出し上限（Azure/OpenAIのスパイク防止） */
  fcMaxInflight: 40,
} as const;

/** 完成済み争点ページのISR（秒）。更新時は revalidatePath で即時反映 */
export const ISSUE_PAGE_REVALIDATE_SEC = 3600;

export const RADAR = {
  /** 1日の自動公開上限（低品質スレ乱発とAIコスト暴走の防止） */
  autoPublishPerDay: 8,
  /**
   * RSS経路（detect.ts）の🔴LIVE（REPORTED）1日上限。国家的緊急のみが対象。
   * 通常のバズ争点は promote.ts がピーク時間帯に記事付きで公開する。
   */
  liveEmergencyAutoPublishPerDay: 5,
  /** @deprecated 旧名。liveEmergencyAutoPublishPerDay と同義 */
  rssReportedAutoPublishPerDay: 5,
  /**
   * detect.ts が「4ソースで既にバズっている報道錯綜」をREPORTED速報で先取り公開しない。
   * promote.ts 側で能動調査＋記事付き公開させる（品質優先）。
   */
  deferReportedBuzzToPromote: true,
  /** AI記事の1日上限（GPT-5 / OpenAI） */
  articleDailyArticleLimit: 10,
  /** @deprecated 旧名。articleDailyArticleLimit と同義 */
  sonnetDailyArticleLimit: 10,
  /** SourceEventの保持日数。OFFICIAL争点の監視期間(60日)と揃える（監視中の続報イベント消失防止） */
  eventRetentionDays: 60,
  /** 品質報告の最低必要人数（小規模争点の下限） */
  qualityReportThreshold: 5,
  /** 争点の投票者数に対する必要報告割合（人気争点ほど多くの報告が必要＝sybil耐性） */
  qualityReportVoterRatio: 0.02,
  /** この倍率に達したらAI裏取り結果に関わらず強制的にunderReview（AIも欺かれた場合の保険） */
  qualityReportHardMultiplier: 3,
  /** 続報記事再生成の1日上限（初回生成のarticleDailyArticleLimitとは別枠） */
  followUpDailyLimit: 15,
  /** LIVE（REPORTED）争点の続報再生成の最短間隔（分） */
  followUpMinIntervalLiveMin: 30,
  /** 公式（OFFICIAL）争点の続報再生成の最短間隔（分） */
  followUpMinIntervalOfficialMin: 120,
  /** 続報マッチング用にnanoへ渡すアクティブIssueの最大件数（プロンプト肥大化防止） */
  followUpMaxActiveIssuesForMatch: 30,
  /** 候補・争点が保持するソース件数の上限（detect.tsの累積マージ・followup.tsの続報蓄積で共有） */
  sourceCap: 40,
  /**
   * detect.ts（RSS/LIVE経路）の起動時間帯（JST、30分おき）。
   * 本番 cron からは外している（discover→promote のみ）。手動実行時の自己ゲート用。
   */
  detectWindowsJst: Array.from({ length: 48 }, (_, i) => ({
    hour: Math.floor(i / 2),
    minute: (i % 2) * 30,
  })),
  /** detect起動時間帯とみなす許容幅（分） */
  detectWindowToleranceMin: 8,
  /**
   * followup.ts（続報反映）の起動時間帯（JST、1時間おき）。
   * 本番 cron からは外している。手動実行時の自己ゲート用。
   */
  followupWindowsJst: Array.from({ length: 24 }, (_, hour) => ({ hour, minute: 0 })),
  /** followup起動時間帯とみなす許容幅（分） */
  followupWindowToleranceMin: 8,
  // --- 能動調査パイプライン（discover.ts、①②③）---
  /** discover.ts（PENDING作成＋深掘り）の起動時間帯（JST）。1日7回・2.5〜4時間間隔。
   * 各 promote ピーク（6:33/11:03/16:03）の約90分前に加え、昼・夕方・夜間の中間スイープで
   * 1日のバズを取りこぼさない。1時間おきの再実行は意味が薄いため間隔を空ける。
   * 時間外は完全 no-op（nano/API も呼ばない）。 */
  discoverWindowsJst: [
    { hour: 5, minute: 3 }, // → 6:33 ピーク
    { hour: 9, minute: 33 }, // → 11:03 ピーク
    { hour: 12, minute: 33 }, // 昼過ぎスイープ
    { hour: 14, minute: 33 }, // → 16:03 ピーク
    { hour: 18, minute: 3 }, // → 19:33 ピーク
    { hour: 21, minute: 3 }, // → 22:33 ピーク
    { hour: 0, minute: 33 }, // 深夜スイープ（夜バズ → 翌朝 6:33）
  ],
  /**
   * discover起動時間帯とみなす許容幅（分）。
   * GitHub Actions の scheduled cron は「時間指定=ベストエフォート」の仕様上、混雑時に
   * 数十分〜1時間規模で遅れることを前提にする（早く動く分には副作用が無いため、
   * 「早すぎる」は気にしない設計に変更）。
   * .github/workflows/radar.yml の discoverWindowsJst 相当のcron時刻と対で変更すること。
   */
  discoverWindowToleranceMin: 45,
  /**
   * 時間帯許容幅を使い切ってもなお実行できていない場合の最終防衛ライン（時間）。
   * 実測: GitHub Actionsのcronが6回連続で全時間帯を外し、discover/promoteが17時間超
   * 完全停止する事故が発生した。許容幅をいくら広げても原理的に取りこぼしうるため、
   * 「最後の実行からこの時間を超えたら、時間帯に関わらず強制的に走らせる」を保険として持つ。
   */
  discoverOverdueHours: 5,
  /**
   * 1 discover 実行あたり深掘りするバズ争点の上限（buzzScore 降順で選ぶ）。
   * 元8→10。「その日の本命が枠外に落ちる」容量ボトルネックを緩和する狙い（外部API呼び出し増分は許容範囲）。
   */
  researchTopicsPerRun: 10,
  /** 法案トラッキング用の別枠（promote 対象外。buzz 枠を食わない） */
  researchBillTopicsPerRun: 3,
  /**
   * detect.ts（RSS経路）が「報道多数だが一次情報なし／バズ前」で見送った候補を discover が
   * 引き取って能動調査する1実行あたりの上限。バズ争点の枠（researchTopicsPerRun）とは別枠にして、
   * 通常のバズ調査を圧迫せずに「バズる前の重要報道」の取りこぼしだけを救済する。 */
  researchCarryOverPerRun: 3,
  /** 引き取り対象とする detect 候補の鮮度（時間）。これより古い見送り候補は救済しない */
  carryOverLookbackHours: 24,
  /** discover起動時間帯外の能動調査（0=完全スキップ） */
  discoverResearchOutsideWindow: 0,
  /** filterRelevantTopics（discover②）が nano/mini に渡す候補語の上限。元120→150（nano1回呼び出しのプロンプト肥大のみでコスト影響は小さい） */
  topicFilterMaxTerms: 150,
  /** 1トピックあたり取得する国会会議録の発言件数 */
  kokkaiRecords: 5,
  /** 1トピックあたり取得する関連法令の件数 */
  lawRecords: 3,
  /** 1トピックあたり取得する国内メディア関連ニュースの件数 */
  newsRecords: 12,
  /** 1トピックあたり取得する海外/英字メディア関連ニュースの件数 */
  internationalNewsRecords: 8,
  /**
   * Yahoo!記事個別ページのtotalCommentCountが前回調査（12時間再調査ガード内）からこれ以上増えたら
   * 「炎上が加速中」の急増シグナルとみなす。絶対値だけでは「元々コメントが多い定番トピック」と
   * 「今まさに炎上が広がっているトピック」を区別できないため、差分で見る。
   */
  commentCountSurgeThreshold: 300,
  // --- バズ駆動記事の公開（promote.ts、④）---
  /**
   * 1ピーク時間帯あたりの基本公開本数。日次では min/soft/hard と組み合わせて使う。
   * 2026-07-19: 30本/日体制（peakWindowsJst 5枠）に合わせて4→6に引き上げ
   * （5枠 × 6本 = 30本 = dailyPublishHardCapと一致）。
   */
  buzzArticlesPerWindow: 6,
  /**
   * 1日の最低公開本数。Selection V2 では 0（キャッチアップしない）。
   * 互換のため定数は残すが、computePromoteRunBudget は参照しない。
   */
  dailyPublishMinTarget: 0,
  /**
   * 1日の望ましい公開本数の目安（通常ペース）。hardCapより意図的に低くしてあり、
   * 通常日はここまでのペースで残りピーク数に均等按分される。
   * 以前はhardCapと同値(9)で、soft到達判定が実質何もしていなかった
   * （2026-07-16修正: 値を分けて初めてsoft/hardの2段構造が機能する）。
   * 2026-07-19: 30本/日体制（フラッグシップ10+非政治20）に合わせて6→24に引き上げ。
   */
  dailyPublishSoftTarget: 24,
  /**
   * 1日の硬上限。特に強いバズが重なった例外的な日だけ、softを超えてここまでの
   * 上振れを許容する（質を落として埋めるための枠ではない）。
   * 2026-07-19: 9→30に引き上げ（フラッグシップ10本＋非政治20本の30本/日体制）。
   */
  dailyPublishHardCap: 30,
  /**
   * Writerに進める前の本文取得プール倍率（target本数×この値）。
   * 薄い候補を先に落とすため、試行枠より広くネットワーク取得する。
   * 2026-07-19: 実運用ログでは深堀りリサーチまで進んだ候補の実際の失敗率は
   * 約20%程度（15件中2〜3件がHELD/生成失敗）だったため、5倍は過剰だった。
   * 30本/日体制でリサーチ側のnano/mini呼び出し・外部API従量課金が比例して膨らむのを避けるため
   * 2に引き下げる（50%の失敗率まで許容できるバッファ）。歩留まりが悪化したら見直すこと。
   */
  researchPoolMultiplier: 2,
  /**
   * 1ピーク時間帯・1カテゴリからの最大公開数。buzzScore純粋順だと単発のメガバズ争点が
   * 同じピーク枠を独占し、政治・国際・法律等の他カテゴリを機械的に押し出すことがあるため、
   * 政治・経済・国際・戦争・人権等を広く拾うという方針に合わせて偏りを抑える。
   */
  maxSameCategoryPerPromoteWindow: 2,
  /**
   * ピーク時間帯とみなす許容幅（分）。
   * GitHub Actionsのscheduled cronは「ベストエフォート」の仕様上、遅れることはあっても
   * 早く動くことは無い。なら「実際に読まれる時刻の1時間前」をcron時刻にしてしまえば、
   * 多少遅れても実害が無く、早く公開されても問題ない（早いこと自体はデメリットが無い）。
   * peakWindowsJstはこの前提で「読者が見る時刻」ではなく「1時間早めたcron目標時刻」を
   * 入れてあるので、許容幅も「そこから最大+60分の遅れまでは同じピーク扱い」にする。
   * .github/workflows/radar.yml の promote cron時刻と対で変更すること。
   */
  peakWindowToleranceMin: 60,
  /**
   * 許容幅を超えてスキップした場合でも、直近のピーク時刻からこの分数以内なら
   * 「GitHub Actionsの遅延で本来ならピークだったはずの回」とみなしてSlackへ
   * 警告を送る（notifyRadarSkip）。無関係な discover 専用時間帯での毎回通知を
   * 避けつつ、tolerance超過の見逃しを可視化する。
   */
  peakWindowNearMissMin: 120,
  /**
   * discoverOverdueHoursと同じ考え方の最終防衛ライン。ピーク3回（約4.5〜7時間間隔）を
   * 全部逃した場合に備え、最終公開からこの時間を超えたら時間帯外でも強制的に公開する
   * （深夜早朝は除く。promote.ts側でJST時刻ガードと組み合わせて使う）。
   */
  promoteOverdueHours: 6,
  /**
   * 1日の記事化ピーク時間帯（JST）。「読者が見る時刻」の1時間前を狙って設定してある
   * （朝7:30・昼12:00・夕方17:00の通勤・昼休み・夕方の可処分時間の1時間前＝
   * 6:33・11:03・16:03）。cronが多少遅れても実際の読者到達時刻には十分間に合い、
   * 早く公開される分には何の問題も無いという方針（2026-07-14、ユーザーとの合意）。
   * 2026-07-19: 30本/日体制に向けて夕方帰宅後(19:33)・夜間くつろぎ時間(22:33)の
   * 2枠を追加（discoverWindowsJstの18:03/21:03スイープの90分後に合わせてある）。
   */
  peakWindowsJst: [
    { hour: 6, minute: 33 },
    { hour: 11, minute: 3 },
    { hour: 16, minute: 3 },
    { hour: 19, minute: 33 },
    { hour: 22, minute: 33 },
  ],
  /** buzzScore（4ソース + Newsクラスタ）の公開最低ライン。effectiveScore≥2 */
  minBuzzScoreForPromotion: 2,
  /** 同一争点とみなすニュースランキング見出し数（effectiveScore +1） */
  minNewsClusterHeadlines: 3,
  /** YouTube 収集タイトル上限 */
  youtubeTrendingMaxTitles: 80,
  /** News 見出しドリブン YouTube 検索のシード数 */
  youtubeNewsSeedQueries: 8,
  /**
   * ABEMA Prime 公式チャンネルID。旧・単一チャンネル時代の設定（discover-abema.tsの
   * dedupKey生成等、後方互換のため残置）。日次discoverの対象チャンネル自体は
   * dailyDebateChannelsに一本化した。
   */
  abemaPrimeChannelId: "UCB1dgsqLiEp57oDAyNV_vww",
  /** discover 1実行あたりの解析上限（互換のため残置。実際の取得件数はdailyDebatePerChannelPerRunが効く） */
  abemaPrimePerRun: 5,
  /**
   * ABEMA Primeの1日あたりの公開上限。News(20)/Debateの共通バズパイプラインとは
   * 完全に独立した枠（promote-abema.ts）。番組側の編集判断を信頼し、discover段階の
   * しきい値＋Geminiのexclude判定だけをゲートにする。
   */
  abemaPrimeDailyPublishCap: 5,
  /**
   * 日次討論動画discover（scripts/radar/sources/daily-debate-videos.ts）の対象4チャンネル。
   * 2026-07-22、オーナー指示でReHacQ/NewsPicks/PIVOTを追加（旧実装はABEMA Primeのみ）。
   *
   * しきい値設計（2026-07-22、2回改訂）:
   * 1回目の改訂で「全チャンネル一律の中央値」→「投稿したら実際にバズる絶対水準（再生数15万前後）」に
   * 引き上げたが、これはn=50サンプルを**投稿からの経過時間を問わず**集計した分布だった。
   * 実際に「公開18〜96時間（安定窓）の動画がその時点でどこまで伸びているか」を直接検証したところ、
   * ABEMA Prime/ReHacQでこの絶対水準に達する候補が実質0件になる日が多いと判明
   * （動画は公開から数日〜1週間かけて再生数を伸ばすため、72〜96時間時点ではまだ道半ばのことが多い）。
   * 2回目の改訂で、安定窓（18〜96時間）に限定した実測分布（p40〜p50相当）を基準に引き下げた。
   * 「チャンネル優先順位（ABEMA Prime > ReHacQ > NewsPicks > PIVOT）を閾値の厳しさに反映する」
   * という方針は維持しつつ、絶対数では現実的な日次生産量を優先する。
   * 実測（安定窓18〜96時間、n=100サンプル中の該当分、2026-07-22時点）:
   *   ABEMA Prime: n=3  views p50=71,033  / comments p50=490（サンプル薄いため単価は参考値）
   *   ReHacQ:      n=7  views p50=74,008  / comments p50=114
   *   NewsPicks:   n=17 views p50=25,436  / comments p50=17
   *   PIVOT:       n=13 views p50=54,651  / comments p50=105
   */
  dailyDebateChannels: [
    {
      name: "ABEMA Prime",
      channelId: "UCB1dgsqLiEp57oDAyNV_vww",
      minViews: 40_000,
      minComments: 250,
      minViewsPerHour: 2_000,
      minCommentsForVelocity: 50,
    },
    {
      name: "ReHacQ",
      channelId: "UCG_oqDSlIYEspNpd2H4zWhw",
      minViews: 50_000,
      minComments: 80,
      minViewsPerHour: 2_500,
      minCommentsForVelocity: 30,
    },
    {
      name: "NewsPicks",
      channelId: "UCfTnJmRQP79C4y_BMF_XrlA",
      minViews: 20_000,
      minComments: 15,
      minViewsPerHour: 1_000,
      minCommentsForVelocity: 5,
    },
    {
      name: "PIVOT",
      channelId: "UC8yHePe_RgUBE-waRWy6olw",
      minViews: 35_000,
      minComments: 60,
      minViewsPerHour: 1_800,
      minCommentsForVelocity: 20,
    },
  ],
  /** discover 1実行・1チャンネルあたりの取り込み上限 */
  dailyDebatePerChannelPerRun: 5,
  /**
   * 伝説級バズり動画→常設Debate化（discover-legendary.ts / promote-legendary.ts）。
   * 討論系チャンネルの歴代トップ再生動画から「今でも議論が成立する定番争点」を拾い、
   * isStanding=true の常設Debateとして公開する。日次枠(dailyDebateChannels)ともbuzz枠とも独立。
   * チャンネルはchannelId直指定かハンドル（実行時にchannels.list forHandleで解決）のどちらか。
   */
  legendaryChannels: [
    { name: "ABEMA Prime", channelId: "UCB1dgsqLiEp57oDAyNV_vww" },
    { name: "ReHacQ", channelId: "UCG_oqDSlIYEspNpd2H4zWhw" },
    { name: "NewsPicks", channelId: "UCfTnJmRQP79C4y_BMF_XrlA" },
    { name: "PIVOT", channelId: "UC8yHePe_RgUBE-waRWy6olw" },
  ] as { name: string; channelId?: string; handle?: string }[],
  /** 伝説級の再生数しきい値（数百万再生級のみ＝流入が既に証明されている動画だけを常設化） */
  legendaryMinViews: 1_000_000,
  /** 伝説級のコメント数しきい値（議論が実際に起きている証拠） */
  legendaryMinComments: 1_000,
  /** discover 1実行あたりの伝説級動画のGemini解析上限（1本あたり動画1本分の視聴クォータを使うため控えめに） */
  legendaryPerRun: 6,
  /** 伝説級→常設Debateの1日あたり公開上限 */
  legendaryDailyPublishCap: 5,
  /** 政治家プロフィール（Wikipedia写真・経歴・公式サイト要約・国会発言）の再取得間隔 */
  politicianEnrichRefreshDays: 30,
  // --- 記事生成の調査エンリッチ（summarize.ts/followup.ts、detect.ts系にもdiscover.ts相当の調査を後付け）---
  /** この時間内に調査済みならTopicCandidate.evidenceJsonを再利用し、外部APIを叩き直さない */
  enrichRefreshHours: 12,
  /**
   * article-judge（gpt-5-mini、書き手とは別モデル）による品質ゲートの最低点（5点満点）。
   * neutrality/depth/clarity がこれ未満なら公開せずHELD。
   * depth/clarity は「事件内容が後段」「薄い言い換え」を落とすためにゲートに含める。
   */
  judgeQualityGateMinScore: 3,
  /**
   * 両論性だけは一段厳しくする（教科書的な片側埋め・根拠なし一般論を落とす）。
   * bothSidesQuality がこれ未満なら公開せずHELD。
   */
  judgeBothSidesMinScore: 3,
} as const;

/** 称号ランク（役に立った評価の累計数で決まる）。特典はバッジ表示・並び順やや優先のみ。 */
export const BADGE_TIERS = [
  { tier: "pro", min: 100, label: "Pro" },
  { tier: "gold", min: 50, label: "Gold" },
  { tier: "silver", min: 20, label: "Silver" },
  { tier: "bronze", min: 5, label: "Bronze" },
] as const;

export type BadgeTier = (typeof BADGE_TIERS)[number]["tier"];

export const AI_MODELS = {
  /** 争点記事の主筆（フラッグシップ枠）。Azure Foundry のデプロイ名は ARTICLE_MODEL で上書き（GPT-5.6 Luna に換装） */
  article: "gpt-5.6-luna",
  /** 非政治ジャンルの主筆（低コスト枠）。Azure AI Foundryのデプロイ名。DEEPSEEK_MODEL で上書き可 */
  articleEconomy: "DeepSeek-V4-Flash",
  /** FC・claims検証・モデレーション（高頻度・安価な門番） */
  utility: "gpt-5-nano",
  /** discover.ts の争点選別（filterRelevantTopics）。Azure Foundry のデプロイ名は RADAR_TOPIC_FILTER_MODEL で上書き */
  topicFilter: "gpt-5-mini",
  embedding: "text-embedding-3-small",
} as const;
