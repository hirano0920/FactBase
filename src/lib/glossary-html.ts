/**
 * articleHtml（dangerouslySetInnerHTMLで描画する生HTML文字列）向けの難語マーク付け。
 * glossary-render.tsx（SummaryCard用・プレーン文字列をReact要素で包む）とは別実装が必要な理由:
 * ここはReactの子要素ではなく文字列のままHTMLとして注入するため、タグの外側（テキストノード相当）
 * だけを対象に置換しないと href やタグ名の中身まで壊してしまう。
 */
import type { GlossaryTerm } from "@/types";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * HTML文字列をタグ部分とテキスト部分に分割し、テキスト部分だけでmatchTextを検索して
 * <span data-glossary-term="...">…</span> で包む。タグ内・既存のglossary-term内は対象にしない。
 */
export function injectGlossarySpans(html: string, glossary: GlossaryTerm[] | null | undefined): string {
  if (!html || !glossary || glossary.length === 0) return html;

  const terms = [...glossary]
    .filter((t) => t.matchText)
    .sort((a, b) => b.matchText.length - a.matchText.length);
  if (terms.length === 0) return html;

  const pattern = new RegExp(`(${terms.map((t) => escapeRegExp(t.matchText)).join("|")})`, "g");
  // 同じ語を本文中で何度もマークすると煩雑になるため、語ごとに最初の1回だけ包む
  const seen = new Set<string>();

  return html
    .split(/(<[^>]*>)/g)
    .map((part) => {
      if (part.startsWith("<")) return part; // タグはそのまま
      return part.replace(pattern, (match) => {
        if (seen.has(match)) return match;
        seen.add(match);
        return `<span class="js-glossary-term" data-glossary-term="${match}">${match}</span>`;
      });
    })
    .join("");
}
