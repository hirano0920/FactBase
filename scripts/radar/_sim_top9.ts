/**
 * 改善後ロジックで今日の投稿9本をシミュレーション（Writerなし）。
 * 因果マージ + SelectionV2 + resolveIssueTrack + 24h重複 を本番相当で適用。
 */
import { prisma } from "../../src/lib/prisma";
import {
  selectTopicsForPromotion,
  findDuplicateActiveIssue,
  dedupeSelectedCandidates,
  type PromotionCandidate,
  type SavedEvidence,
  type ActiveIssueForDedup,
} from "./lib/promote-logic";
import { selectionV2RankScore, passesSelectionV2 } from "./lib/selection-v2";
import { classifyTopic, structuralAxis } from "./lib/axis-lock";
import { resolveIssueTrack } from "./lib/issue-track";
import { bigrams, jaccard } from "../../src/lib/radar";
import { extractContentTokens } from "./lib/match-tweet-count";
import { RADAR } from "../../src/lib/constants";

function causalMerge(candidates: PromotionCandidate[]): PromotionCandidate[] {
  const FINANCE_CAUSE_ALIASES: [string, string][] = [
    ["キオクシア", "日経"],
    ["キオクシア", "株"],
    ["賠償", "急落"],
    ["賠償", "暴落"],
    ["特許", "急落"],
  ];
  const mergedKeys = new Set<string>();
  const list = [...candidates];
  for (let i = 0; i < list.length; i++) {
    if (mergedKeys.has(list[i].id)) continue;
    for (let j = i + 1; j < list.length; j++) {
      if (mergedKeys.has(list[j].id)) continue;
      const titleA = list[i].title;
      const titleB = list[j].title;
      const tokensA = extractContentTokens(titleA);
      const sharedInBoth = tokensA.filter((t) => titleB.includes(t) && titleA.includes(t));
      const causalHit =
        FINANCE_CAUSE_ALIASES.some(([a, b]) => titleA.includes(a) && titleB.includes(b)) ||
        FINANCE_CAUSE_ALIASES.some(([a, b]) => titleA.includes(b) && titleB.includes(a));
      const enoughShare =
        sharedInBoth.filter((t) => t.length >= 3).length >= 2 ||
        (causalHit && sharedInBoth.some((t) => t.length >= 2));
      if (!enoughShare && !causalHit) continue;
      const shouldMerge = causalHit || sharedInBoth.filter((t) => t.length >= 3).length >= 2;
      if (!shouldMerge) continue;

      const a = list[i];
      const b = list[j];
      a.evidence = {
        ...a.evidence,
        news: [...(a.evidence.news ?? []), ...(b.evidence.news ?? [])],
        buzzScore: Math.max(a.evidence.buzzScore ?? 0, b.evidence.buzzScore ?? 0),
        tweetCount: Math.max(a.evidence.tweetCount ?? 0, b.evidence.tweetCount ?? 0),
        commentCount: Math.max(a.evidence.commentCount ?? 0, b.evidence.commentCount ?? 0),
        commentFrictionScore: a.evidence.commentFrictionScore ?? b.evidence.commentFrictionScore,
        newsClusterCount: Math.max(a.evidence.newsClusterCount ?? 0, b.evidence.newsClusterCount ?? 0),
        youtubeCommentCount: Math.max(
          a.evidence.youtubeCommentCount ?? 0,
          b.evidence.youtubeCommentCount ?? 0,
        ),
        youtubeReplyCount: Math.max(a.evidence.youtubeReplyCount ?? 0, b.evidence.youtubeReplyCount ?? 0),
        youtubeLikeCount: Math.max(a.evidence.youtubeLikeCount ?? 0, b.evidence.youtubeLikeCount ?? 0),
        buzzSources: [...new Set([...(a.evidence.buzzSources ?? []), ...(b.evidence.buzzSources ?? [])])],
      };
      a.title = a.title.length >= b.title.length ? a.title : b.title;
      mergedKeys.add(b.id);
    }
  }
  return list.filter((c) => !mergedKeys.has(c.id));
}

