export interface ArticleSection {
  heading: string | null;
  bodyHtml: string;
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
