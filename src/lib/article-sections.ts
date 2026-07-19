export interface ArticleSection {
  heading: string | null;
  bodyHtml: string;
}

/** 記事冒頭の要約セクション見出し（lead の代わりに UI で使う） */
export const OPENING_SECTION_HEADINGS = new Set([
  "いま何が論点か",
  "いま分かっていること",
]);

export function isOpeningSectionHeading(heading: string | null | undefined): boolean {
  return heading != null && OPENING_SECTION_HEADINGS.has(heading);
}

/**
 * Writerや局所修正（claim削除・両側mini修理）が生成したHTMLの<ul>/<li>の対応崩れを直す。
 * 対応する開始タグの無い閉じタグは孤児として削除する（例:「</li></li>」の二重閉じ）。
 * ネストしたリストは扱わない想定なので、タグ種別ごとの単純なスタックで十分。
 */
export function sanitizeListMarkup(html: string): string {
  const stack: string[] = [];
  return html.replace(/<(\/?)(ul|ol|li)(\s[^>]*)?>/gi, (match, closingSlash: string, tagRaw: string) => {
    const tag = tagRaw.toLowerCase();
    if (!closingSlash) {
      stack.push(tag);
      return match;
    }
    const idx = stack.lastIndexOf(tag);
    if (idx === -1) return ""; // 対応する開始タグが無い孤児の閉じタグは削除
    stack.splice(idx, 1);
    return match;
  });
}

/** HTML断片をプレーンテキストに（要約表示用） */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * articleHtml の冒頭セクションを要約テキストとして返す。
 * 短い lead よりこちらを優先し、記事ページでの二重表示を防ぐ。
 */
export function extractOpeningSummary(
  articleHtml: string | null | undefined,
  fallbackLead: string,
): string {
  if (!articleHtml) return fallbackLead;
  const opening = splitArticleSections(articleHtml).find((s) =>
    isOpeningSectionHeading(s.heading),
  );
  if (!opening) return fallbackLead;
  const text = htmlToPlainText(opening.bodyHtml);
  return text || fallbackLead;
}

/**
 * サニタイズ済みarticleHtmlをh2見出し単位で分割する。
 * 記事全体を1本の文章として流すのではなく、論点ごとにカード分けして表示するため。
 */
export function splitArticleSections(html: string): ArticleSection[] {
  const parts = html.split(/(<h2>[\s\S]*?<\/h2>)/g);
  const sections: ArticleSection[] = [];
  let current: ArticleSection = { heading: null, bodyHtml: "" };

  for (const part of parts) {
    const headingMatch = part.match(/^<h2>([\s\S]*?)<\/h2>$/);
    if (headingMatch) {
      if (current.heading !== null || current.bodyHtml.trim() !== "") sections.push(current);
      current = { heading: headingMatch[1].replace(/<[^>]+>/g, ""), bodyHtml: "" };
    } else {
      current.bodyHtml += part;
    }
  }
  if (current.heading !== null || current.bodyHtml.trim() !== "") sections.push(current);

  return sections;
}

/**
 * セクション本文（<ul><li>...</li></ul>形式）から各<li>のプレーンテキストを抽出する。
 * 「論点」セクションの箇条書きをコメント欄への引用リンクにするために使う。
 */
export function extractListItems(bodyHtml: string): string[] {
  const items: string[] = [];
  const re = /<li>([\s\S]*?)<\/li>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyHtml)) !== null) {
    const text = m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) items.push(text);
  }
  return items;
}

/** 「M月D日:」「YYYY年M月D日:」「今年7月:」などを日付と本文に分離（タイムラインUI用） */
export function parseTimelineItem(raw: string): { date: string | null; body: string } {
  const item = raw.trim();
  const dateMatch = item.match(
    /^((?:今年|昨年|本年|\d{4}年)?\d{1,2}月(?:\d{1,2}日)?)[:\s：]+([\s\S]+)$/,
  );
  if (dateMatch) {
    return { date: dateMatch[1], body: dateMatch[2].trim() };
  }
  return { date: null, body: item };
}
