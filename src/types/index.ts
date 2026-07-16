import type { Plan } from "@prisma/client";
import type { CategoryId, IssueStatus, VoteChoiceId } from "@/lib/constants";
import type { DebateType } from "@/lib/debate-type";

export interface IssueSummary {
  lead: string;
  bullets: string[];
  sources: { label: string; url: string }[];
  /**
   * 実際に本文を取得して読み比べた媒体の実数。sourcesはリンクプレビュー用に5件へ間引くため、
   * 「何件のソースを横断比較したか」を正しく伝えるには別数値で持つ必要がある。
   * 旧記事はundefined（表示側はsources.lengthにフォールバック）。
   */
  sourceCount?: number;
  /**
   * Yahoo!ニュース「みんなの意見」で一致した設問（あれば）。読者投票の前に
   * 「実際に世の中の意見もこれくらい割れている」という外部実測を見せるための参考情報。
   * 旧記事・未一致はundefined。
   */
  externalPoll?: {
    question: string;
    url: string;
    choices: { choice: string; count: number; percent: number }[];
    divisionScore: number;
  };
}

export interface GlossaryTerm {
  /** 一覧表示・キー用の正式名（例:「オルタナティブ投資」） */
  term: string;
  /** 記事本文中で実際にマッチさせる表記。termと異なることがある（例:「乖離許容幅」） */
  matchText: string;
  /** 吹き出しに出す説明（80字程度） */
  def: string;
  source: "wikipedia" | "ai";
  /** source=wikipediaの時だけ、出典リンク用のページURL */
  wikipediaUrl?: string;
}

export interface VoteTally {
  for: number;
  against: number;
  undecided: number;
  totalVotes: number;
  totalVoters: number;
  percents: { for: number; against: number; undecided: number };
}

export interface Issue {
  id: string;
  slug: string;
  title: string;
  /** X/OG/SEO用の「自分ごとフック」タイトル。titleは中立な投票設問のまま、こちらだけ引きを強める。未設定はnull（titleにフォールバック） */
  shareTitle: string | null;
  category: CategoryId;
  status: IssueStatus;
  summary: IssueSummary;
  articleHtml: string | null;
  articleGeneratedAt: string | null;
  monitoringUntil: string | null;
  voteTally: VoteTally;
  commentCount: number;
  createdAt: string;
  /** Radar由来: "official"=公式確認あり / "reported"=報道ベース・真偽未確認 / null=手動作成 */
  confirmation: "official" | "reported" | null;
  /** 品質報告が閾値に達し人間確認待ちの状態 */
  underReview: boolean;
  /** 投票ボタンのカスタム文言（Radar争点用。nullなら賛成/反対/わからない） */
  voteLabels: VoteLabels | null;
  /** Radar由来の争点タイプ。両側見出しの色分け（極性の有無）に使う。手動作成/未設定はnull */
  debateType: DebateType | null;
  /**
   * カードのサムネイル。出典URLの画像をリンクプレビューとして直接参照するだけ（自前保存・再配布なし）。
   * 未取得/拒否時はnull（呼び出し側は静かにフォールバック表示）
   */
  thumbnailUrl: string | null;
  /** サムネイルの出典（クリックで元記事に飛べるように・出典明記のため） */
  thumbnailSourceUrl: string | null;
  /** カード上の出典表記（媒体名） */
  thumbnailSourceFeed: string | null;
  /** 要点カードの難語ポップオーバー用語集。null/[]=未生成（旧記事） */
  glossary: GlossaryTerm[];
}

export interface Comment {
  id: string;
  issueId: string;
  userId: string;
  userName: string;
  userPlan: Plan;
  userCommentCount: number;
  userTotalLikes: number;
  stance: VoteChoiceId;
  body: string;
  likeCount: number;
  dislikeCount: number;
  helpfulCount: number;
  fcResult: FactCheckResult | null;
  /** Pro限定✅バッジ。fcResult.verdict==="true" && userPlan==="FACTCHECK" の読み取り時点の導出値 */
  verifiedBadge: boolean;
  createdAt: string;
  /** 返信の場合は親コメントID。トップレベルコメントはnull */
  parentId: string | null;
  /** 返信総数（repliesが視認上限で切れている場合の実数） */
  replyCount: number;
  /** 1階層のみの返信（トップレベルコメントにのみ含まれる。返信自身のrepliesは常に空） */
  replies: Comment[];
}

/** スプリットスレッド専用。相手陣営からのhelpful数（越境評価バッジ表示用） */
export interface SplitComment extends Comment {
  crossHelpful: number;
  /** 中立（UNDECIDED）からのhelpful数。中立派を納得させた意見の強さを示す */
  neutralHelpful: number;
  /** trueならAIが記事の材料から生成した論点提示（コールドスタート対策）。DBには保存されない仮想コメント */
  isAiSteelman?: boolean;
}

export type FcVerdictId =
  | "true"
  | "false"
  | "unknown"
  | "opinion"
  | "reported"
  | "disputed";

export interface FcSourceLink {
  label: string;
  url: string;
}

export interface FactCheckResult {
  verdict: FcVerdictId;
  label: string | null;
  reason: string;
  sources: FcSourceLink[];
  checkedAt: string;
}

export interface VoteLabels {
  for: string;
  against: string;
  undecided: string;
}

export interface User {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  plan: Plan;
  planUntil: string | null;
}

export interface UserBadge {
  category: CategoryId;
  tier: "bronze" | "silver" | "gold" | "pro";
  helpfulCount: number;
}

export interface RankingItem {
  rank: number;
  issue: Pick<Issue, "id" | "slug" | "title" | "shareTitle" | "category" | "status">;
  voteTally: VoteTally;
  commentCount: number;
  trendScore: number;
}
