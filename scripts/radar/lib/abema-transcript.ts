/**
 * YouTube動画の字幕（自動生成含む）をテキストとして取得する。
 *
 * 2026-07-19の検証結果:
 *   - 素のHTTPアクセス・youtubei.js（WEB/ANDROID/iOS/WEB_EMBEDDED/MWEBクライアント）・
 *     ブラウザUI直接操作（SeleniumBase UC mode含む）は、ローカル/GitHub Actions/クラウドIP
 *     いずれもYouTube側のBot対策（POトークン要求・IPレピュテーション判定）に阻まれ失敗した。
 *   - yt-dlpの --extractor-args "youtube:player_client=android" は住宅IP（ローカルMac）でのみ成功、
 *     GitHub Actionsの共有ランナーIP（データセンター）では "Sign in to confirm you're not a bot"
 *     で弾かれた。IPレピュテーション由来と判断し、Cookie認証（ログイン済みセッション）に切り替えた。
 *   - Cookie認証は匿名アクセスより信頼度が高く扱われるため、IPが多少疑わしくても通る想定。
 *     必ず専用の捨てアカウントのCookieを使うこと（本アカウントを凍結リスクに晒さないため）。
 *
 * Cookie受け渡し（どちらか一方、両方未設定ならCookie無しで実行=従来通りローカル専用）:
 *   - YTDLP_COOKIES_PATH: cookies.txt（Netscape形式）への直接パス。ローカル検証用。
 *   - YTDLP_COOKIES_B64: 上記ファイルをbase64化した文字列。GitHub Secrets経由のCI用
 *     （このファイル自体は絶対にgit管理しない。.gitignoreで明示的に除外している）。
 *
 * Node.jsからはyt-dlpをサブプロセスとして呼び出す。CI環境にはyt-dlpのインストールが必要
 * （.github/workflows/radar.ymlに`pip install yt-dlp`ステップを追加すること）。
 * 失敗時は例外を投げずnullを返す（呼び出し側は取れなかった動画をスキップするだけでよい）。
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Cookie資格情報を一時ファイルに用意する。YTDLP_COOKIES_PATHが直接指定されていればそれを使い、
 * 無ければYTDLP_COOKIES_B64をデコードして一時ファイルに書き出す。どちらも無ければnull。
 * 呼び出し側が一時ファイルの削除まで責任を持つ。
 */
export async function prepareCookiesFile(dir: string): Promise<string | null> {
  const directPath = process.env.YTDLP_COOKIES_PATH?.trim();
  if (directPath) return directPath;

  const b64 = process.env.YTDLP_COOKIES_B64?.trim();
  if (!b64) return null;
  const cookiesPath = join(dir, "cookies.txt");
  await writeFile(cookiesPath, Buffer.from(b64, "base64").toString("utf-8"), "utf-8");
  return cookiesPath;
}

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
    const cookiesPath = await prepareCookiesFile(dir);
    // androidクライアント偽装はPOトークン回避に有効だが、Cookie（ログイン済みセッション）とは
    // 併用できない（yt-dlpが"Skipping client android since it does not support cookies"で無視する）。
    // Cookieがある場合はクライアント指定を外し、既定のweb系クライアントに任せる
    // （実データで確認済み: Cookie+クライアント指定無しで字幕取得成功）。
    await execFileAsync(
      "yt-dlp",
      [
        "--skip-download",
        "--write-auto-sub",
        "--sub-lang",
        "ja",
        "--sub-format",
        "json3",
        ...(cookiesPath ? ["--cookies", cookiesPath] : ["--extractor-args", "youtube:player_client=android"]),
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
