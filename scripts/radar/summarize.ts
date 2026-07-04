/**
 * FactBase Radar — Level 2「現時点まとめ」をGPT-5で生成（速報公開の10〜30分後）。
 *
 * 実行: npx tsx scripts/radar/summarize.ts
 * 名誉毀損・出鱈目要約を構造的に防ぐ設計:
 *   - 入力は「確認済みの見出しとURL」のみ。AIに記事本文もWeb検索も与えない
 *     → 知らないことは書けない。書けるのは「何がどの媒体で報じられているか」の整理だけ
 *   - 報道ベースの争点は全文「〜と報じられています」形式を強制
 *   - 出力後に断定表現の機械チェック → 引っかかったら公開せずHELDに落とす
 *   - 1日の生成上限あり（コスト暴走防止）
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { AI_MODELS, RADAR } from "../../src/lib/constants";
import { createOpenAIClient } from "../../src/lib/openai-client";

const prisma = new PrismaClient();

// このプロンプトは/transparencyで公開する
const SYSTEM = `あなたはFactBaseの編集デスクです。速報段階の争点について「現時点で確認できる情報の整理」を書きます。

# 絶対ルール（法的リスク回避・厳守）
- 与えられた見出しリストに書かれていること以外を書かない。憶測・背景知識・記憶による補完は禁止
- 報道内容を事実として書かない。必ず「〜と○○が報じています」「〜と伝えられています」形式
- 「違法」「有罪」「汚職」「犯罪」を事実として断定しない。疑惑は「〜との報道がある」とだけ書く
- 個人への評価・推測（「悪質」「怪しい」等）を書かない
- 確認できないことは「確認できないこと」セクションに正直に列挙する。これがFactBaseの価値
- 見出しにない固有名詞・数値・日付を書かない

# 文体
です・ます調。1文60字以内。冷静・中立。感嘆符なし。`;

interface ArticleJson {
  lead: string;
  bullets: string[];
  articleHtml: string;
}

const BANNED_PATTERNS = [
  /(?<!と報じられて)(?<!との報道が)(?:は|が)(?:違法|有罪|汚職|犯罪)(?:だ|である|です)/,
  /間違いな[いく]/,
  /確実に(?:違法|不正|犯罪)/,
];

function violatesBan(article: ArticleJson): string | null {
  const all = `${article.lead} ${article.bullets.join(" ")} ${article.articleHtml}`;
  for (const p of BANNED_PATTERNS) {
    const m = all.match(p);
    if (m) return m[0];
  }
  return null;
}

async function main() {
  const dailyLimit = Number(
    process.env.ARTICLE_DAILY_ARTICLE_LIMIT ??
      process.env.SONNET_DAILY_ARTICLE_LIMIT ??
      RADAR.articleDailyArticleLimit,
  );
  const generatedToday = await prisma.issue.count({
    where: { articleGeneratedAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
  });
  if (generatedToday >= dailyLimit) {
    console.log(`本日の記事生成上限（${dailyLimit}）に到達済み — skip`);
    return;
  }

  // Radar公開済み・記事未生成・公開から10分以上経過（続報が集まるのを少し待つ）
  const pending = await prisma.issue.findMany({
    where: {
      confirmation: { in: ["OFFICIAL", "REPORTED"] },
      articleHtml: null,
      createdAt: { lte: new Date(Date.now() - 10 * 60_000) },
    },
    orderBy: { createdAt: "asc" },
    take: dailyLimit - generatedToday,
  });
  if (pending.length === 0) {
    console.log("生成待ちの争点なし");
    return;
  }

  const openai = createOpenAIClient({ timeout: 60_000, maxRetries: 1 });

  for (const issue of pending) {
    const candidate = await prisma.topicCandidate.findUnique({
      where: { issueId: issue.id },
    });
    const sources = (candidate?.sourceUrls as { title: string; url: string; feed: string }[]) ?? [];
    if (sources.length === 0) continue;

    const isReported = issue.confirmation === "REPORTED";
    const sourceList = sources
      .map((s, i) => `${i + 1}. [${s.feed}] ${s.title}\n   ${s.url}`)
      .join("\n");

    console.log(`生成中: ${issue.title}`);
    try {
      const res = await openai.chat.completions.create({
        model: AI_MODELS.article,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `争点: ${issue.title}
種別: ${isReported ? "報道ベース（真偽未確認ラベル必須）" : "公式発表ベース"}

# 確認済みの報道見出し（この情報だけで書く）
${sourceList}

# 出力形式（JSONのみ）
{
  "lead": "3行要約。①何が報じられているか ②現時点で確認できること/できないこと ③今の段階。150字以内",
  "bullets": ["確認できること: …", "確認できないこと: …", "今後見るべき一次情報: …"],
  "articleHtml": "HTML。構成厳守:
    <h2>何が報じられているか</h2>（どの媒体が何を報じたかの整理のみ）
    <h2>現時点で確認できること</h2>（報道の存在・公式発表の有無）
    <h2>現時点で確認できないこと</h2>（正直に列挙）
    <h2>論点</h2>（この争点で意見が分かれるポイントを中立に2〜3個）
    <h2>今後見るべき一次情報</h2>（本人声明・政府発表・資料など種類を挙げる。URLは捏造しない）
    <h2>出典</h2>（与えられたURLのみ<a href>で列挙）"
}`,
          },
        ],
      });

      const text = res.choices[0]?.message?.content ?? "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("JSON抽出失敗");
      const article = JSON.parse(match[0]) as ArticleJson;

      // 機械チェック: 断定表現が混入していたら公開しない
      const banned = violatesBan(article);
      if (banned) {
        console.warn(`  ⚠️ 断定表現検出「${banned}」→ 公開せずHELD`);
        if (candidate) {
          await prisma.topicCandidate.update({
            where: { id: candidate.id },
            data: { status: "HELD", decision: `${candidate.decision} / banned_phrase:${banned}` },
          });
        }
        continue;
      }

      await prisma.$transaction([
        prisma.issue.update({
          where: { id: issue.id },
          data: {
            summaryJson: {
              lead: article.lead,
              bullets: article.bullets,
              sources: sources.slice(0, 5).map((s) => ({
                label: `${s.title.slice(0, 40)}（${s.feed}）`,
                url: s.url,
              })),
            } as unknown as Prisma.InputJsonValue,
            articleHtml: article.articleHtml,
            articleGeneratedAt: new Date(),
          },
        }),
        prisma.issueTimeline.create({
          data: { issueId: issue.id, label: "現時点まとめを公開（GPT-5生成・見出しベース）" },
        }),
      ]);
      console.log(`  ✅ /issues/${issue.slug} のまとめ公開`);
    } catch (e) {
      console.error(`  ❌ 生成失敗: ${e}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
