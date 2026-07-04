import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  issueFindUnique: vi.fn(),
  voteFindUnique: vi.fn(),
  commentFindFirst: vi.fn(),
  reportFindMany: vi.fn(),
  issueUpdate: vi.fn(),
  timelineCreate: vi.fn(),
  transaction: vi.fn(),
  judgeIssueQuality: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    issue: { findUnique: mocks.issueFindUnique, update: mocks.issueUpdate },
    vote: { findUnique: mocks.voteFindUnique },
    comment: { findFirst: mocks.commentFindFirst },
    issueQualityReport: { findMany: mocks.reportFindMany },
    issueTimeline: { create: mocks.timelineCreate },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/ai", () => ({
  judgeIssueQuality: mocks.judgeIssueQuality,
}));

import { canReportQuality, evaluateQualityReports } from "@/lib/issue-quality";

const oldAccount = new Date(Date.now() - 48 * 3600_000);
const newAccount = new Date(Date.now() - 1 * 3600_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockResolvedValue([{}, {}]);
});

describe("canReportQuality（sybil耐性の入口チェック）", () => {
  it("新規24h未満のアカウントは拒否", async () => {
    const result = await canReportQuality("u1", newAccount, "i1");
    expect(result.allowed).toBe(false);
  });

  it("投票もコメントもしていないユーザーは拒否", async () => {
    mocks.voteFindUnique.mockResolvedValue(null);
    mocks.commentFindFirst.mockResolvedValue(null);
    const result = await canReportQuality("u1", oldAccount, "i1");
    expect(result.allowed).toBe(false);
  });

  it("投票済みユーザーは許可", async () => {
    mocks.voteFindUnique.mockResolvedValue({ id: "v1" });
    mocks.commentFindFirst.mockResolvedValue(null);
    const result = await canReportQuality("u1", oldAccount, "i1");
    expect(result.allowed).toBe(true);
  });

  it("コメント済みユーザーは許可", async () => {
    mocks.voteFindUnique.mockResolvedValue(null);
    mocks.commentFindFirst.mockResolvedValue({ id: "c1" });
    const result = await canReportQuality("u1", oldAccount, "i1");
    expect(result.allowed).toBe(true);
  });
});

describe("evaluateQualityReports（閾値スケーリング + AI裏取り）", () => {
  it("既にunderReviewなら何もしない", async () => {
    mocks.issueFindUnique.mockResolvedValue({ id: "i1", underReview: true, summaryJson: {} });
    const result = await evaluateQualityReports("i1");
    expect(result).toBe(true);
    expect(mocks.reportFindMany).not.toHaveBeenCalled();
  });

  it("投票者が少ない争点は最低閾値(5件)未満なら何もしない", async () => {
    mocks.issueFindUnique.mockResolvedValue({
      id: "i1",
      underReview: false,
      summaryJson: { lead: "test" },
      voteForCount: 10,
      voteAgainstCount: 10,
      voteUndecidedCount: 0,
    });
    mocks.reportFindMany.mockResolvedValue(Array(4).fill({ reason: "おかしい" }));
    const result = await evaluateQualityReports("i1");
    expect(result).toBe(false);
    expect(mocks.judgeIssueQuality).not.toHaveBeenCalled();
  });

  it("人気争点（投票者1万人）は最低閾値5件では足りず、比例した数が必要", async () => {
    mocks.issueFindUnique.mockResolvedValue({
      id: "i1",
      underReview: false,
      summaryJson: { lead: "test" },
      voteForCount: 5000,
      voteAgainstCount: 5000,
      voteUndecidedCount: 0,
    });
    // 1万人 × 2% = 200件必要。5件のsybil報告では発火しない
    mocks.reportFindMany.mockResolvedValue(Array(5).fill({ reason: "" }));
    const result = await evaluateQualityReports("i1");
    expect(result).toBe(false);
  });

  it("閾値到達・AIが正当と判定→underReview化", async () => {
    mocks.issueFindUnique.mockResolvedValue({
      id: "i1",
      underReview: false,
      summaryJson: { lead: "test" },
      voteForCount: 10,
      voteAgainstCount: 10,
      voteUndecidedCount: 0,
    });
    mocks.reportFindMany.mockResolvedValue(
      Array(5).fill({ reason: "無関係な2つの事件が混ざっている" }),
    );
    mocks.judgeIssueQuality.mockResolvedValue({
      credible: true,
      confidence: 0.9,
      reason: "内容が矛盾している",
    });
    const result = await evaluateQualityReports("i1");
    expect(result).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("閾値到達・AIが組織的妨害と判定（confidence低い）→隠さない", async () => {
    mocks.issueFindUnique.mockResolvedValue({
      id: "i1",
      underReview: false,
      summaryJson: { lead: "test" },
      voteForCount: 10,
      voteAgainstCount: 10,
      voteUndecidedCount: 0,
    });
    mocks.reportFindMany.mockResolvedValue(Array(5).fill({ reason: "" }));
    mocks.judgeIssueQuality.mockResolvedValue({
      credible: false,
      confidence: 0.85,
      reason: "理由の記入がなく組織的な疑いがある",
    });
    const result = await evaluateQualityReports("i1");
    expect(result).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("ハード上限（閾値の3倍）到達ならAI結果に関わらずunderReview（AI回避策への保険）", async () => {
    mocks.issueFindUnique.mockResolvedValue({
      id: "i1",
      underReview: false,
      summaryJson: { lead: "test" },
      voteForCount: 10,
      voteAgainstCount: 10,
      voteUndecidedCount: 0,
    });
    // 最低閾値5 × 3倍 = 15件でAI判定を経ずに強制発火
    mocks.reportFindMany.mockResolvedValue(Array(15).fill({ reason: "" }));
    const result = await evaluateQualityReports("i1");
    expect(result).toBe(true);
    expect(mocks.judgeIssueQuality).not.toHaveBeenCalled();
  });

  it("AI障害時は隠さない（可用性優先・sybilに悪用されにくい安全側）", async () => {
    mocks.issueFindUnique.mockResolvedValue({
      id: "i1",
      underReview: false,
      summaryJson: { lead: "test" },
      voteForCount: 10,
      voteAgainstCount: 10,
      voteUndecidedCount: 0,
    });
    mocks.reportFindMany.mockResolvedValue(Array(5).fill({ reason: "test" }));
    mocks.judgeIssueQuality.mockRejectedValue(new Error("timeout"));
    const result = await evaluateQualityReports("i1");
    expect(result).toBe(false);
  });
});
