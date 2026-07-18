/**
 * HELD 候補の管理者承認 → フル記事生成してから公開（プレースホルダー争点を作らない）。
 */
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { invalidateOnIssueChanged } from "@/lib/cache-invalidate";
import { isRoutineOfficialUpdate, toIssueCategory } from "@/lib/radar";
import { generateVerifiedArticle, violatesBan } from "@/lib/radar-article";
import { assessReportExcerptThickness } from "@/lib/article-quality";
import { composeGlossary } from "@/lib/glossary";
import { fetchPrimaryExcerpts } from "../../scripts/radar/lib/primary-text";
import { fetchReportExcerpts } from "../../scripts/radar/lib/report-text";
import { checkArticleQualityGate } from "../../scripts/radar/lib/article-judge";
import {
  ensureEvidence,
  evidenceToArticleFacts,
  internationalNewsSources,
} from "../../scripts/radar/lib/enrich";
import { resolveIssueTitle } from "../../scripts/radar/lib/issue-title";
import { linkBuzzSourcesToIssue } from "../../scripts/radar/lib/link-buzz-sources";

type TopicCandidateRow = {
  id: string;
  title: string;
  category: string | null;
  classification: string | null;
  topicTerm: string | null;
  sourceUrls: unknown;
  decision: string | null;
};

export async function publishHeldRadarCandidate(candidate: TopicCandidateRow): Promise<{ slug: string }> {
  const sources = (candidate.sourceUrls as { title: string; url: string; feed: string }[] | null) ?? [];
  if (sources.length === 0) {
    throw new Error("出典が無い候補は公開できません");
  }

  const feedNames = sources.map((s) => s.feed);
  if (
    isRoutineOfficialUpdate(candidate.title, feedNames) ||
    sources.some((s) => isRoutineOfficialUpdate(s.title, [s.feed]))
  ) {
    throw new Error("日程表・統計掲載などルーティン更新は争点として公開しません");
  }

  const isOfficial =
    candidate.classification === "official" || candidate.classification === "indicator";
  let primaryExcerpts = isOfficial ? await fetchPrimaryExcerpts(sources) : [];
  let effectiveOfficial = isOfficial;
  if (isOfficial && primaryExcerpts.length === 0) {
    effectiveOfficial = false;
  }

  const reportExcerpts = effectiveOfficial ? [] : await fetchReportExcerpts(sources);
  const evidence = await ensureEvidence(prisma, candidate.topicTerm ?? candidate.title, {
    id: candidate.id,
    evidenceJson: null,
    updatedAt: new Date(0),
    topicTerm: candidate.topicTerm,
    title: candidate.title,
  });
  const { dietSpeeches, background, laws, estatStats, estatFigures, dietVote } = evidenceToArticleFacts(evidence);
  const internationalReportExcerpts = evidence
    ? await fetchReportExcerpts(internationalNewsSources(evidence))
    : [];

  // promote.ts と同じ機械品質ゲート。以前はここが一切呼ばれておらず、
  // 「薄い報道抜粋」「両論性不足」等でHELDになった候補でも管理者の承認だけで
  // 無検証のまま公開できてしまっていた（自動ゲートより承認フローの方が緩いという逆転構造）。
  if (!effectiveOfficial) {
    const thickness = assessReportExcerptThickness([
      ...reportExcerpts,
      ...internationalReportExcerpts,
    ]);
    if (!thickness.ok) {
      throw new Error(`報道抜粋が薄いため公開できません: ${thickness.reason ?? ""}`);
    }
  }

  const issueTitle = await resolveIssueTitle({
    question: candidate.title,
    clusterTitle: candidate.title,
    sources,
    confirmation: effectiveOfficial ? "OFFICIAL" : "REPORTED",
    classification: candidate.classification ?? "report",
    category: candidate.category ?? "politics",
    primaryExcerpts: primaryExcerpts.map((e) => ({ title: e.title, text: e.text })),
  });
  if (!issueTitle) {
    throw new Error("具体性のあるタイトルを生成できませんでした");
  }

  const { article, verified, unresolvedClaims } = await generateVerifiedArticle({
    issueTitle,
    isReported: !effectiveOfficial,
    sources,
    primaryExcerpts,
    reportExcerpts,
    internationalReportExcerpts,
    dietSpeeches,
    background,
    laws,
    estatStats,
    estatFigures,
    dietVote,
  });
  if (!verified) {
    const reasons = unresolvedClaims.map((c) => c.reason).join(", ");
    throw new Error(`記事の根拠検証に失敗: ${reasons.slice(0, 120)}`);
  }
  const banned = violatesBan(article);
  if (banned) {
    throw new Error(`断定表現を検出: ${banned}`);
  }

  try {
    const gate = await checkArticleQualityGate({
      title: issueTitle,
      lead: article.lead,
      articleHtml: article.articleHtml,
    });
    if (!gate.ok) {
      throw new Error(`品質ゲート不合格: ${gate.reason ?? ""}`);
    }
  } catch (e) {
    // nano呼び出し自体の失敗はfail-open（promote.tsと同じ方針）。
    // ゲート判定自体がokでなかった場合(上のthrow)はそのまま公開をブロックする。
    if (e instanceof Error && e.message.startsWith("品質ゲート不合格")) throw e;
    console.warn(`[radar-publish-held] 品質ゲートnano失敗（fail-open・公開続行）: ${e}`);
  }

  const glossary = await composeGlossary({ lead: article.lead, bullets: article.bullets });
  const distinctSourceCount =
    new Set([...reportExcerpts, ...internationalReportExcerpts].map((e) => e.feed).filter(Boolean)).size +
    (primaryExcerpts.length > 0 ? 1 : 0);

  const slug = `radar-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
  const issue = await prisma.issue.create({
    data: {
      slug,
      title: issueTitle,
      category: toIssueCategory(candidate.category ?? "politics"),
      status: "TRENDING",
      confirmation: effectiveOfficial ? "OFFICIAL" : "REPORTED",
      summaryJson: {
        lead: article.lead,
        bullets: article.bullets,
        sources: sources.slice(0, 12).map((s) => ({
          label: `${s.title.slice(0, 40)}（${s.feed}）`,
          url: s.url,
        })),
        sourceCount: Math.max(distinctSourceCount, sources.length),
      } as unknown as Prisma.InputJsonValue,
      articleHtml: article.articleHtml,
      articleGeneratedAt: new Date(),
      glossaryJson: glossary.length > 0 ? (glossary as unknown as Prisma.InputJsonValue) : undefined,
      keywords: candidate.topicTerm ? [candidate.topicTerm] : [issueTitle],
      monitoringUntil: new Date(Date.now() + 60 * 86400_000),
    },
  });

  await prisma.$transaction([
    prisma.topicCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "PUBLISHED",
        issueId: issue.id,
        decision: `${candidate.decision ?? ""} / admin_approved_full_article`,
      },
    }),
    prisma.issueTimeline.create({
      data: { issueId: issue.id, label: "管理者承認により記事付きで公開（人間確認済み）" },
    }),
  ]);

  await linkBuzzSourcesToIssue(prisma, issue.id, sources, candidate.topicTerm);
  await invalidateOnIssueChanged(slug);
  return { slug };
}
