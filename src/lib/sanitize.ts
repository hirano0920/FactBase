import sanitizeHtml from "sanitize-html";

/**
 * AI生成記事HTML用サニタイザ（許可リスト方式）。
 * AIの出力を信頼しない: 一次情報テキスト経由のプロンプトインジェクションで
 * script等を混入されてもここで無害化される。
 */
export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "h2",
      "h3",
      "p",
      "ul",
      "ol",
      "li",
      "a",
      "strong",
      "em",
      "blockquote",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
    ],
    allowedAttributes: {
      a: ["href"],
    },
    allowedSchemes: ["https"],
    transformTags: {
      // 外部リンクにはrel付与（tabnabbing防止）
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      }),
    },
  });
}
