/**
 * ABEMA Prime連携の実地検証用（一時スクリプト）。DB書き込みなし。
 * 目的: ①候補取得・②debate/news/exclude分類・③字幕取得(yt-dlp player_client=android)、
 * の3点が実際に動くか確認する。③はCI環境にyt-dlpのインストールが必要
 * （.github/workflows/test-abema.ymlのpip installステップ参照）。
 *
 * 実行: npx tsx scripts/radar/_test_abema.ts
 */
import { fetchAbemaPrimeCandidates } from "./sources/abema-prime";
import { classifyAbemaVideo } from "./lib/abema-classify";
import { fetchYoutubeTranscript } from "./lib/abema-transcript";

async function main() {
  console.log("① 候補取得（再生数25,000以上・コメント数200以上）");
  const candidates = await fetchAbemaPrimeCandidates();
  console.log(`  → ${candidates.length}件`);
  for (const c of candidates) {
    console.log(`  - [${c.videoId}] ${c.title}（再生${c.viewCount}・コメント${c.commentCount}）`);
  }
  if (candidates.length === 0) {
    console.log("候補が0件のため②③はスキップ");
    return;
  }

  console.log("\n② debate/news/exclude 分類");
  for (const c of candidates) {
    const track = await classifyAbemaVideo(c.title, c.description);
    console.log(`  [${track}] ${c.title}`);
  }

  console.log("\n③ 字幕取得（先頭1件のみ）");
  const target = candidates[0];
  const transcript = await fetchYoutubeTranscript(target.videoId);
  if (transcript) {
    console.log(`  ✅ 成功: ${transcript.length}文字`);
    console.log(`  冒頭: ${transcript.slice(0, 200)}`);
  } else {
    console.log("  ❌ 失敗: 字幕を取得できませんでした");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