function scoreRow(c: PromotionCandidate) {
  const topic = c.topicTerm || c.evidence.topic || c.title;
  const topicClass = classifyTopic(topic);
  const hasRealExternalPoll = Boolean(
    c.evidence.externalPoll?.question &&
      Array.isArray(c.evidence.externalPoll?.choices) &&
      c.evidence.externalPoll.choices.length >= 2,
  );
  const track = resolveIssueTrack({
    legitimate: c.evidence.debatable !== false,
    debatable: c.evidence.debatable,
    externalPollDivision: c.evidence.externalPoll?.divisionScore,
    commentFrictionScore: c.evidence.commentFrictionScore,
    claimDiffConflictCount: 0,
    topicClass,
    hasRealExternalPoll,
  });
  const ev = { ...c.evidence, topic, debatable: track === "news" ? false : c.evidence.debatable };
  const breakdown = selectionV2RankScore(ev);
  const axis = structuralAxis(topic);
  return { track, topicClass, breakdown, axis, pass: passesSelectionV2(breakdown) };
}

async function main() {
  const jst = new Date(Date.now() + 9 * 3600_000);
  const dayStart = new Date(jst);
  dayStart.setUTCHours(0, 0, 0, 0);
  dayStart.setTime(dayStart.getTime() - 9 * 3600_000);
  const todayPublished = await prisma.issue.count({
    where: { slug: { startsWith: "radar-buzz-" }, createdAt: { gte: dayStart } },
  });

  const pending = await prisma.topicCandidate.findMany({
    where: { status: "PENDING", discoverySource: "buzz" },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  let candidates: PromotionCandidate[] = pending.map((p) => ({
    id: p.id,
    title: p.title,
    topicTerm: p.topicTerm,
    category: p.category,
    sourceUrls: (p.sourceUrls as { title: string; url: string; feed: string }[]) ?? [],
    evidence: (p.evidenceJson as SavedEvidence) ?? ({} as SavedEvidence),
    updatedAt: p.updatedAt,
  }));

  candidates = causalMerge(candidates);

  const selected = selectTopicsForPromotion(
    candidates,
    RADAR.minBuzzScoreForPromotion,
    40,
    RADAR.maxSameCategoryPerPromoteWindow,
  );
  const deduped = dedupeSelectedCandidates(selected).map((g) => g.primary);

  const recent24h = await prisma.issue.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      status: { in: ["ACTIVE", "TRENDING"] },
    },
    select: { id: true, title: true, keywords: true, createdAt: true },
    take: 40,
    orderBy: { createdAt: "desc" },
  });

  const activeIssues: ActiveIssueForDedup[] = recent24h.map((i) => ({
    id: i.id,
    title: i.title,
    keywords: i.keywords,
    createdAt: i.createdAt,
  }));

  type Row = {
    title: string;
    track: string;
    topicClass: string;
    rank: number;
    axis: string;
    sideA: string;
    sideB: string;
    comments: number;
    skip?: string;
  };

  const scored: Row[] = [];
  for (const c of deduped) {
    const { track, topicClass, breakdown, axis, pass } = scoreRow(c);
    if (!pass) continue;

    const dup3h = findDuplicateActiveIssue(c.title, c.topicTerm, activeIssues);
    const cBig = bigrams(c.title);
    const dup24 = recent24h.find(
      (ri) => jaccard(cBig, bigrams(`${ri.title} ${(ri.keywords ?? []).join(" ")}`)) >= 0.3,
    );

    scored.push({
      title: c.title,
      track: track === "news" ? "News" : "Debate",
      topicClass,
      rank: breakdown.rankScore,
      axis: axis.axis,
      sideA: axis.sideA,
      sideB: axis.sideB,
      comments: c.evidence.commentCount ?? 0,
      skip: dup3h ? "3h重複" : dup24 ? "24h重複" : undefined,
    });
  }

  scored.sort((a, b) => b.rank - a.rank);

  const clean = scored.slice(0, 9);
  const remaining = scored.filter((r) => !r.skip).slice(0, 9);

  console.log(`■ 前提: PENDING ${pending.length}件 / 本日公開済 ${todayPublished}本\n`);

  console.log("=== A. ゼロから回した場合の想定9本 ===\n");
  clean.forEach((r, i) => {
    console.log(`${i + 1}. [${r.track}] ${r.title}`);
    console.log(`   class=${r.topicClass} rank=${r.rank.toFixed(3)} comment=${r.comments}`);
    console.log(`   軸: ${r.axis}`);
    if (r.skip) console.log(`   ※実運用: ${r.skip}でスキップ`);
    console.log("");
  });

  console.log("=== B. いまから新規投稿できる（重複除外後） ===\n");
  if (remaining.length === 0) {
    console.log("（新規枠なし）");
  } else {
    remaining.forEach((r, i) => {
      console.log(`${i + 1}. [${r.track}] ${r.title} (rank=${r.rank.toFixed(3)})`);
    });
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
