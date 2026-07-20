/**
 * ABEMA Prime連携の実地検証用（一時スクリプト）。DB書き込みなし。
 * 目的: ①候補取得・②Gemini動画理解による分類+抽出、の2点が実際に動くか確認する。
 * yt-dlp/Cookie/字幕取得は不要になった（Gemini APIがYouTube URLを直接解析するため）。
 *
 * 実行: npx tsx scripts/radar/_test_abema.ts
 */
import { fetchAbemaPrimeCandidates } from "./sources/abema-prime";
import { analyzeAbemaVideo } from "./lib/abema-gemini";

async function main() {
  console.log("① 候補取得（再生数25,000以上・コメント数200以上）");
  const candidates = await fetchAbemaPrimeCandidates();
  console.log(`  → ${candidates.length}件`);
  for (const c of candidates) {
    console.log(`  - [${c.videoId}] ${c.title}（再生${c.viewCount}・コメント${c.commentCount}）`);
  }
  if (candidates.length === 0) {
    console.log("候補が0件のため②はスキップ");
    return;
  }

  console.log("\n② Gemini動画理解による分類+抽出（先頭2件のみ）");
  for (const c of candidates.slice(0, 2)) {
    const analysis = await analyzeAbemaVideo(c.videoId, c.title);
    if (!analysis) {
      console.log(`  ❌ [${c.videoId}] 解析失敗: ${c.title}`);
      continue;
    }
    console.log(`  ✅ [${analysis.track}] ${c.title}`);
    console.log(`     lead: ${analysis.lead}`);
    if (analysis.track === "debate") {
      console.log(`     axis: ${analysis.axis}`);
      console.log(`     ${analysis.forLabel}: ${analysis.forBullets.length}件`);
      console.log(`     ${analysis.againstLabel}: ${analysis.againstBullets.length}件`);
    } else if (analysis.track === "news") {
      console.log(`     keyPoints: ${analysis.keyPoints.length}件`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
