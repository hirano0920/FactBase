import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  commentUpdate: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    comment: {
      findMany: mocks.findMany,
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.commentUpdate,
    },
    issue: { update: mocks.update },
    $transaction: mocks.$transaction,
  },
}));

import { createComment } from "@/lib/comments";

const validBody =
  "消費税の一時的な引き下げについて、財源の内訳が国会で十分に説明されているかを確認したいと考えています。";

const oldAccount = new Date(Date.now() - 48 * 3600_000);
const newAccount = new Date(Date.now() - 1 * 3600_000);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(null);
  mocks.findUnique.mockResolvedValue(null);
  mocks.$transaction.mockResolvedValue([{ id: "new-comment-id" }, {}, {}]);
});

describe("createComment", () => {
  it("正常なコメントを作成できる", async () => {
    const result = await createComment({
      userId: "u1",
      userCreatedAt: oldAccount,
      issueId: "i1",
      stance: "for",
      body: validBody,
    });
    expect(result).toEqual({ ok: true, commentId: "new-comment-id", hidden: false });
    expect(mocks.$transaction).toHaveBeenCalledOnce();
  });

  it("NGワードを含むコメントを422で拒否する", async () => {
    const result = await createComment({
      userId: "u1",
      userCreatedAt: oldAccount,
      issueId: "i1",
      stance: "against",
      body: `${validBody}こんな政治家は死ね。`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("作成24時間以内のアカウントを403で拒否する", async () => {
    const result = await createComment({
      userId: "u1",
      userCreatedAt: newAccount,
      issueId: "i1",
      stance: "for",
      body: validBody,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("同一文面が4件以上あればisHiddenで保存する（shadow hide）", async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: 4 }, () => ({ body: validBody })),
    );
    const result = await createComment({
      userId: "u1",
      userCreatedAt: oldAccount,
      issueId: "i1",
      stance: "for",
      body: validBody,
    });
    expect(result).toEqual({ ok: true, commentId: "new-comment-id", hidden: true });
    // 投稿自体は成功として返す（協調投稿者に検知を悟らせない）
  });

  it("同一文面が3件以下なら通常表示で保存する", async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: 3 }, () => ({ body: validBody })),
    );
    const result = await createComment({
      userId: "u1",
      userCreatedAt: oldAccount,
      issueId: "i1",
      stance: "for",
      body: validBody,
    });
    expect(result).toEqual({ ok: true, commentId: "new-comment-id", hidden: false });
  });

  it("同一スレッドへの連投をクールダウンで拒否する", async () => {
    mocks.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 30_000) });
    const result = await createComment({
      userId: "u1",
      userCreatedAt: oldAccount,
      issueId: "i1",
      stance: "for",
      body: validBody,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.message).toContain("連投");
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});

describe("createComment（返信）", () => {
  it("親コメントのスタンスを引き継いで返信を作成し、親のreplyCountを+1する", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "parent-1",
      issueId: "i1",
      parentId: null,
      stance: "AGAINST",
      isHidden: false,
    });
    const result = await createComment({
      userId: "u2",
      userCreatedAt: oldAccount,
      issueId: "i1",
      stance: "for", // 返信では無視され、親の"AGAINST"が使われるはず
      body: "同意見です",
      parentId: "parent-1",
    });
    expect(result).toEqual({ ok: true, commentId: "new-comment-id", hidden: false });
    const createArg = mocks.create.mock.calls[0][0];
    expect(createArg.data.stance).toBe("AGAINST");
    expect(createArg.data.parentId).toBe("parent-1");
    // issue.update（コメント数）＋comment.update（親のreplyCount）の2回呼ばれる
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.commentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "parent-1" },
        data: { replyCount: { increment: 1 } },
      }),
    );
  });

  it("親コメントが別の争点のものなら422で拒否する", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "parent-1",
      issueId: "other-issue",
      parentId: null,
      stance: "FOR",
      isHidden: false,
    });
    const result = await createComment({
      userId: "u2",
      userCreatedAt: oldAccount,
      issueId: "i1",
      stance: "for",
      body: "同意見です",
      parentId: "parent-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("返信への返信（2階層目）は422で拒否する", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "reply-1",
      issueId: "i1",
      parentId: "parent-1",
      stance: "FOR",
      isHidden: false,
    });
    const result = await createComment({
      userId: "u2",
      userCreatedAt: oldAccount,
      issueId: "i1",
      stance: "for",
      body: "同意見です",
      parentId: "reply-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.message).toContain("返信への返信");
    }
  });

  it("存在しない親コメントIDは422で拒否する", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const result = await createComment({
      userId: "u2",
      userCreatedAt: oldAccount,
      issueId: "i1",
      stance: "for",
      body: "同意見です",
      parentId: "missing",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });
});
