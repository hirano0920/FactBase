/**
 * 争点記事生成CLI（管理画面の代わり・手動実行）
 *
 * 使い方:
 *   npx tsx scripts/generate-article.ts \
 *     --slug consumption-tax-reduction \
 *     --title "消費税減税法案について" \
 *     --category POLITICS \
 *     --source ./sources/tax-law.txt \
 *     [--law-name "消費税法" --law-url "https://elaws.e-gov.go.jp/..."]
 *
 * 流れ:
 *   1. --source のテキスト（e-Gov/会議録から手動コピペした一次情報）を読む
 *   2. nano: 法令チャンク分割の提案（JSON）
 *   3. コンソールで承認 (y/n)
 *   4. GPT-5: SEO記事生成（3行要約 + H2要点 + 賛否両論 + FAQ + 出典）
 *   5. Issue + EvidenceChunk + IssueEvidenceLink をDBに保存（pinned=trueで優先リンク）
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { PrismaClient, type IssueCategory } from "@prisma/client";
import OpenAI from "openai";
import { AI_MODELS } from "../src/lib/constants";
import { createOpenAIClient } from "../src/lib/openai-client";

const prisma = new PrismaClient();

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i]?.startsWith("--")) args[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return args;
}

interface ChunkProposal {
  articleRef: string | null;
  text: string;
}

async function proposeChunks(openai: OpenAI, sourceText: string): Promise<ChunkProposal[]> {
  const res = await openai.chat.completions.create({
    model: AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'あなたは法令テキストの整理係です。与えられた一次情報を、ファクトチェックの根拠に使える200〜600字のチャンクに分割してください。条文参照があれば articleRef に入れる。JSONのみ: {"chunks": [{"articleRef": "第X条" | null, "text": "..."}]}',
      },
      { role: "user", content: sourceText.slice(0, 30_000) },
    ],
  });
  const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
    chunks?: ChunkProposal[];
  };
  return parsed.chunks ?? [];
}

interface ArticleOutput {
  lead: string;
  bullets: string[];
  articleHtml: string;
}

async function generateArticle(
  openai: OpenAI,
  title: string,
  sourceText: string,
): Promise<ArticleOutput> {
  // このプロンプトは /transparency で全文公開する（運営方針）
  const system = `あなたは政治の一次情報を中立に解説する編集者です。読者は「Xの政治論争に疲れた、政治に関心はあるが専門知識はない人」。高校生でも読める文章で、しかし内容は正確に書いてください。

# 絶対ルール
- 与えられた一次情報に書かれていることだけを書く。記憶にある「関連しそうな事実」を混ぜない
- 数値・条文番号・日付は一次情報から正確に転記し、本文中に「（第X条）」のように出所を示す
- 政党への支持・不支持を示さない。「政府は」「野党は」と主体を明示した客観記述に徹する
- 賛成側・反対側の論点は同じ分量・同じ真剣さで書く（どちらかを藁人形にしない）
- 断定できないことは「〜とされている」「国会では〜という議論がある」と保留を明示

# 文体
- です・ます調。1文は60字以内を目安に短く
- 専門用語は初出時に一言で説明（例:「歳入（国の収入）」）
- 煽り・感嘆符・レトリックなし。冷静さがこのサイトの価値`;

  const res = await openai.chat.completions.create({
    model: AI_MODELS.article,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `争点タイトル: ${title}

# 一次情報
${sourceText.slice(0, 50_000)}

# 出力形式（JSONのみ・キー順も厳守）
{
  "lead": "3行要約。①何が起きているか ②何が争点か ③今どの段階か。全体150字以内",
  "bullets": ["要点1（40字以内）", "要点2", "要点3"],
  "articleHtml": "HTML記事。構成と見出しは以下を厳守:
    <h2>なにが起きているのか</h2>（背景と経緯、300字前後）
    <h2>争点はどこか</h2>（対立の核心を1つに絞る、300字前後）
    <h2>賛成側の論点</h2>（最も強い論拠を2〜3つ、箇条書き<ul>可）
    <h2>反対側の論点</h2>（最も強い論拠を2〜3つ、賛成側と同分量）
    <h2>よくある質問</h2>（<h3>Q. …</h3><p>A. …</p> を3組。検索されやすい素朴な疑問を選ぶ）
    <h2>出典</h2>（一次情報への<a href>リンクリスト。憶測でURLを作らない）"
}`,
      },
    ],
  });

  const text = res.choices[0]?.message?.content ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("GPT-5の出力からJSONを抽出できませんでした");
  return JSON.parse(jsonMatch[0]) as ArticleOutput;
}

async function main() {
  const args = parseArgs();
  const { slug, title, category, source } = args;
  if (!slug || !title || !category || !source) {
    console.error(
      "必須: --slug --title --category (POLITICS|LAW|ECONOMY|FINANCE|EDUCATION) --source <file>",
    );
    process.exit(1);
  }

  const sourceText = readFileSync(source, "utf-8");
  const openai = createOpenAIClient({ timeout: 60_000, maxRetries: 1 });
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("1/3 nanoで法令チャンク分割を提案中…");
  const chunks = await proposeChunks(openai, sourceText);
  console.log(`\n提案されたチャンク: ${chunks.length}件`);
  chunks.forEach((c, i) =>
    console.log(`  [${i}] ${c.articleRef ?? "(参照なし)"} — ${c.text.slice(0, 60)}…`),
  );

  const approve = await rl.question("\nこのチャンクで進めますか？ (y/n): ");
  if (approve.trim().toLowerCase() !== "y") {
    console.log("中止しました");
    process.exit(0);
  }

  console.log("\n2/3 GPT-5で記事生成中…");
  const article = await generateArticle(openai, title, sourceText);

  console.log("\n3/3 DBに保存中…");
  const issue = await prisma.issue.upsert({
    where: { slug },
    create: {
      slug,
      title,
      category: category as IssueCategory,
      summaryJson: {
        lead: article.lead,
        bullets: article.bullets,
        sources: [
          {
            label: args["law-name"] ?? "一次情報",
            url: args["law-url"] ?? "https://elaws.e-gov.go.jp/",
          },
        ],
      },
      articleHtml: article.articleHtml,
      articleGeneratedAt: new Date(),
    },
    update: {
      title,
      summaryJson: {
        lead: article.lead,
        bullets: article.bullets,
        sources: [
          {
            label: args["law-name"] ?? "一次情報",
            url: args["law-url"] ?? "https://elaws.e-gov.go.jp/",
          },
        ],
      },
      articleHtml: article.articleHtml,
      articleGeneratedAt: new Date(),
    },
  });

  for (const chunk of chunks) {
    const evidenceChunk = await prisma.evidenceChunk.create({
      data: {
        sourceType: "LAW",
        sourceId: args["law-name"] ?? slug,
        sourceName: args["law-name"] ?? title,
        articleRef: chunk.articleRef,
        text: chunk.text,
        sourceUrl: args["law-url"] ?? "https://elaws.e-gov.go.jp/",
        category: [category as IssueCategory],
      },
    });
    await prisma.issueEvidenceLink.create({
      data: { issueId: issue.id, chunkId: evidenceChunk.id, pinned: true },
    });
  }

  console.log(`\n✅ 完了: /issues/${slug}`);
  console.log(`   lead: ${article.lead}`);
  console.log(`   チャンク: ${chunks.length}件`);
  rl.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
