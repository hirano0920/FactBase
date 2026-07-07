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
import { PrismaClient, type Prisma } from "@prisma/client";
import { isRoutineOfficialUpdate, isPendingArticlePlaceholder } from "../../src/lib/radar";

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
    console.log("対象なし — 薄い争点は見つかりませんでした");
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
