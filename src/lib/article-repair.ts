/**
 * 記事の両側セクションを安価モデル（gpt-5-mini）で局所リライトする。
 * 全文を Grok で再生成するより安く、sides_ungrounded / bothSidesQuality 不足のHELDを減らす。
 */
import { z } from "zod";
import { createOpenAIClient } from "@/lib/openai-client";
import { AI_MODELS } from "@/lib/constants";
import { splitArticleSections } from "@/lib/article-sections";
import { checkSidesGrounding } from "@/lib/article-quality";

const SIDE_REPAIR_SCHEMA = z.object({
  sides: z
    .array(
      z.object({
        heading: z.string(),
        items: z.array(z.string()).min(2).max(4),
      }),
    )
    .min(2)
    .max(2),
});

export interface SideRepairInput {
  issueTitle: string;
  articleHtml: string;
  /** 報道・一次・国会など、両側の根拠になりうる抜粋テキスト */
  sourceHints: string[];
  /** 差し戻し理由（構造チェックやjudge） */
  failureReason?: string | null;
}

function extractSideBlocks(articleHtml: string): { heading: string; bodyHtml: string }[] {
  return splitArticleSections(articleHtml)
    .filter((s) => {
      const h = s.heading ?? "";
      return (
        /が言うこと$/.test(h) ||
        h.includes("側") ||
        h.includes("賛成") ||
        h.includes("反対") ||
        h.includes("擁護") ||
        h.includes("批判") ||
        h.includes("支持") ||
        /強化派|慎重派|推進派|警戒/.test(h)
      );
    })
    .slice(0, 2)
    .map((s) => ({ heading: s.heading ?? "", bodyHtml: s.bodyHtml }));
}

function applySideBlocks(
  articleHtml: string,
  sides: { heading: string; items: string[] }[],
): string {
  let html = articleHtml;
  for (const side of sides) {
    const newUl = `<ul>${side.items.map((it) => `<li>${escapeHtml(it)}</li>`).join("")}</ul>`;
    const re = new RegExp(
      `(<h2>${escapeRegExp(side.heading)}<\\/h2>)([\\s\\S]*?)(?=<h2>|$)`,
      "i",
    );
    if (re.test(html)) {
      html = html.replace(re, `$1${newUl}`);
    }
  }
  return html;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 両側セクションだけを mini で書き直す。失敗時は null（呼び出し側は従来のHELD/再生成へ）。
 * 資料に無い一般論は書かせず、抜粋に根拠が無い側は項目数を減らさせる。
 */
export async function repairSideSectionsWithMini(
  input: SideRepairInput,
): Promise<string | null> {
  const blocks = extractSideBlocks(input.articleHtml);
  if (blocks.length < 2) return null;

  const hints = input.sourceHints
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((h, i) => `【資料${i + 1}】${h.slice(0, 800)}`)
    .join("\n---\n");
  if (!hints) return null;

  const openai = createOpenAIClient({ timeout: 45_000, maxRetries: 1 });
  const res = await openai.chat.completions.create({
    model: AI_MODELS.topicFilter,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `あなたは中立な編集補佐です。記事の「両側の主張」セクションだけを直します。
規則:
- 与えられた資料抜粋に書かれている主張・発言・報道だけを使う。記憶や一般論で埋めない
- 各項目に媒体名・発言者・議員など帰属を付ける（「〜と報じている」「〜議員は〜と指摘」）
- 「国際競争力を損なう」「現行法で十分」「慎重にすべき」等の教科書一般論は禁止
- 両側とも2〜4項目。資料が薄い側は無理に増やさず2項目でよい
- 見出し文言は入力の見出しをそのまま使う
- JSONのみ: {"sides":[{"heading":"...","items":["...","..."]},{"heading":"...","items":["...","..."]}]}`,
      },
      {
        role: "user",
        content: `争点: ${input.issueTitle}
${input.failureReason ? `不合格理由: ${input.failureReason}\n` : ""}
# 現在の両側
${blocks.map((b) => `## ${b.heading}\n${b.bodyHtml}`).join("\n\n")}

# 資料抜粋（これ以外を根拠にしない）
${hints}`,
      },
    ],
  });

  const raw = res.choices[0]?.message?.content ?? "{}";
  let parsed: z.infer<typeof SIDE_REPAIR_SCHEMA>;
  try {
    const json = JSON.parse(raw) as unknown;
    const result = SIDE_REPAIR_SCHEMA.safeParse(json);
    if (!result.success) return null;
    parsed = result.data;
  } catch {
    return null;
  }

  // 見出しがズレても、順序で現在の見出しに合わせる
  const normalized = parsed.sides.map((s, i) => ({
    heading: blocks[i]?.heading || s.heading,
    items: s.items.map((it) => it.trim()).filter(Boolean).slice(0, 4),
  }));
  if (normalized.some((s) => s.items.length < 2)) return null;

  const repaired = applySideBlocks(input.articleHtml, normalized);
  // 修理後も機械チェックに落ちるなら採用しない（悪化防止）
  if (checkSidesGrounding(repaired)) return null;
  return repaired;
}

/** promote/detect の品質ゲート不合格時に一度だけ両側を直して再判定するための材料 */
export function collectSourceHintsForRepair(params: {
  reportExcerpts?: { feed: string; title: string; text: string }[];
  primaryExcerpts?: { title: string; text: string }[];
  internationalReportExcerpts?: { feed: string; title: string; text: string }[];
  dietSpeeches?: { speaker: string; snippet: string; date?: string }[];
  claimDiffBlock?: string;
}): string[] {
  const hints: string[] = [];
  for (const e of params.primaryExcerpts ?? []) {
    hints.push(`${e.title}\n${e.text}`);
  }
  for (const e of params.reportExcerpts ?? []) {
    hints.push(`[${e.feed}] ${e.title}\n${e.text}`);
  }
  for (const e of params.internationalReportExcerpts ?? []) {
    hints.push(`[${e.feed}] ${e.title}\n${e.text}`);
  }
  for (const s of params.dietSpeeches ?? []) {
    hints.push(`${s.date ?? ""} ${s.speaker}: ${s.snippet}`);
  }
  if (params.claimDiffBlock?.trim()) hints.push(params.claimDiffBlock.slice(0, 2000));
  return hints;
}
