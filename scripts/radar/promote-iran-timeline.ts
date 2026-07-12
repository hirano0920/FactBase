/**
 * イラン系 HELD 候補を timeline-first 経路で再 promote する。
 *
 *   npx tsx scripts/radar/promote-iran-timeline.ts
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import type { SavedEvidence } from "./lib/promote-logic";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
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

const IRAN_HINT = /イラン|ホルムズ|中東軍事|対イラン|Hormuz|Iran/i;

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

async function main() {
  const held = await prisma.topicCandidate.findMany({
    where: {
      status: "HELD",
      discoverySource: "buzz",
      OR: [
        { title: { contains: "イラン" } },
        { title: { contains: "ホルムズ" } },
        { title: { contains: "中東" } },
        { topicTerm: { contains: "イラン" } },
        { topicTerm: { contains: "ホルムズ" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  const targets = held.filter((h) => IRAN_HINT.test(`${h.title} ${h.topicTerm ?? ""}`));
  if (targets.length === 0) {
    // PENDING に残っているイラン系も優先できるように evidence だけ補強
    const pending = await prisma.topicCandidate.findMany({
      where: {
        status: "PENDING",
        discoverySource: "buzz",
        OR: [
          { title: { contains: "イラン" } },
          { title: { contains: "ホルムズ" } },
          { title: { contains: "中東" } },
        ],
      },
      take: 5,
    });
    if (pending.length === 0) {
      console.error("イラン系の HELD/PENDING 候補が見つかりません");
      process.exit(1);
    }
    for (const p of pending) {
      const evidence = (p.evidenceJson as SavedEvidence | null) ?? ({} as SavedEvidence);
      const next: SavedEvidence = {
        ...evidence,
        debateType: evidence.debateType ?? "geopolitics",
        sustained: true,
        reignite: true,
        buzzScore: Math.max(evidence.buzzScore ?? 0, 4),
      };
      await prisma.topicCandidate.update({
        where: { id: p.id },
        data: {
          evidenceJson: next as unknown as Prisma.InputJsonValue,
          decision: `${p.decision ?? ""} / timeline_first_retry`,
          updatedAt: new Date(),
        },
      });
      console.log(`  ♻️ PENDING補強: ${p.title}`);
    }
  } else {
    console.log(`イラン系 HELD ${targets.length} 件を PENDING に戻して timeline-first 再試行`);
    for (const h of targets.slice(0, 3)) {
      const evidence = (h.evidenceJson as SavedEvidence | null) ?? ({} as SavedEvidence);
      const next: SavedEvidence = {
        ...evidence,
        debateType: "geopolitics",
        sustained: true,
        reignite: true,
        buzzScore: Math.max(evidence.buzzScore ?? 0, 4),
      };
      await prisma.topicCandidate.update({
        where: { id: h.id },
        data: {
          status: "PENDING",
          issueId: null,
          evidenceJson: next as unknown as Prisma.InputJsonValue,
          decision: `timeline_first_retry:${(h.decision ?? "").slice(0, 120)}`,
          updatedAt: new Date(),
        },
      });
      console.log(`  ↩️ ${h.title}`);
    }
  }

  const code = await runTsx("scripts/radar/promote.ts", ["--force", "--limit=2"]);
  if (code !== 0) process.exit(code);

  const iranIssues = await prisma.issue.findMany({
    where: {
      OR: [
        { title: { contains: "イラン" } },
        { title: { contains: "ホルムズ" } },
        { title: { contains: "中東" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      slug: true,
      title: true,
      thumbnailUrl: true,
      commentCount: true,
      summaryJson: true,
    },
  });

  console.log("\n—— イラン系 Issue ——");
  for (const i of iranIssues) {
    const lead = (i.summaryJson as { lead?: string } | null)?.lead?.slice(0, 80) ?? "";
    console.log(`✅ /issues/${i.slug}`);
    console.log(`   ${i.title}`);
    console.log(`   thumb=${i.thumbnailUrl ? "yes" : "no"} comments=${i.commentCount}`);
    console.log(`   ${lead}…`);
  }

  if (iranIssues.length === 0) {
    console.error("\n❌ イラン記事はまだ公開されていません（再度 HELD の可能性）");
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
