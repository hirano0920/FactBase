import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    comment: { findMany: mocks.findMany, create: mocks.create },
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
  mocks.$transaction.mockResolvedValue([{ id: "new-comment-id" }, {}]);
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
});
