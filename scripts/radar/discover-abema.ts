/**
 * 討論系チャンネル（ABEMA Prime/ReHacQ/NewsPicks/PIVOT）の日次新着動画をTopicCandidateとして
 * 投入するエントリポイント。discover.tsの通常のバズ収集フローとは別（Gemini動画理解APIで
 * 直接解析するため処理が異なる）。discoverySource="abema_prime"は promote.ts（News20/Debate5の
 * 共通バズパイプライン、discoverySource="buzz"だけを見る）からは独立しており、promote-abema.tsが
 * 別枠・別予算（RADAR.abemaPrimeDailyPublishCap）で拾う。番組側の編集判断＋discover時のしきい値を
 * 信頼し、SNSバズ向けに調整されたキーワード/熱量ランキングは適用しない。
 *
 * ファイル名・discoverySource値は元がABEMA Primeのみだった頃の名残（2026-07-22に
 * ReHacQ/NewsPicks/PIVOTを追加した後もdedupKey/discoverySourceの命名は変えていない。
 * 既存の解析済みレコードとの互換性を優先）。
 *
 * 実行: npx tsx scripts/radar/discover-abema.ts [--dry-run]
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { fetchDailyDebateCandidates } from "./sources/daily-debate-videos";
import { analyzeAbemaVideo } from "./lib/abema-gemini";
import { researchTopic } from "./lib/research";
import { isObviousNonDebateVideoTitle } from "./lib/video-prefilter";
import type { SavedEvidence } from "./lib/promote-logic";
import { RADAR } from "../../src/lib/constants";

const DRY_RUN = process.argv.includes("--dry-run");

const LIMITS = {
  kokkaiRecords: RADAR.kokkaiRecords,
  lawRecords: RADAR.lawRecords,
  newsRecords: RADAR.newsRecords,
  internationalNewsRecords: RADAR.internationalNewsRecords,
};

/**
 * 討論動画は既に再生数/伸び速度のしきい値（dailyDebateMinViews等）で足切り済みなので、
 * 他のbuzzソースと同じ選定ロジック（buzzScore>=minBuzzScoreForPromotion）に乗せるための
 * 固定値を与える。実測のtweetCount等が無いため厳密な熱量比較はできないが、
 * 「discover段階でしきい値を通過した」こと自体が最低限の証拠になる。
 */
const VIDEO_BUZZ_SCORE = 3;

function cleanTopicTitle(rawTitle: string): string {
  return rawTitle
    .replace(/^【[^】]*】\s*/, "")
    .replace(/\s*[|｜]\s*(アベプラ|ABEMA Prime|ReHacQ|リハック|NewsPicks|PIVOT)\s*$/i, "")
    .trim();
}

async function main() {
  console.log(`📺 discover-abema 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);
  const allCandidates = await fetchDailyDebateCandidates();

  // 伝説級パイプライン（discover-legendary.ts、dedupKey="legendary:{videoId}"）が
  // 既に同じ動画を拾っている場合は除外する（同一動画が両パイプラインの閾値を満たし、
  // 別々のIssueとして二重公開されるのを防ぐ）。
  const legendaryKeys = allCandidates.map((c) => `legendary:${c.videoId}`);
  const alreadyLegendary = await prisma.topicCandidate.findMany({
    where: { dedupKey: { in: legendaryKeys } },
    select: { dedupKey: true },
  });
  const legendarySeen = new Set(alreadyLegendary.map((e) => e.dedupKey));
  const notInLegendary = allCandidates.filter((c) => !legendarySeen.has(`legendary:${c.videoId}`));

  // タイトルだけで明らかに個人のライフスタイル・ゴシップ系と分かるものはGemini解析に回さない
  // （discover-legendary.tsと同じプリフィルタ。日次枠でも同種の非討論企画が混じるため）
  const candidates = notInLegendary.filter((c) => !isObviousNonDebateVideoTitle(c.title));
  console.log(
    `  候補 ${candidates.length}件（伝説級パイプラインで処理済みのため除外: ${allCandidates.length - notInLegendary.length}件、` +
      `明らかな非討論タイトルを事前除外: ${notInLegendary.length - candidates.length}件）`,
  );

  let created = 0;
  for (const c of candidates) {
    const analysis = await analyzeAbemaVideo(c.videoId, c.title, c.channelName);
    if (!analysis) {
      console.log(`  ⚠️ 解析失敗、スキップ: ${c.title}`);
      continue;
    }
    if (analysis.track === "exclude") {
      console.log(`  ⏭️ exclude判定、スキップ: ${c.title}`);
      continue;
    }

    const videoUrl = `https://www.youtube.com/watch?v=${c.videoId}`;
    const dedupKey = `abema:${c.videoId}`;
    const cleanTitle = cleanTopicTitle(c.title);

    // 動画は既に賛否・要点を抽出済みだが、Writerの裏取り材料を厚くするため、
    // 同じresearchTopic()で実報道も併せて裏取りしてnews等を埋める。
    const base = await researchTopic(cleanTitle, LIMITS, prisma);

    const evidence: SavedEvidence = {
      ...base,
      topic: cleanTitle,
      buzzScore: VIDEO_BUZZ_SCORE,
      buzzSources: ["abema_prime"],
      debatable: analysis.track === "debate",
      // 実測のYouTubeコメント数（discover段階で既にしきい値フィルタ済み）
      youtubeCommentCount: c.commentCount,
      abemaPrime: {
        videoId: c.videoId,
        videoTitle: c.title,
        videoUrl,
        channel: c.channelName,
        track: analysis.track,
        lead: analysis.lead,
        axis: analysis.axis,
        forLabel: analysis.forLabel,
        forBullets: analysis.forBullets,
        againstLabel: analysis.againstLabel,
        againstBullets: analysis.againstBullets,
        keyPoints: analysis.keyPoints,
      },
    };

    const sourceUrls = [
      { title: c.title, url: videoUrl, feed: c.channelName, publishedAt: c.publishedAt },
    ];

    console.log(
      `  ✅ [${c.channelName}/${analysis.track}/${c.isSettled ? "安定窓" : `${Math.round(c.hoursSincePublish)}h`}/${c.viewsPerHour}回時] ${cleanTitle}`,
    );
    if (DRY_RUN) {
      created++;
      continue;
    }

    const existing = await prisma.topicCandidate.findUnique({
      where: { dedupKey },
      select: { status: true },
    });

    await prisma.topicCandidate.upsert({
      where: { dedupKey },
      create: {
        dedupKey,
        title: cleanTitle,
        discoverySource: "abema_prime",
        topicTerm: cleanTitle,
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        sourceUrls: sourceUrls as unknown as Prisma.InputJsonValue,
        status: "PENDING",
      },
      update: {
        title: cleanTitle,
        discoverySource: "abema_prime",
        topicTerm: cleanTitle,
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        sourceUrls: sourceUrls as unknown as Prisma.InputJsonValue,
        // 既に公開済みなら status を巻き戻さない（discover.tsと同じ方針）
        ...(existing?.status !== "PUBLISHED" ? { status: "PENDING" as const, issueId: null } : {}),
      },
    });
    created++;
  }

  console.log(`\n📺 discover-abema 完了: ${created}件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
