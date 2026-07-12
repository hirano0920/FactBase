import type { Comment, Issue, RankingItem } from "@/types";
import { DEMO_COMMENTS, DEMO_ISSUES } from "@/lib/demo-seed-content";

function buildTally(counts: { for: number; against: number; undecided: number }) {
  const total = counts.for + counts.against + counts.undecided;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  return {
    ...counts,
    totalVotes: total,
    totalVoters: total,
    percents: {
      for: pct(counts.for),
      against: pct(counts.against),
      undecided: pct(counts.undecided),
    },
  };
}

export const MOCK_ISSUES: Issue[] = DEMO_ISSUES.map((def, index) => ({
  id: `demo-${index + 1}`,
  slug: def.slug,
  title: def.title,
  shareTitle: null,
  category: def.category,
  status: def.status,
  summary: def.summary,
  articleHtml: def.articleHtml,
  articleGeneratedAt: def.articleGeneratedAt,
  monitoringUntil: def.monitoringUntil,
  voteTally: buildTally(def.votes),
  commentCount: def.commentCount,
  createdAt: def.createdAt,
  confirmation: def.confirmation,
  voteLabels: null,
  debateType: null,
  underReview: false,
  thumbnailUrl: null,
  thumbnailSourceUrl: null,
  thumbnailSourceFeed: null,
}));

const slugToId = Object.fromEntries(MOCK_ISSUES.map((i) => [i.slug, i.id]));

export const MOCK_COMMENTS: Comment[] = DEMO_COMMENTS.map((def, index) => ({
  id: `demo-c${index + 1}`,
  issueId: slugToId[def.slug] ?? "",
  userId: `demo-u${index + 1}`,
  userName: def.userName,
  userPlan: def.userPlan,
  userCommentCount: def.userCommentCount,
  userTotalLikes: def.userTotalLikes,
  stance: def.stance,
  body: def.body,
  likeCount: def.likeCount,
  dislikeCount: 0,
  helpfulCount: def.helpfulCount,
  fcResult: null,
  verifiedBadge: false,
  createdAt: def.createdAt,
  parentId: null,
  replyCount: 0,
  replies: [],
}));

export function getIssueBySlug(slug: string): Issue | undefined {
  return MOCK_ISSUES.find((i) => i.slug === slug);
}

export function getCommentsByIssueId(issueId: string): Comment[] {
  return MOCK_COMMENTS.filter((c) => c.issueId === issueId);
}

export function getRanking(): RankingItem[] {
  return [...MOCK_ISSUES]
    .sort((a, b) => b.voteTally.totalVotes - a.voteTally.totalVotes)
    .map((issue, index) => ({
      rank: index + 1,
      issue: {
        id: issue.id,
        slug: issue.slug,
        title: issue.title,
        shareTitle: issue.shareTitle,
        category: issue.category,
        status: issue.status,
      },
      voteTally: issue.voteTally,
      commentCount: issue.commentCount,
      trendScore: issue.voteTally.totalVotes + issue.commentCount * 10,
    }));
}
