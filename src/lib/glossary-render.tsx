import type { ReactNode } from "react";
import { GlossaryTermInline } from "@/components/issue/glossary-term";
import type { GlossaryTerm } from "@/types";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 文中のglossary.matchTextに一致する箇所を<GlossaryTermInline>で包んで返す。
 * 長い語から先に照合する（例:「乖離許容幅」を先に当てないと「幅」だけの短い語に食われる、
 * という将来的な事故を防ぐ）。glossaryが空/未生成なら元の文字列をそのまま返す。
 */
export function renderTextWithGlossary(text: string, glossary: GlossaryTerm[] | null | undefined): ReactNode {
  if (!glossary || glossary.length === 0 || !text) return text;

  const terms = [...glossary]
    .filter((t) => t.matchText)
    .sort((a, b) => b.matchText.length - a.matchText.length);
  if (terms.length === 0) return text;

  const pattern = new RegExp(`(${terms.map((t) => escapeRegExp(t.matchText)).join("|")})`, "g");
  const parts = text.split(pattern);
  if (parts.length === 1) return text;

  const byMatchText = new Map(terms.map((t) => [t.matchText, t]));
  return parts.map((part, i) => {
    const term = byMatchText.get(part);
    if (!term) return part ? <span key={i}>{part}</span> : null;
    return (
      <GlossaryTermInline key={i} data={term}>
        {part}
      </GlossaryTermInline>
    );
  });
}
