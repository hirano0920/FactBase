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

export const SITE = {
  name: "FactBase",
  fullName: "FactBase-日本の議論をもっと分かりやすく、クリーンに。",
  tagline: "日本の議論をもっと分かりやすく、クリーンに。",
  description:
    "時事・政治・経済・金融・法律などを一次情報にもとづき、投票と議論ができるプラットフォーム。",
  url: "https://www.factbase.tokyo",
} as const;

// NGワードは別ファイルで管理・定期更新
export const COMMENT_LIMITS = {
  minLength: 50,
  maxLength: 500,
  /** 同一争点での連投クールダウン（秒） */
  sameThreadCooldownSec: 120,
} as const;

/** 未ログインのゲストが閲覧できるコメント数の上限。投票結果は制限なしで見える。 */
export const GUEST_COMMENT_LIMIT = 5;

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
/** ワンタップFCはPro(FACTCHECK/980円)専用。Plus(COMMENT/500円)はコメント投稿のみで対象外。 */
export const FC_DAILY_LIMITS = {
  FREE: 0,
  COMMENT: 0, // Plus・500円: FCなし
  FACTCHECK: 30, // Pro・980円
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
  article: "gpt-5",
  utility: "gpt-5-nano",
  embedding: "text-embedding-3-small",
} as const;
