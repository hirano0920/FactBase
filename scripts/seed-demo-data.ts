/**
 * デモ争点・投票・コメントを Neon に投入する。
 *
 * 使い方:
 *   npm run seed:demo
 *
 * 同じ slug の争点があれば更新し、投票・コメントは作り直します。
 */
import { PrismaClient, type IssueCategory, type IssueStatus, type VoteChoice } from "@prisma/client";
import { invalidateOnIssueChanged } from "../src/lib/cache-invalidate";
import { DEMO_COMMENTS, DEMO_ISSUES } from "../src/lib/demo-seed-content";

const prisma = new PrismaClient();

const CATEGORY_MAP: Record<string, IssueCategory> = {
  politics: "POLITICS",
  law: "LAW",
  economy: "ECONOMY",
  finance: "FINANCE",
  education: "EDUCATION",
};

const STATUS_MAP: Record<string, IssueStatus> = {
  active: "ACTIVE",
  trending: "TRENDING",
  passed: "PASSED",
};

const STANCE_MAP: Record<string, VoteChoice> = {
  for: "FOR",
  against: "AGAINST",
  undecided: "UNDECIDED",
};

async function ensureDemoUsers() {
  const users = DEMO_COMMENTS.map((c, i) => ({
    id: `demo-seed-user-${i + 1}`,
    name: c.userName,
    plan: c.userPlan,
    registrationCountry: "JP",
    registrationIp: "127.0.0.1",
  }));

  for (const user of users) {
    await prisma.user.upsert({
      where: { id: user.id },
      create: user,
      update: { name: user.name, plan: user.plan },
    });
  }

  return users;
}

async function seedIssue(
  def: (typeof DEMO_ISSUES)[number],
  commentUsers: { id: string; name: string | null }[],
) {
  const confirmation =
    def.confirmation === "official"
      ? "OFFICIAL"
      : def.confirmation === "reported"
        ? "REPORTED"
        : "MANUAL";

  const issue = await prisma.issue.upsert({
    where: { slug: def.slug },
    create: {
      slug: def.slug,
      title: def.title,
      category: CATEGORY_MAP[def.category],
      status: STATUS_MAP[def.status],
      confirmation,
      summaryJson: def.summary,
      articleHtml: def.articleHtml,
      articleGeneratedAt: def.articleGeneratedAt ? new Date(def.articleGeneratedAt) : null,
      monitoringUntil: def.monitoringUntil ? new Date(def.monitoringUntil) : null,
      keywords: [],
      voteForCount: def.votes.for,
      voteAgainstCount: def.votes.against,
      voteUndecidedCount: def.votes.undecided,
      commentCount: def.commentCount,
      createdAt: new Date(def.createdAt),
      underReview: false,
    },
    update: {
      title: def.title,
      category: CATEGORY_MAP[def.category],
      status: STATUS_MAP[def.status],
      confirmation,
      summaryJson: def.summary,
      articleHtml: def.articleHtml,
      articleGeneratedAt: def.articleGeneratedAt ? new Date(def.articleGeneratedAt) : null,
      monitoringUntil: def.monitoringUntil ? new Date(def.monitoringUntil) : null,
      voteForCount: def.votes.for,
      voteAgainstCount: def.votes.against,
      voteUndecidedCount: def.votes.undecided,
      commentCount: def.commentCount,
      underReview: false,
    },
  });

  await prisma.vote.deleteMany({ where: { issueId: issue.id } });
  await prisma.comment.deleteMany({ where: { issueId: issue.id } });
  await prisma.issueTimeline.deleteMany({ where: { issueId: issue.id } });

  const issueComments = DEMO_COMMENTS.filter((c) => c.slug === def.slug);
  for (let i = 0; i < issueComments.length; i++) {
    const c = issueComments[i];
    const user = commentUsers.find((u) => u.name === c.userName);
    if (!user) continue;

    await prisma.comment.create({
      data: {
        issueId: issue.id,
        userId: user.id,
        stance: STANCE_MAP[c.stance],
        body: c.body,
        likeCount: c.likeCount,
        helpfulCount: c.helpfulCount,
        createdAt: new Date(c.createdAt),
      },
    });

    await prisma.vote.upsert({
      where: { userId_issueId: { userId: user.id, issueId: issue.id } },
      create: {
        userId: user.id,
        issueId: issue.id,
        choice: STANCE_MAP[c.stance],
      },
      update: { choice: STANCE_MAP[c.stance] },
    });
  }

  // 投票数をコメント投稿者以外のダミーユーザーで埋める（表示用カウンタは issue 側で既に設定済み）
  if (def.timeline?.length) {
    await prisma.issueTimeline.createMany({
      data: def.timeline.map((t) => ({
        issueId: issue.id,
        label: t.label,
        sourceUrl: t.sourceUrl ?? null,
        at: new Date(t.at),
      })),
    });
  }

  return issue.slug;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL が未設定です。.env.local を確認してください。");
    process.exit(1);
  }

  const users = await ensureDemoUsers();
  const slugs: string[] = [];

  for (const def of DEMO_ISSUES) {
    const slug = await seedIssue(def, users);
    slugs.push(slug);
    await invalidateOnIssueChanged(slug);
    console.log(`✓ ${slug}`);
  }

  console.log(`\n${slugs.length} 件のデモ争点を投入しました。`);
  console.log("一覧: /issues");
  console.log("LIVE: /issues/boj-normalization-yen-depreciation");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
