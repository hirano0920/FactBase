/** コメント・投票未投入の radar 争点にエンゲージメントを追加 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type VoteChoice } from "@prisma/client";
import { invalidateOnIssueChanged } from "../src/lib/cache-invalidate";
import { kv, voteJsonKey, voteKey } from "../src/lib/redis";
import { prisma } from "../src/lib/prisma";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

const STANCE_MAP = { for: "FOR", against: "AGAINST", undecided: "UNDECIDED" } as const satisfies Record<
  string,
  VoteChoice
>;

const COMMENT_TEMPLATES: { stance: keyof typeof STANCE_MAP; bodies: string[] }[] = [
  {
    stance: "for",
    bodies: [
      "報道と当事者の説明を踏まえると、こちらの立場には一定の根拠があると感じます。",
      "一次情報や複数媒体の報道が揃っている点は評価できます。",
    ],
  },
  {
    stance: "against",
    bodies: [
      "報道の切り口や情報源の偏りが気になります。現時点では反対側の見方の方が納得できます。",
      "提示されている根拠だけでは支持側の主張をそのまま受け入れるのは難しいです。",
    ],
  },
  {
    stance: "undecided",
    bodies: [
      "双方の主張が食い違っており、確定情報がまだ少ないです。",
      "追加の報道を見てから考えを更新します。",
    ],
  },
];

function randomVoteCounts() {
  return {
    for: 1200 + Math.floor(Math.random() * 1800),
    against: 900 + Math.floor(Math.random() * 1400),
    undecided: 400 + Math.floor(Math.random() * 900),
  };
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
  } catch {
    // ignore
  }
  await invalidateOnIssueChanged(slug);
  console.log(`✓ ${slug}: 投票 ${votes.for + votes.against + votes.undecided}`);
}

async function main() {
  const issues = await prisma.issue.findMany({
    where: { slug: { startsWith: "radar-" }, commentCount: { lt: 4 } },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true },
  });
  if (issues.length === 0) {
    console.log("未投入の争点なし");
    return;
  }
  for (let i = 0; i < issues.length; i++) {
    await seedEngagement(issues[i].id, issues[i].slug, i + 2);
  }
}

main().finally(() => prisma.$disconnect());
