import type { Comment, Issue, RankingItem } from "@/types";

export const MOCK_ISSUES: Issue[] = [
  {
    id: "1",
    slug: "consumption-tax-reduction",
    title: "消費税減税法案について",
    category: "politics",
    status: "active",
    summary: {
      lead:
        "政府・与党が提出した消費税の一時的な引き下げを盛り込んだ法案が国会で審議されています。財源確保と家計支援のバランスが争点です。",
      bullets: [
        "現行10%から5%への一時引き下げが提案されている",
        "財源は予備費と国債発行の組み合わせが示されている",
        "野党は恒久減税と財源の明示を求めている",
      ],
      sources: [
        { label: "e-Gov法令検索", url: "https://elaws.e-gov.go.jp/" },
        { label: "国会会議録", url: "https://kokkai.ndl.go.jp/" },
      ],
    },
    articleHtml: null,
    articleGeneratedAt: null,
    monitoringUntil: "2026-09-01T00:00:00Z",
    voteTally: {
      for: 5230,
      against: 4891,
      undecided: 2104,
      totalVotes: 12225,
      totalVoters: 12225,
      percents: { for: 42.8, against: 40.0, undecided: 17.2 },
    },
    commentCount: 186,
    createdAt: "2026-06-15T00:00:00Z",
    confirmation: null,
    voteLabels: null,
    underReview: false,
  },
  {
    id: "2",
    slug: "defense-budget-increase",
    title: "防衛費増額と財源確保",
    category: "politics",
    status: "trending",
    summary: {
      lead:
        "防衛力強化のための歳出増をどう財源確保するかが国会で議論されています。",
      bullets: [
        "防衛費のGDP比2%超えが議論の前提",
        "増税・国債・歳出削減の組み合わせが焦点",
      ],
      sources: [
        { label: "財務省", url: "https://www.mof.go.jp/" },
        { label: "国会会議録", url: "https://kokkai.ndl.go.jp/" },
      ],
    },
    articleHtml: null,
    articleGeneratedAt: null,
    monitoringUntil: "2026-10-01T00:00:00Z",
    voteTally: {
      for: 3102,
      against: 2844,
      undecided: 1203,
      totalVotes: 7149,
      totalVoters: 7149,
      percents: { for: 43.4, against: 39.8, undecided: 16.8 },
    },
    commentCount: 94,
    createdAt: "2026-06-20T00:00:00Z",
    confirmation: null,
    voteLabels: null,
    underReview: false,
  },
];

export const MOCK_COMMENTS: Comment[] = [
  {
    id: "c1",
    issueId: "1",
    userId: "u1",
    userName: "政策ウォッチャー",
    userBadge: "政治 Contributor",
    stance: "for",
    body:
      "家計への即効性を考えると一時的な減税には意味があると思います。ただし財源の内訳は国会でより明確にされるべきです。財政法上の制約も併せて確認する必要があります。",
    likeCount: 42,
    dislikeCount: 0,
    helpfulCount: 28,
    fcResult: null,
    createdAt: "2026-07-01T14:32",
  },
  {
    id: "c2",
    issueId: "1",
    userId: "u2",
    userName: "経済系大学院生",
    userBadge: null,
    stance: "against",
    body:
      "一時減税は需要喚起効果が限定的という研究もあります。恒久財源なしの減税は将来世代への負担になりうるので、反対の立場です。",
    likeCount: 31,
    dislikeCount: 0,
    helpfulCount: 19,
    fcResult: {
      verdict: "opinion",
      label: "意見・評価",
      reason: "政策効果に関する評価であり、一次情報での真偽判定は困難です。",
      sources: [],
      checkedAt: "2026-07-02T09:00:00Z",
    },
    createdAt: "2026-07-01T16:10",
  },
];

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
        category: issue.category,
        status: issue.status,
      },
      voteTally: issue.voteTally,
      commentCount: issue.commentCount,
      trendScore: issue.voteTally.totalVotes + issue.commentCount * 10,
    }));
}
