/**
 * 要点カードの難語ポップオーバー用語集。
 * ①LLMで「読者が引っかかりそうな難語」を最大5個抽出＋簡潔なフォールバック説明を書かせる
 * ②各語をWikipedia日本語版で検索し、要約が取れればそちらを優先して使う（出典を明示できるため）
 * ③取れなければ①のAI説明をそのまま使う
 * 生成失敗時は空配列を返す（記事公開は止めない。voteQuestion等と同じfail-open方針）。
 */
import { z } from "zod";
import { createOpenAIClient } from "@/lib/openai-client";
import { AI_MODELS, SITE } from "@/lib/constants";
import type { GlossaryTerm } from "@/types";

const GLOSSARY_PROMPT = `あなたは${SITE.name}の編集デスクです。記事の要点（lead・bullets）を読み、
政治・経済に詳しくない一般読者が引っかかりそうな難語・専門用語・聞き慣れない制度名を
最大5個選び、簡潔な説明を書きます。

# 選ぶ基準（厳しめに。1つも無ければ空配列でよい）
- 対象にする: 制度・組織の略称や専門名（GPIF、乖離許容幅、為替介入）、聞いたことのない海外の
  地名・行政区分（広西チワン族自治区、〇〇州）、業界特有の指標・手続き名
- 対象にしない: 小学生でも知っている一般名詞（ダム、貯水池、堤防、洪水、地震、台風、川、山、
  毒ヘビ、道路、病院、警察、選挙、税金 等）。これらは「難語」ではなく、辞書的な一般常識であり
  ポップオーバーを出す価値が無い。「知らない人がほぼいない語」を1つでも入れたら失格と考えること
- 迷ったら入れない。「本当にこれを知らないと文の意味が取れない読者が一定数いるか」で判断する
- 人名・固有の組織名単体は原則除く（「誰か」は分かっても「何をする機関か」が分からない場合のみ対象。
  例:「GPIF」は対象、「片山さつき」は対象外）
- 本文に実際に登場する表記のまま matchText に入れる（言い換えない。部分一致で本文をハイライトするため）
- 3個未満・0個でもよい。無理に5個埋めない

# 各語について
- term: 見出し用の正式名
- matchText: 本文中の実際の表記と完全一致する文字列（1つだけ）
- wikipediaQuery: Wikipedia日本語版で検索する語（termと同じでよいが、曖昧な語は正式名称にする）
- fallbackDef: Wikipediaが見つからなかった場合に使う説明。80字以内、専門用語を使わず平易に

JSONのみ: {"terms": [{"term": "...", "matchText": "...", "wikipediaQuery": "...", "fallbackDef": "..."}]}`;

const GLOSSARY_SCHEMA = z.object({
  terms: z
    .array(
      z.object({
        term: z.string().optional().default(""),
        matchText: z.string().optional().default(""),
        wikipediaQuery: z.string().optional().default(""),
        fallbackDef: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
});

function safeParseJson<T extends z.ZodType>(raw: string, schema: T): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = {};
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : (schema.parse({}) as z.infer<T>);
}

const MAX_TERMS = 5;
const DEF_MAX_CHARS = 90;
/** Wikipedia要約の先頭からこの字数以内で文の区切りを探し、無ければそのまま切る */
function trimToSentence(text: string, max: number): string {
  const cut = text.slice(0, max);
  const lastPeriod = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("."));
  if (lastPeriod >= max * 0.5) return cut.slice(0, lastPeriod + 1);
  return text.length > max ? `${cut}…` : cut;
}

interface WikiSummary {
  type?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

async function fetchWikipediaSummary(query: string): Promise<{ def: string; url: string } | null> {
  const title = query.trim();
  if (!title) return null;
  try {
    const res = await fetch(
      `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(6_000), headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as WikiSummary;
    if (data.type === "disambiguation" || !data.extract) return null;
    const url = data.content_urls?.desktop?.page;
    if (!url) return null;
    return { def: trimToSentence(data.extract.trim(), DEF_MAX_CHARS), url };
  } catch {
    return null;
  }
}

export interface ComposeGlossaryInput {
  lead: string;
  bullets: string[];
}

export async function composeGlossary(input: ComposeGlossaryInput): Promise<GlossaryTerm[]> {
  try {
    const client = createOpenAIClient({ timeout: 60_000, maxRetries: 2 });
    const res = await client.chat.completions.create({
      model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: GLOSSARY_PROMPT },
        {
          role: "user",
          content: `lead: ${input.lead}\nbullets:\n${input.bullets.map((b) => `- ${b}`).join("\n")}`,
        },
      ],
    });
    const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", GLOSSARY_SCHEMA);
    const haystack = `${input.lead}\n${input.bullets.join("\n")}`;
    const candidates = parsed.terms
      .map((t) => ({
        term: t.term.trim(),
        matchText: t.matchText.trim(),
        wikipediaQuery: t.wikipediaQuery.trim() || t.term.trim(),
        fallbackDef: t.fallbackDef.trim().slice(0, DEF_MAX_CHARS),
      }))
      // 本文に実在しない表記は当たり判定を作れないため除外
      .filter((t) => t.term && t.matchText && haystack.includes(t.matchText))
      .slice(0, MAX_TERMS);

    const results = await Promise.all(
      candidates.map(async (c): Promise<GlossaryTerm | null> => {
        const wiki = await fetchWikipediaSummary(c.wikipediaQuery);
        if (wiki) {
          return { term: c.term, matchText: c.matchText, def: wiki.def, source: "wikipedia", wikipediaUrl: wiki.url };
        }
        if (!c.fallbackDef) return null;
        return { term: c.term, matchText: c.matchText, def: c.fallbackDef, source: "ai" };
      }),
    );
    return results.filter((t): t is GlossaryTerm => t != null);
  } catch (e) {
    console.warn(`  ⚠️ glossary生成失敗（fail-open・記事公開は続行）: ${e}`);
    return [];
  }
}
