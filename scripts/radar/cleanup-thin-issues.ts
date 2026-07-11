/**
 * FactBase Radar — 既存の「薄い争点」を一括アーカイブする一回きりのクリーンアップ。
 *
 * 対象（安全ゲート導入前に自動公開された残骸）:
 *   1. ルーティン官公庁更新（最高裁開廷期日情報・日程表・統計掲載 ping 等 = isRoutineOfficialUpdate）
 *   2. 「準備中/自動生成中」プレースホルダのまま記事が生成されなかった OFFICIAL 争点
 *      （articleHtml が無く、公開から猶予時間を過ぎてもまとめが付いていないもの）
 *
 * 実行:
 *   確認のみ: npx tsx scripts/radar/cleanup-thin-issues.ts
 *   実行:     npx tsx scripts/radar/cleanup-thin-issues.ts --apply
 *
 * status を ARCHIVED にするだけでレコードは残す（監査・復元可能性のため物理削除しない）。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { isRoutineOfficialUpdate, isPendingArticlePlaceholder } from "../../src/lib/radar";

// ローカル実行用: tsx は .env を自動ロードしないため、リポジトリ直下の .env.local / .env を読む
// （CI では GitHub secrets が環境変数で渡るのでこのブロックは no-op）。
function loadLocalEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (existsSync(path)) {
      try {
        process.loadEnvFile(path);
      } catch {
        // Node が古い等で loadEnvFile が無い場合は握りつぶす（環境変数が既にあれば動く）
      }
    }
  }
}
loadLocalEnv();

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
/** プレースホルダのまま放置とみなす猶予（分）。summarize.ts の10分待ちより十分長く取る */
const PLACEHOLDER_GRACE_MIN = 60;

interface SummaryShape {
  lead?: string;
  bullets?: string[];
  sources?: { label?: string; url?: string }[];
}

function feedNamesFromSummary(summary: SummaryShape | null): string[] {
  const labels = summary?.sources?.map((s) => s.label ?? "") ?? [];
  // label は "タイトル（feed）" 形式。末尾の（…）から feed 名を復元する
  return labels
    .map((l) => l.match(/（([^（）]+)）\s*$/)?.[1] ?? "")
    .filter((f) => f.length > 0);
}

async function main() {
  console.log(APPLY ? "🧹 クリーンアップ実行モード（--apply）" : "🔍 確認モード（--apply で実行）");

  const candidates = await prisma.issue.findMany({
    where: { status: { in: ["ACTIVE", "TRENDING"] } },
    select: {
      id: true,
      slug: true,
      title: true,
      confirmation: true,
      articleHtml: true,
      keywords: true,
      summaryJson: true,
      createdAt: true,
    },
  });

  const now = Date.now();
  const toArchive: { id: string; slug: string; title: string; reason: string }[] = [];

  for (const issue of candidates) {
    const summary = (issue.summaryJson as SummaryShape | null) ?? null;
    const feedNames = [...issue.keywords, ...feedNamesFromSummary(summary)];

    // 1. ルーティン官公庁更新
    if (
      isRoutineOfficialUpdate(issue.title, feedNames) ||
      (summary?.sources ?? []).some((s) => isRoutineOfficialUpdate(s.label ?? "", feedNames))
    ) {
      toArchive.push({ id: issue.id, slug: issue.slug, title: issue.title, reason: "routine_official_update" });
      continue;
    }

    // 2. プレースホルダのまま記事が付かなかった OFFICIAL 争点
    const ageMin = (now - issue.createdAt.getTime()) / 60_000;
    const stalePlaceholder =
      !issue.articleHtml &&
      issue.confirmation === "OFFICIAL" &&
      ageMin >= PLACEHOLDER_GRACE_MIN &&
      summary != null &&
      isPendingArticlePlaceholder(summary);
    if (stalePlaceholder) {
      toArchive.push({
        id: issue.id,
        slug: issue.slug,
        title: issue.title,
        reason: "stale_pending_placeholder",
      });
    }
  }

  if (toArchive.length === 0) {
    console.log("対象なし — ACTIVE/TRENDING に薄い争点は見つかりませんでした");
    // どのDBに繋がっているか・なぜ0件かの切り分け用診断
    const total = await prisma.issue.count();
    const byStatus = await prisma.issue.groupBy({ by: ["status"], _count: { _all: true } });
    console.log(`\n[診断] Issue総数: ${total}`);
    for (const s of byStatus) console.log(`  ${s.status}: ${s._count._all}`);
    const kijitsuLike = await prisma.issue.findMany({
      where: { OR: [{ title: { contains: "開廷期日" } }, { title: { contains: "期日情報" } }] },
      select: { slug: true, title: true, status: true, confirmation: true, articleHtml: true },
      take: 10,
    });
    if (kijitsuLike.length > 0) {
      console.log(`\n[診断] 「開廷期日」を含むIssue ${kijitsuLike.length}件（全status）:`);
      for (const i of kijitsuLike) {
        console.log(
          `  ${i.status}/${i.confirmation ?? "-"}/${i.articleHtml ? "記事あり" : "記事なし"} /issues/${i.slug} — ${i.title}`,
        );
      }
    } else {
      console.log("\n[診断] 「開廷期日」を含むIssueはこのDBに存在しません（別DB or キャッシュ表示の可能性）");
    }
    return;
  }

  console.log(`\n対象 ${toArchive.length}件:`);
  for (const t of toArchive) {
    console.log(`  [${t.reason}] /issues/${t.slug} — ${t.title}`);
  }

  if (!APPLY) {
    console.log(`\n${toArchive.length}件をアーカイブ予定。実行するには --apply を付けて再実行してください。`);
    return;
  }

  const ids = toArchive.map((t) => t.id);
  const result = await prisma.issue.updateMany({
    where: { id: { in: ids } },
    data: { status: "ARCHIVED" as Prisma.IssueUpdateManyMutationInput["status"] },
  });
  console.log(`\n✅ ${result.count}件を ARCHIVED にしました`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
