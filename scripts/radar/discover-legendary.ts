/**
 * 伝説級バズり動画（数百万再生の討論回）をTopicCandidateとして投入するエントリポイント。
 * discover-abema.ts（日次の新着回）と同じGemini動画理解ベースだが、こちらは
 * 各チャンネルの歴代トップ再生動画が対象で、公開時にisStanding=true（常設Debate）が付く。
 * 一度処理した動画はdedupKey（legendary:{videoId}）で永続的にスキップされるため、
 * 毎日実行しても新規のGemini解析は「まだ見ていない上位動画」の分だけで済む。
 *
 * 実行: npx tsx scripts/radar/discover-legendary.ts [--dry-run]
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { fetchLegendaryCandidates } from "./sources/legendary-videos";
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

/** discover-abema.tsと同じ趣旨の固定値（数百万再生のしきい値通過自体が熱量の証拠） */
const LEGENDARY_BUZZ_SCORE = 3;

function cleanTopicTitle(rawTitle: string): string {
  return rawTitle
    .replace(/^【[^】]*】\s*/, "")
    .replace(/\s*[|｜]\s*(アベプラ|ABEMA Prime|ReHacQ|リハック|NewsPicks)\s*$/i, "")
    .trim();
}

async function main() {
  console.log(`🏆 discover-legendary 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);
  const candidates = await fetchLegendaryCandidates();
  console.log(`  しきい値通過 ${candidates.length}件`);

  // 既に処理済み（解析済み・公開済み含む）の動画を除外してからGemini解析枠を消費する。
  // 日次discover（discover-abema.ts、dedupKey="abema:{videoId}"）と伝説級（本ファイル、
  // dedupKey="legendary:{videoId}"）は別のdedupKey空間なので、同じ動画が両方のしきい値を
  // 満たした場合（バズった直後の動画が日次でも伝説級でも通る再生数に達するケース）、
  // チェックしないと同一動画が2本のIssueとして二重公開されてしまう。両方の名前空間で
  // 既存チェックをかけて防ぐ。
  const legendaryKeys = candidates.map((c) => `legendary:${c.videoId}`);
  const abemaKeys = candidates.map((c) => `abema:${c.videoId}`);
  const existing = await prisma.topicCandidate.findMany({
    where: { dedupKey: { in: [...legendaryKeys, ...abemaKeys] } },
    select: { dedupKey: true },
  });
  const seen = new Set(existing.map((e) => e.dedupKey));
  const unprocessed = candidates.filter(
    (c) => !seen.has(`legendary:${c.videoId}`) && !seen.has(`abema:${c.videoId}`),
  );

  // タイトルだけで明らかに個人のライフスタイル・ゴシップ系と分かるものはGemini解析に回さない
  // （2026-07-22実測: しきい値通過分の約2/3がこの種の内容でtrack="exclude"になり、
  // 貴重な解析枠を消費していた。ここで無料の事前フィルタとして弾く）
  const fresh = unprocessed.filter((c) => !isObviousNonDebateVideoTitle(c.title));
  const obviousSkipped = unprocessed.length - fresh.length;
  console.log(
    `  未処理 ${unprocessed.length}件（日次discover等で処理済みのため除外: ${candidates.length - unprocessed.length}件）` +
      `→ 明らかな非討論タイトルを事前除外: ${obviousSkipped}件 → 解析対象 ${fresh.length}件（今回の解析上限 ${RADAR.legendaryPerRun}件）`,
  );

  let created = 0;
  for (const c of fresh.slice(0, RADAR.legendaryPerRun)) {
    const analysis = await analyzeAbemaVideo(c.videoId, c.title, c.channelName);
    const dedupKey = `legendary:${c.videoId}`;
    const videoUrl = `https://www.youtube.com/watch?v=${c.videoId}`;
    const cleanTitle = cleanTopicTitle(c.title);

    if (!analysis) {
      console.log(`  ⚠️ 解析失敗、スキップ（次回再試行）: ${c.title}`);
      continue;
    }

    // 常設Debateは「賛否の対立が今も成立する」ものだけ。news/excludeは記録だけ残して
    // 二度とGemini枠を使わないようにする（REJECTEDでdedupKeyを占有する）
    if (analysis.track !== "debate") {
      console.log(`  ⏭️ ${analysis.track}判定、常設Debate対象外: ${c.title}`);
      if (!DRY_RUN) {
        await prisma.topicCandidate.upsert({
          where: { dedupKey },
          create: {
            dedupKey,
            title: cleanTitle,
            discoverySource: "legendary_video",
            topicTerm: cleanTitle,
            sourceUrls: [
              { title: c.title, url: videoUrl, feed: c.channelName, publishedAt: c.publishedAt },
            ] as unknown as Prisma.InputJsonValue,
            status: "REJECTED",
          },
          update: {},
        });
      }
      continue;
    }

    const base = await researchTopic(cleanTitle, LIMITS, prisma);

    // 動画公開後に関連法令が実際に成立していないか確認する。
    // 「1年前の動画では賛否が割れていたが、その後実際に法制化された」場合、
    // 今も「賛成/反対」を問うと現実と噛み合わない設問になる（既に決着している）。
    // Writer側で「振り返ってどう思うか」に切り替えさせるための一次情報を渡す。
    const videoPublishedAt = new Date(c.publishedAt).getTime();
    const resolvedLaw = base.laws.find((l) => {
      if (l.repealStatus) return false; // 廃止済みは対象外（現行法のみ意味を持つ）
      const promulgated = new Date(l.promulgationDate).getTime();
      return Number.isFinite(promulgated) && promulgated > videoPublishedAt;
    });
    if (resolvedLaw) {
      console.log(
        `  📜 動画公開後に成立を検知: ${resolvedLaw.lawTitle}（${resolvedLaw.promulgationDate}） — 回顧的設問に切り替え`,
      );
    }

    const evidence: SavedEvidence = {
      ...base,
      topic: cleanTitle,
      buzzScore: LEGENDARY_BUZZ_SCORE,
      buzzSources: ["legendary_video"],
      debatable: true,
      youtubeCommentCount: c.commentCount,
      resolvedSinceVideo: resolvedLaw
        ? {
            lawTitle: resolvedLaw.lawTitle,
            promulgationDate: resolvedLaw.promulgationDate,
            videoPublishedAt: c.publishedAt,
          }
        : undefined,
      abemaPrime: {
        videoId: c.videoId,
        videoTitle: c.title,
        videoUrl,
        channel: c.channelName,
        track: "debate",
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

    console.log(`  ✅ [${c.channelName} / ${(c.viewCount / 10_000).toFixed(0)}万再生] ${cleanTitle}`);
    if (DRY_RUN) {
      created++;
      continue;
    }

    await prisma.topicCandidate.upsert({
      where: { dedupKey },
      create: {
        dedupKey,
        title: cleanTitle,
        discoverySource: "legendary_video",
        topicTerm: cleanTitle,
        evidenceJson: evidence as unknown as Prisma.InputJsonValue,
        sourceUrls: sourceUrls as unknown as Prisma.InputJsonValue,
        status: "PENDING",
      },
      update: {},
    });
    created++;
  }

  console.log(`\n🏆 discover-legendary 完了: ${created}件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
