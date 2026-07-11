import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  factCheck: vi.fn(),
  retrieveChunks: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({ factCheck: mocks.factCheck }));
vi.mock("@/lib/rag", () => ({ retrieveChunks: mocks.retrieveChunks }));

import { checkDraftFactCheck } from "@/lib/fc-draft";
import { FC_DAILY_LIMITS } from "@/lib/constants";

const chunk = {
  id: "c1",
  sourceName: "消費税法",
  articleRef: "第1条",
  text: "本文",
  sourceUrl: "https://example.com/law",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.retrieveChunks.mockResolvedValue([chunk]);
  mocks.factCheck.mockResolvedValue({
    verdict: "TRUE",
    label: "一次情報で確認",
    reason: "条文と一致",
    sourceIds: ["c1"],
  });
});

describe("checkDraftFactCheck", () => {
  it("FREEプランは403で拒否される（factCheckは呼ばれない）", async () => {
    const result = await checkDraftFactCheck(`u-${crypto.randomUUID()}`, "FREE", "i1", "本文です");
    expect(result).toEqual({
      ok: false,
      status: 403,
      message: "投稿前ファクトチェックはPlus / Proプラン限定の機能です",
      code: "FORBIDDEN",
    });
    expect(mocks.factCheck).not.toHaveBeenCalled();
  });

  it("Plus/Proプランは実行でき、出典付きの判定結果とクォータ残数を返す", async () => {
    const result = await checkDraftFactCheck(`u-${crypto.randomUUID()}`, "COMMENT", "i1", "本文です");
    expect(result).toEqual({
      ok: true,
      verdict: "true",
      label: "一次情報で確認",
      reason: "条文と一致",
      sources: [{ label: "消費税法 第1条", url: "https://example.com/law" }],
      remaining: FC_DAILY_LIMITS.COMMENT - 1,
    });
  });

  it("commentIdを持たないためFcCacheへの保存を一切行わない副作用がない（factCheck/retrieveChunksのみ呼ぶ）", async () => {
    await checkDraftFactCheck(`u-${crypto.randomUUID()}`, "FACTCHECK", "i1", "本文です");
    expect(mocks.retrieveChunks).toHaveBeenCalledWith("i1", "本文です", 3);
    expect(mocks.factCheck).toHaveBeenCalledWith("本文です", [chunk]);
  });

  it("日次クォータを使い切ると429を返す", async () => {
    const userId = `u-quota-${crypto.randomUUID()}`;
    for (let i = 0; i < FC_DAILY_LIMITS.COMMENT; i++) {
      await checkDraftFactCheck(userId, "COMMENT", "i1", "本文です");
    }
    const result = await checkDraftFactCheck(userId, "COMMENT", "i1", "本文です");
    expect(result).toEqual({
      ok: false,
      status: 429,
      message: `本日のファクトチェック回数（${FC_DAILY_LIMITS.COMMENT}回）を使い切りました。明日リセットされます`,
      code: "FC_QUOTA_EXCEEDED",
    });
  });

  it("factCheck失敗時は503 FC_UNAVAILABLEを返す", async () => {
    mocks.factCheck.mockRejectedValueOnce(new Error("AI down"));
    const result = await checkDraftFactCheck(`u-${crypto.randomUUID()}`, "FACTCHECK", "i1", "本文です");
    expect(result).toEqual({
      ok: false,
      status: 503,
      message: "ファクトチェックが混み合っています。しばらく待ってからお試しください",
      code: "FC_UNAVAILABLE",
    });
  });
});
