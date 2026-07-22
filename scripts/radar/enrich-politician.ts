/**
 * 政治家プロフィールのエンリッチメント。
 * Politicianレコードは元々「争点にタグ付けされた時にname/partyだけでupsertされる」薄いレコードだったが、
 * 政治家ページで「個人プロフ・過去の発言」を出すために、以下を定期的に埋める:
 * - Wikipedia summary（写真・経歴）
 * - 国会会議録検索システムからの直近発言（最大5件）
 *
 * 公式サイト要約は実装したが、Wikipedia外部リンクからの推定は誤検出（後援会サイト・
 * 無関係な同名サイト等）が多く「勝手に他人のサイトを本人の公式サイトとして紹介してしまう」
 * リスクの方が価値を上回ると判断し、2026-07-22にオーナー指示で撤去した。
 *
 * enrichedAtが無い/RADAR.politicianEnrichRefreshDays日以上古いレコードだけを対象にする
 * （enrich.ts/ensureEvidenceと同じ「TTL付きキャッシュ」パターン）。
 * 全件を毎回引き直すとWikipedia/国会会議録APIへの負荷が無駄に大きいため。
 *
 * 実行: npx tsx scripts/radar/enrich-politician.ts [--dry-run] [--limit=20]
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { fetchWikipediaPoliticianProfile } from "./sources/wikipedia";
import { fetchSpeechesBySpeaker } from "./sources/kokkai";
import { RADAR } from "../../src/lib/constants";

const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const RUN_LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 20;

async function main() {
  console.log(`👤 enrich-politician 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);

  const staleCutoff = new Date(Date.now() - RADAR.politicianEnrichRefreshDays * 86400_000);
  const targets = await prisma.politician.findMany({
    where: { OR: [{ enrichedAt: null }, { enrichedAt: { lt: staleCutoff } }] },
    orderBy: { enrichedAt: { sort: "asc", nulls: "first" } },
    take: RUN_LIMIT,
    select: { id: true, name: true, party: true },
  });
  console.log(`  対象 ${targets.length}件（未エンリッチ優先・上限${RUN_LIMIT}件）`);

  let updated = 0;
  for (const p of targets) {
    // 政党そのもののエントリ（party === name）はWikipedia個人プロフィール・国会発言の対象外
    if (p.party === p.name) {
      if (!DRY_RUN) {
        await prisma.politician.update({ where: { id: p.id }, data: { enrichedAt: new Date() } });
      }
      continue;
    }

    const [profile, speeches] = await Promise.all([
      fetchWikipediaPoliticianProfile(p.name),
      fetchSpeechesBySpeaker(p.name, 5),
    ]);

    console.log(
      `  ${profile ? "✅" : "⚠️"} ${p.name}: プロフィール${profile ? "取得" : "無し"}・発言${speeches.length}件`,
    );

    if (DRY_RUN) {
      updated++;
      continue;
    }

    await prisma.politician.update({
      where: { id: p.id },
      data: {
        photoUrl: profile?.thumbnailUrl ?? undefined,
        bioSummary: profile?.extract ?? undefined,
        wikipediaUrl: profile?.url ?? undefined,
        recentStatementsJson:
          speeches.length > 0 ? (speeches as unknown as Prisma.InputJsonValue) : undefined,
        enrichedAt: new Date(),
      },
    });
    updated++;
  }

  console.log(`\n👤 enrich-politician 完了: ${updated}件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
