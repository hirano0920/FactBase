import type { Plan } from "@prisma/client";
import type { CategoryId, IssueStatus, VoteChoiceId } from "@/lib/constants";

export interface IssueSummary {
  lead: string;
  bullets: string[];
  sources: { label: string; url: string }[];
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
  createdAt: string;
  /** 返信の場合は親コメントID。トップレベルコメントはnull */
  parentId: string | null;
  /** 返信総数（repliesが視認上限で切れている場合の実数） */
  replyCount: number;
  /** 1階層のみの返信（トップレベルコメントにのみ含まれる。返信自身のrepliesは常に空） */
  replies: Comment[];
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
  issue: Pick<Issue, "id" | "slug" | "title" | "category" | "status">;
  voteTally: VoteTally;
  commentCount: number;
  trendScore: number;
}
