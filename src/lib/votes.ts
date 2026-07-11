import { kv, voteKey, voteJsonKey, voteSeedLockKey } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import type { VoteChoice } from "@prisma/client";
import type { VoteChoiceId } from "@/lib/constants";
import type { VoteTally } from "@/types";

const SEED_LOCK_SEC = 10;
const TALLY_JSON_TTL_SEC = 86_400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistTallyJson(issueId: string, tally: VoteTally): Promise<void> {
  try {
    await kv.set(voteJsonKey(issueId), JSON.stringify(tally), { ex: TALLY_JSON_TTL_SEC });
  } catch {
    // SSEはgetTallyへフォールバック
  }
}

export const choiceToEnum: Record<VoteChoiceId, VoteChoice> = {
  for: "FOR",
  against: "AGAINST",
  undecided: "UNDECIDED",
};

export const enumToChoice: Record<VoteChoice, VoteChoiceId> = {
  FOR: "for",
  AGAINST: "against",
  UNDECIDED: "undecided",
};

function toTally(counts: { for: number; against: number; undecided: number }): VoteTally {
  const total = counts.for + counts.against + counts.undecided;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  return {
    ...counts,
    totalVotes: total,
    totalVoters: total, // 1人1票なので票数=人数
    percents: {
      for: pct(counts.for),
      against: pct(counts.against),
      undecided: pct(counts.undecided),
    },
  };
}

/** KVからtally取得。KVが空(コールドスタート)ならDBから初期化（seedロックでスタンプede防止）。 */
export async function getTally(issueId: string): Promise<VoteTally> {
  const raw = await kv.hgetall(voteKey(issueId));
  if (Object.keys(raw).length > 0) {
    const tally = toTally({
      for: raw.for ?? 0,
      against: raw.against ?? 0,
      undecided: raw.undecided ?? 0,
    });
    await persistTallyJson(issueId, tally);
    return tally;
  }

  return seedTallyFromDb(issueId);
}

/**
 * SSE向け: JSONキャッシュを1 GETで読む。バースト時のRedis/CPU負荷を抑える。
 */
export async function getTallyFast(issueId: string): Promise<VoteTally> {
  try {
    const cached = await kv.get(voteJsonKey(issueId));
    if (cached) return JSON.parse(cached) as VoteTally;
  } catch {
    // fall through
  }
  return getTally(issueId);
}

async function seedTallyFromDb(issueId: string): Promise<VoteTally> {
  const acquired = await kv.setnx(voteSeedLockKey(issueId), "1", { ex: SEED_LOCK_SEC });
  if (!acquired) {
    for (let i = 0; i < 20; i++) {
      await sleep(50);
      const raw = await kv.hgetall(voteKey(issueId));
      if (Object.keys(raw).length > 0) {
        const tally = toTally({
          for: raw.for ?? 0,
          against: raw.against ?? 0,
          undecided: raw.undecided ?? 0,
        });
        await persistTallyJson(issueId, tally);
        return tally;
      }
    }
  }

  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { voteForCount: true, voteAgainstCount: true, voteUndecidedCount: true },
  });
  if (!issue) {
    const empty = toTally({ for: 0, against: 0, undecided: 0 });
    await persistTallyJson(issueId, empty);
    return empty;
  }

  const counts = {
    for: issue.voteForCount,
    against: issue.voteAgainstCount,
    undecided: issue.voteUndecidedCount,
  };
  await Promise.all(
    Object.entries(counts)
      .filter(([, v]) => v > 0)
      .map(([field, v]) => kv.hincrby(voteKey(issueId), field, v)),
  );
  const tally = toTally(counts);
  await persistTallyJson(issueId, tally);
  return tally;
}

/**
 * 投票を記録。既存票があれば選択肢を付け替え（再投票=上書き）。
 * KVを即時更新し、DB(Vote行+非正規化カウンタ)も同期更新。
 */
