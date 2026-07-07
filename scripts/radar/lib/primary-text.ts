/**
 * OFFICIAL争点の記事品質を上げるための一次資料本文の取得。
 *
 * 見出しだけを入力にする従来設計は誤要約を構造的に防げる反面、
 * 「何が変わるか」「誰に影響するか」という記事の中身が書けない弱点があった。
 * 官公庁・国会・裁判所など一次情報フィード（PRIMARY_SOURCE_FEED）のURLに限って
 * ページ本文の抜粋を取得しGPT-5に渡すことで、公式発表の実際の内容に基づく
 * 具体的な記事を書けるようにする。報道機関のページは対象外
 * （報道内容を事実として書かない原則を維持するため）。
 *
 * 官公庁の一次資料（法律案要綱・白書・統計表・判決文等）はPDFであることが非常に多いため、
 * HTMLだけでなくPDFもunpdf（軽量・依存ゼロ・サーバーレス想定）でテキスト抽出する。
 *
 * 取得したテキストはプロンプトに入るため、AI出力側の防御
 * （sanitizeArticleHtml・banned patternチェック）が引き続き最終ラインになる。
 */
import { extractText } from "unpdf";
import { PRIMARY_SOURCE_FEED } from "../../../src/lib/radar";

export interface PrimaryExcerpt {
  title: string;
  url: string;
  text: string;
}

export const UA = "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)";
const MAX_PAGES = 4;
const MAX_CHARS_PER_PAGE = 6000;

/** 本文と関係ないナビ・フッター・広告等のブロックタグを丸ごと除去（開閉タグの中身ごと） */
const BOILERPLATE_TAGS = ["nav", "header", "footer", "aside", "form"];

/**
 * HTMLから可視テキストだけを抜き出す（依存追加なしの簡易版）。
 * <main>/<article>があればそこだけを対象にし（本文である可能性が高い）、
 * なければページ全体からnav/header/footer/aside/form等のボイラープレートを除去してから使う。
 */
export function stripHtmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const mainMatch = withoutNoise.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  let body = mainMatch ? mainMatch[1] : withoutNoise;

  if (!mainMatch) {
    for (const tag of BOILERPLATE_TAGS) {
      body = body.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
    }
  }

  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** PDFのバイナリからテキストを抽出（法律案要綱・白書・判決文等、官公庁の一次資料に多い形式） */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return text.replace(/\s+/g, " ").trim();
}

export async function fetchPageText(url: string, maxChars = MAX_CHARS_PER_PAGE): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";

    let text: string;
    if (contentType.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
      text = await extractPdfText(await res.arrayBuffer());
    } else if (contentType.includes("html")) {
      text = stripHtmlToText(await res.text());
    } else {
      return null;
    }
    return text.length >= 100 ? text.slice(0, maxChars) : null;
  } catch (e) {
    console.warn(`  ⚠️ primary-text (${url}): 取得失敗 (${e})`);
    return null;
  }
}

/**
 * ソース一覧から一次情報フィード由来のURLを新しい順に最大MAX_PAGES件取得。
 * 取得失敗・本文が短すぎるページはログに残した上でスキップ（記事生成自体は止めない）が、
 * 呼び出し側（summarize.ts/followup.ts）は取得0件を articleHtml 側の注記に反映すること。
 */
export async function fetchPrimaryExcerpts(
  sources: { title: string; url: string; feed: string }[],
): Promise<PrimaryExcerpt[]> {
  const officials = sources.filter((s) => PRIMARY_SOURCE_FEED.test(s.feed)).slice(-MAX_PAGES);
  const excerpts: PrimaryExcerpt[] = [];
  for (const s of officials) {
    const text = await fetchPageText(s.url);
    if (text) excerpts.push({ title: s.title, url: s.url, text });
  }
  if (officials.length > 0 && excerpts.length === 0) {
    console.warn(`  ⚠️ primary-text: 一次情報フィード${officials.length}件すべて本文取得失敗`);
  }
  return excerpts;
}
