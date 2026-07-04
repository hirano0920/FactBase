/**
 * Radarが自動公開した争点から国会会議録の検索キーワードを自動導出し、registry.jsonに追記する。
 *
 * 背景: sources/registry.json の kokkai_keywords は人間が手動で追加する前提だったため、
 * Radarが1日8件ペースで自動公開する争点には誰も会議録を紐付けられずファクトチェックの根拠が
 * 空になる問題があった。監視中（monitoringUntil内）の争点は自動的にキーワード化する。
 *
 * 実行: npx tsx scripts/ingest/sync-trending-keywords.ts [--dry-run]
 * 位置づけ: refresh-data.yml で refresh.py の前に実行する（新規キーワードを当週のkokkai取得対象に含める）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REGISTRY_PATH = new URL("../../sources/registry.json", import.meta.url);

interface KokkaiEntry {
  keyword: string;
  category: string[];
  keywords: string[];
  issue_slug: string | null;
  last_fetched: string | null;
  active: boolean;
}

interface Registry {
  laws: unknown[];
  kokkai_keywords: KokkaiEntry[];
  [key: string]: unknown;
}

/** タイトルからキーワード化しやすい語を抽出（記号除去・先頭40字）。過剰に長いと会議録検索がヒットしなくなる */
function toKeyword(title: string, keywords: string[]): string {
  if (keywords.length > 0) return keywords.slice(0, 2).join(" ");
  return title.replace(/[「」『』【】（）()、。？?！!]/g, "").slice(0, 20);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Registry;
  const existingKeywords = new Set(registry.kokkai_keywords.map((k) => k.keyword));
  const existingSlugs = new Set(
    registry.kokkai_keywords.map((k) => k.issue_slug).filter((s): s is string => Boolean(s)),
  );

  const activeIssues = await prisma.issue.findMany({
    where: {
      confirmation: { in: ["OFFICIAL", "REPORTED"] },
      monitoringUntil: { gt: new Date() },
    },
    select: { slug: true, title: true, category: true, keywords: true },
  });

  let added = 0;
  for (const issue of activeIssues) {
    if (existingSlugs.has(issue.slug)) continue;
    const keyword = toKeyword(issue.title, issue.keywords);
    if (!keyword || existingKeywords.has(keyword)) continue;

    registry.kokkai_keywords.push({
      keyword,
      category: [issue.category],
      keywords: issue.keywords.slice(0, 5),
      issue_slug: issue.slug,
      last_fetched: null,
      active: true,
    });
    existingKeywords.add(keyword);
    existingSlugs.add(issue.slug);
    added += 1;
    console.log(`  + 「${keyword}」（${issue.slug}）`);
  }

  if (added === 0) {
    console.log("新規追加なし");
    return;
  }
  console.log(`${added}件のキーワードを追加`);
  if (dryRun) {
    console.log("(--dry-run のためregistry.jsonは書き換えません)");
    return;
  }
  writeFileSync(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  console.log("✅ sources/registry.json を更新しました");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
