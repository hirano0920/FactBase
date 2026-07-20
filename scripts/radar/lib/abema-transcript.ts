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
 * 内容がNetscape cookie形式らしいかを機械的に確認する。
 * base64のコピペ崩れ・二重エンコード等で壊れると、yt-dlpに渡した際に
 * 「invalid length」「does not look like a Netscape format cookies file」という
 * わかりにくいエラーになるため、ここで早期に検知して原因を切り分けやすくする。
 */
function looksLikeNetscapeCookies(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  const dataLines = lines.filter((l) => !l.startsWith("#"));
  if (dataLines.length === 0) return false;
  // Netscape形式は domain\tflag\tpath\tsecure\texpiry\tname\tvalue の7フィールドTSV
  return dataLines.every((l) => l.split("\t").length >= 6);
}

/**
 * Cookie資格情報を一時ファイルに用意する。YTDLP_COOKIES_PATHが直接指定されていればそれを使い、
 * 無ければYTDLP_COOKIES_B64を使う。どちらも無ければnull。
 * YTDLP_COOKIES_B64は、変数名に反して**base64済みか生のNetscape cookieテキストかを自動判定**する
 * （2026-07-19: GitHub Secretsにbase64化せず生テキストをそのまま貼るミスが実際に起きたため、
 * 「base64のつもりが生テキストだった」場合もそのまま使えるようにして事故を吸収する）。
 * 呼び出し側が一時ファイルの削除まで責任を持つ。
 */
export async function prepareCookiesFile(dir: string): Promise<string | null> {
  const directPath = process.env.YTDLP_COOKIES_PATH?.trim();
  if (directPath) return directPath;

  const raw = process.env.YTDLP_COOKIES_B64?.trim();
  if (!raw) return null;

  const content = looksLikeNetscapeCookies(raw) ? raw : Buffer.from(raw, "base64").toString("utf-8");
  if (!looksLikeNetscapeCookies(content)) {
    console.warn(
      `  ⚠️ abema-transcript: YTDLP_COOKIES_B64がNetscape cookie形式に見えません` +
        `（生テキストとしてもbase64デコード後としても不正。デコード後${content.length}バイト、` +
        `先頭: ${JSON.stringify(content.slice(0, 30))}）。Cookie無しで続行します。`,
    );
    return null;
  }
  const cookiesPath = join(dir, "cookies.txt");
  await writeFile(cookiesPath, content, "utf-8");
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
