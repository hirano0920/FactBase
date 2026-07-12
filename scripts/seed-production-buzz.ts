/**
 * 既存争点を全削除し、本番と同じ discover → promote 経路でバズ記事を生成、
 * コメント・投票数を投入する。
 *
 *   npx tsx scripts/seed-production-buzz.ts [--skip-discover] [--count=5]
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type VoteChoice } from "@prisma/client";
import { invalidateOnIssueChanged, invalidateRankingCaches, invalidateIssuesListCache } from "../src/lib/cache-invalidate";
import { kv, voteJsonKey, voteKey } from "../src/lib/redis";
import { prisma } from "../src/lib/prisma";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadLocalEnv() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (existsSync(path)) {
      try {
        process.loadEnvFile(path);
      } catch {
        // ignore
      }
    }
  }
}
loadLocalEnv();

const SKIP_DISCOVER = process.argv.includes("--skip-discover");
const COUNT_ARG = process.argv.find((a) => a.startsWith("--count="));
const TARGET_COUNT = COUNT_ARG
  ? Math.max(1, parseInt(COUNT_ARG.split("=")[1] ?? "", 10) || 5)
  : 5;

const STANCE_MAP = { for: "FOR", against: "AGAINST", undecided: "UNDECIDED" } as const satisfies Record<
  string,
  VoteChoice
>;

const COMMENT_TEMPLATES: { stance: keyof typeof STANCE_MAP; bodies: string[] }[] = [
  {
    stance: "for",
    bodies: [
      "報道と当事者の説明を踏まえると、こちらの立場には一定の根拠があると感じます。ただし未確定部分は慎重に見る必要があります。",
      "一次情報や複数媒体の報道が揃っている点は評価できます。今後の公式説明で見解を更新する余地は残します。",
      "生活への影響が大きい話題なので、感情論ではなく事実関係を整理したうえで判断したいです。現時点では支持側に寄ります。",
    ],
  },
  {
    stance: "against",
    bodies: [
      "報道の切り口や情報源の偏りが気になります。別の説明もあり得るので、現時点では反対側の見方の方が納得できます。",
      "SNSの反応だけで決めつけるのは危険だと思いますが、提示されている根拠だけでは支持側の主張をそのまま受け入れるのは難しいです。",
      "制度や当事者の対応に無理があるように見えます。続報で事実が変わる可能性もあるので、断定は避けつつ反対寄りです。",
    ],
  },
  {
    stance: "undecided",
    bodies: [
      "双方の主張が食い違っており、確定情報がまだ少ないです。もう少し公式の説明や第三者の検証が出てから判断したいです。",
      "話題性は高いですが、自分ごととしてどう向き合うかはまだ整理中です。追加の報道を見てから考えを更新します。",
    ],
  },
];

function runTsx(script: string, args: string[] = []): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npx", ["tsx", script, ...args], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

async function wipeAllIssues() {
  const before = await prisma.issue.count();
  console.log(`\n🗑️  既存争点 ${before} 件を削除…`);

  await prisma.topicCandidate.updateMany({
    where: { status: "PUBLISHED" },
    data: { status: "PENDING", issueId: null, decision: "reset_for_reseed" },
  });

  const deleted = await prisma.issue.deleteMany({});
  console.log(`   ${deleted.count} 件削除`);
}

function randomVoteCounts(): { for: number; against: number; undecided: number } {
  const forCount = 1200 + Math.floor(Math.random() * 1800);
  const againstCount = 900 + Math.floor(Math.random() * 1400);
  const undecidedCount = 400 + Math.floor(Math.random() * 900);
  return { for: forCount, against: againstCount, undecided: undecidedCount };
}

async function seedEngagement(issueId: string, slug: string, index: number) {
  const userIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = `buzz-seed-user-${index}-${i + 1}`;
    userIds.push(id);
    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        name: `読者${String.fromCharCode(65 + i)}`,
        plan: i === 3 ? "COMMENT" : "FREE",
        registrationCountry: "JP",
        registrationIp: "127.0.0.1",
      },
      update: { name: `読者${String.fromCharCode(65 + i)}` },
    });
  }

  const stances: (keyof typeof STANCE_MAP)[] = ["for", "against", "undecided", "for"];
  for (let i = 0; i < 4; i++) {
    const stance = stances[i];
    const templates = COMMENT_TEMPLATES.find((t) => t.stance === stance)?.bodies ?? COMMENT_TEMPLATES[0].bodies;
    const body = templates[i % templates.length];

    await prisma.comment.create({
      data: {
        issueId,
        userId: userIds[i],
        stance: STANCE_MAP[stance],
        body,
        likeCount: 3 + Math.floor(Math.random() * 40),
        helpfulCount: 1 + Math.floor(Math.random() * 15),
        createdAt: new Date(Date.now() - (4 - i) * 3600_000),
      },
    });

    await prisma.vote.upsert({
      where: { userId_issueId: { userId: userIds[i], issueId } },
      create: { userId: userIds[i], issueId, choice: STANCE_MAP[stance] },
      update: { choice: STANCE_MAP[stance] },
    });
  }

  const votes = randomVoteCounts();
  await prisma.issue.update({
    where: { id: issueId },
    data: {
      voteForCount: votes.for,
      voteAgainstCount: votes.against,
      voteUndecidedCount: votes.undecided,
      commentCount: 4,
    },
  });

  try {
    await kv.del(voteKey(issueId));
    await kv.del(voteJsonKey(issueId));
    await Promise.all([
      kv.hincrby(voteKey(issueId), "for", votes.for),
      kv.hincrby(voteKey(issueId), "against", votes.against),
      kv.hincrby(voteKey(issueId), "undecided", votes.undecided),
    ]);
    const total = votes.for + votes.against + votes.undecided;
    const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
    await kv.set(
      voteJsonKey(issueId),
      JSON.stringify({
        ...votes,
        totalVotes: total,
        totalVoters: total,
        percents: { for: pct(votes.for), against: pct(votes.against), undecided: pct(votes.undecided) },
      }),
      { ex: 86_400 },
    );
  } catch {
    // Redis 未設定時は DB カウンタのみ
  }

  await invalidateOnIssueChanged(slug);
  console.log(
    `   💬 ${slug}: コメント4 / 投票 ${votes.for + votes.against + votes.undecided}（賛${votes.for} 反${votes.against} 未定${votes.undecided}）`,
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL が未設定です");
    process.exit(1);
  }

  console.log(`\n🚀 本番パイプラインで ${TARGET_COUNT} 件のバズ記事を生成します`);

  await wipeAllIssues();
  await invalidateIssuesListCache();
  await invalidateRankingCaches();

  if (!SKIP_DISCOVER) {
    console.log("\n📡 discover --force …");
    const discoverCode = await runTsx("scripts/radar/discover.ts", ["--force"]);
    if (discoverCode !== 0) {
      console.error("discover が失敗しました");
      process.exit(discoverCode);
    }
  } else {
    console.log("\n⏭️  discover スキップ（既存 PENDING 候補を使用）");
  }

  let createdCount = await prisma.issue.count({ where: { slug: { startsWith: "radar-" } } });
  let promoteRound = 0;
  while (createdCount < TARGET_COUNT && promoteRound < 4) {
    promoteRound++;
    const need = TARGET_COUNT - createdCount;
    console.log(`\n📰 promote --force --limit=${need} （${promoteRound}回目）…`);
    const promoteCode = await runTsx("scripts/radar/promote.ts", ["--force", `--limit=${need}`]);
    if (promoteCode !== 0) {
      console.error("promote が失敗しました");
      process.exit(promoteCode);
    }
    const nextCount = await prisma.issue.count({ where: { slug: { startsWith: "radar-" } } });
    if (nextCount <= createdCount) {
      console.warn(`\n⚠️  追加公開なし（HELD/重複の可能性）。${createdCount} 件で打ち切り`);
      break;
    }
    createdCount = nextCount;
  }

  const created = await prisma.issue.findMany({
    where: { slug: { startsWith: "radar-" } },
    orderBy: { createdAt: "desc" },
    take: TARGET_COUNT,
    select: {
      id: true,
      slug: true,
      title: true,
      thumbnailUrl: true,
      summaryJson: true,
      commentCount: true,
    },
  });

  if (created.length === 0) {
    console.error("\n❌ 記事が1件も生成されませんでした（HELD / 証拠不足の可能性）");
    process.exit(1);
  }

  console.log(`\n✅ ${created.length} 件生成 — コメント・投票を投入`);
  for (let i = 0; i < created.length; i++) {
    const issue = created[i];
    if (issue.commentCount >= 4) {
      console.log(`\n  /issues/${issue.slug} — エンゲージメント済み、スキップ`);
      continue;
    }
    const summary = issue.summaryJson as { lead?: string };
    const thumb = issue.thumbnailUrl ? "🖼️" : "（サムネなし）";
    console.log(`\n  /issues/${issue.slug}`);
    console.log(`  ${issue.title}`);
    console.log(`  ${thumb} ${summary.lead?.slice(0, 80) ?? ""}…`);
    await seedEngagement(issue.id, issue.slug, i);
  }

  console.log(`\n🎉 完了 — ${created.length} 件`);
  console.log("ホーム: /");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