export async function castVote(
  userId: string,
  issueId: string,
  choice: VoteChoiceId,
): Promise<VoteTally> {
  const newEnum = choiceToEnum[choice];

  const counterField: Record<VoteChoice, "voteForCount" | "voteAgainstCount" | "voteUndecidedCount"> = {
    FOR: "voteForCount",
    AGAINST: "voteAgainstCount",
    UNDECIDED: "voteUndecidedCount",
  };

  // 同時リクエストでのカウンタ二重加算・票水増しを防ぐアトミック設計:
  //   1) INSERT ... ON CONFLICT DO NOTHING（初回投票の同時実行はDBが1件だけ通す）
  //   2) 衝突時は既存行を SELECT FOR UPDATE でロックして選択肢を付け替え
  const existing = await prisma.$transaction(async (tx) => {
    const inserted = await tx.$executeRaw`
      INSERT INTO "Vote" (id, "userId", "issueId", choice, "createdAt")
      VALUES (${`v_${crypto.randomUUID()}`}, ${userId}, ${issueId}, ${newEnum}::"VoteChoice", now())
      ON CONFLICT ("userId", "issueId") DO NOTHING
    `;

    if (inserted === 1) {
      await tx.issue.update({
        where: { id: issueId },
        data: { [counterField[newEnum]]: { increment: 1 } },
      });
      return null; // 新規投票
    }

    // 既存行あり: ロックして直列化（再投票=選択肢の付け替え）
    const locked = await tx.$queryRaw<{ choice: VoteChoice }[]>`
      SELECT choice FROM "Vote"
      WHERE "userId" = ${userId} AND "issueId" = ${issueId}
      FOR UPDATE
    `;
    const prev = locked[0];
    if (!prev || prev.choice === newEnum) return prev ?? null;

    await tx.vote.update({
      where: { userId_issueId: { userId, issueId } },
      data: { choice: newEnum },
    });
    await tx.issue.update({
      where: { id: issueId },
      data: {
        [counterField[newEnum]]: { increment: 1 },
        [counterField[prev.choice]]: { decrement: 1 },
      },
    });
    return prev;
  });

  if (existing && existing.choice === newEnum) {
    return getTally(issueId);
  }

  // 初回投票（existing===null）だけ「読前」スナップショットとしてVoteEventに記録する。
  // 意見変化率（A-3）・沈黙の多数派ヒートマップ（A-4）の母数になる読前値なので、
  // 再投票のたびに上書きしない（@@unique制約により重複INSERTは無害に失敗するだけ）。
  // 分析専用の副作用なので失敗しても投票自体は成立させる。
  if (existing === null) {
    try {
      await prisma.voteEvent.create({
        data: { userId, issueId, phase: "BEFORE_READ", choice: newEnum },
      });
    } catch {
      // 既に存在する場合等は無視（投票フロー自体は成立させる）
    }
  }

  // KVはDBコミット後に更新（KV障害時もDBが正、次のコールドスタートで復元される）
  try {
    await kv.hincrby(voteKey(issueId), choice, 1);
    if (existing) await kv.hincrby(voteKey(issueId), enumToChoice[existing.choice], -1);
  } catch {
    // KV更新失敗は無視（DBが真実のソース）
  }

  const tally = await getTally(issueId);
  await persistTallyJson(issueId, tally);
  return tally;
}

export async function getUserVote(
  userId: string,
  issueId: string,
): Promise<VoteChoiceId | null> {
  const vote = await prisma.vote.findUnique({
    where: { userId_issueId: { userId, issueId } },
    select: { choice: true },
  });
  return vote ? enumToChoice[vote.choice] : null;
}

/** 一覧画面(ランキング等)で「投票済みの争点だけ結果を見せる」ためのバッチ判定 */
export async function getVotedIssueIds(
  userId: string,
  issueIds: string[],
): Promise<string[]> {
  if (issueIds.length === 0) return [];
  const votes = await prisma.vote.findMany({
    where: { userId, issueId: { in: issueIds } },
    select: { issueId: true },
  });
  return votes.map((v) => v.issueId);
}
