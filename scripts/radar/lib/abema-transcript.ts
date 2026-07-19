/**
 * YouTube動画の字幕（自動生成含む）をテキストとして取得する。
 *
 * 2026-07-19の検証結果:
 *   - 素のHTTPアクセス・youtubei.js（WEB/ANDROID/iOS/WEB_EMBEDDED/MWEBクライアント）は
 *     ローカル・GitHub Actions両方でYouTube側のBot対策（POトークン要求）に阻まれ失敗した。
 *   - yt-dlpの --extractor-args "youtube:player_client=android" だけは成功した。
 *     動画本体（ストリーミングURL）はPOトークンが要るが、字幕だけは別経路で取得できるらしく、
 *     androidクライアントを騙る場合に限りPOトークン無しで字幕が返ってくる（実データ3件で再現確認済み）。
 * Node.jsからはyt-dlpをサブプロセスとして呼び出す。CI環境にはyt-dlpのインストールが必要
 * （.github/workflows/radar.ymlに`pip install yt-dlp`ステップを追加すること）。
 * 失敗時は例外を投げずnullを返す（呼び出し側は取れなかった動画をスキップするだけでよい）。
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface Json3Segment {
  utf8?: string;
}
interface Json3Event {
  segs?: Json3Segment[];
}
interface Json3Captions {
  events?: Json3Event[];
}

export function json3ToText(data: Json3Captions): string {
  const parts: string[] = [];
  for (const event of data.events ?? []) {
    for (const seg of event.segs ?? []) {
      if (seg.utf8) parts.push(seg.utf8);
    }
  }
  return parts.join("").replace(/\n{2,}/g, "\n").trim();
}

export async function fetchYoutubeTranscript(videoId: string): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "yt-cap-"));
  try {
    const outputTemplate = join(dir, "cap");
    await execFileAsync(
      "yt-dlp",
      [
        "--skip-download",
        "--write-auto-sub",
        "--sub-lang",
        "ja",
        "--sub-format",
        "json3",
        "--extractor-args",
        "youtube:player_client=android",
        "-o",
        outputTemplate,
        `https://youtu.be/${videoId}`,
      ],
      { timeout: 60_000 },
    );
    const raw = await readFile(`${outputTemplate}.ja.json3`, "utf-8");
    const text = json3ToText(JSON.parse(raw) as Json3Captions);
    return text.length > 0 ? text : null;
  } catch (e) {
    console.warn(`  ⚠️ abema-transcript: 取得失敗 videoId=${videoId} (${e})`);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
