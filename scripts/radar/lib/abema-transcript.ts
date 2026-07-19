/**
 * YouTube動画の字幕（自動生成含む）をテキストとして取得する。
 * ローカル検証(2026-07-19)ではYouTube側のBot対策（データセンターIP拒否/POトークン要求）に
 * より空応答になることを確認済み。GitHub ActionsのIPでは通る可能性があるため、
 * 失敗時は例外を投げずnullを返す設計にしてある（呼び出し側は取れなかった動画をスキップするだけ）。
 * 有料の文字起こしAPIへの切り替えが必要になった場合はこのファイルだけ差し替えればよい。
 */
import { Innertube } from "youtubei.js";

let cachedClient: Innertube | null = null;

async function getClient(): Promise<Innertube> {
  if (!cachedClient) {
    cachedClient = await Innertube.create({ lang: "ja", location: "JP" });
  }
  return cachedClient;
}

export async function fetchYoutubeTranscript(videoId: string): Promise<string | null> {
  try {
    const yt = await getClient();
    const info = await yt.getInfo(videoId);
    const transcriptInfo = await info.getTranscript();
    const segments = transcriptInfo?.transcript?.content?.body?.initial_segments ?? [];
    if (segments.length === 0) return null;
    const text = segments
      .map((s) => s.snippet?.text ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    return text.length > 0 ? text : null;
  } catch (e) {
    console.warn(`  ⚠️ abema-transcript: 取得失敗 videoId=${videoId} (${e})`);
    return null;
  }
}
