/**
 * FactBase Radar バズ駆動記事の公開（④ 選定・公開ロジック）。
 *
 * 実行: npx tsx scripts/radar/promote.ts [--dry-run] [--force]
 * cron内で discover.ts の後に走る（本番は discover → promote のみ）。
 * discover.ts が集めた PENDING 候補（discoverySource="buzz"）を
 * ピーク時間帯（通勤・昼休み・夜）にだけ、buzzScore（クロス照合の強さ）と証拠十分性でtop2〜3本を
 * 選んで記事化する。detect/summarize/followup は cron 外（必要なら手動）。
 *
 * 選定基準（両方満たすことを要求。どちらかだけでは薄い記事に戻るため）:
 *   - buzzScore >= minBuzzScoreForPromotion（4ソースのクロス照合。片方だけの弱いシグナルを弾く）
 *   - evaluateEvidenceSufficiency().sufficient（一次情報・複数媒体報道・背景解説等、
 *     記事に実質のある内容を書ける材料が揃っているか）
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { RADAR } from "../../src/lib/constants";
import { toIssueCategory, jstDateString, shouldUseInternationalReports } from "../../src/lib/radar";
import { generateVerifiedArticle, violatesBan } from "../../src/lib/radar-article";
import { assessReportExcerptThickness } from "../../src/lib/article-quality";
import { checkArticleQualityGateWithRepair } from "./lib/article-judge";
import { collectSourceHintsForRepair } from "../../src/lib/article-repair";
import { buildClaimDiff, formatClaimDiffBlock } from "./lib/claim-diff";
import { fetchArticleThumbnail } from "./lib/og-image";
import { composeIssueTitle, composeVoteQuestion } from "../../src/lib/ai";
import { composeGlossary } from "../../src/lib/glossary";
import { fetchPrimaryExcerpts } from "./lib/primary-text";
import { fetchReportExcerpts } from "./lib/report-text";
import { pollingNewsSources } from "./lib/enrich";
import {
  selectTopicsForPromotion,
  findDuplicateActiveIssue,
  dedupeSelectedCandidates,
  resolveCandidateDebateType,
  type SavedEvidence,
  type PromotionCandidate,
  type ActiveIssueForDedup,
} from "./lib/promote-logic";
import { resolveDebateType } from "../../src/lib/debate-type";
import { isWithinPeakWindow, minutesToNearestWindow, isOverdue } from "./lib/schedule";
import { notifyRadarFailure, notifyRadarSkip } from "./notify";
import { notifyRevalidate } from "./lib/notify-revalidate";
import { linkBuzzSourcesToIssue } from "./lib/link-buzz-sources";
import {
  fetchHistoricalDatedExcerpts,
  needsHistoricalEnrich,
  resolveReigniteFromSustained,
  shouldUseTimelineFirstMode,
} from "./lib/historical-enrich";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force"); // ピーク時間帯チェックを無視（動作確認用）
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const PROMOTE_LIMIT = LIMIT_ARG
  ? Math.max(1, parseInt(LIMIT_ARG.split("=")[1] ?? "", 10) || RADAR.buzzArticlesPerWindow)
  : RADAR.buzzArticlesPerWindow;

/**
 * これより古いPENDING候補は選定対象にしない。
 * buzzScoreは「調査した瞬間にどれだけバズっていたか」のスナップショットで、
 * トピックがトレンドから消えても自動でゼロに巻き戻ることはない（discover.tsは
 * トレンドに再度載らない限りそのトピックを触らないため）。なので短すぎる鮮度切りは
 * 「その日のピーク3回すべてで他の強い話題に競り負けた良ネタ」を、翌朝には
 * 二度と選ばれないまま機械的に切り捨ててしまう。
 * 36時間＝「その日の残りのピーク＋翌朝のピーク」まで生存させることで、
 * 一時的に埋もれた良ネタにもう一度チャンスを与える。それより古い（何日も前に
 * 一度だけバズって以来放置されている）候補だけを弾く。
 */
const CANDIDATE_FRESHNESS_HOURS = 36;

async function main() {
  console.log(`📰 Radar promote 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);

  if (!FORCE && !isWithinPeakWindow(new Date(), RADAR.peakWindowsJst, RADAR.peakWindowToleranceMin)) {
    const distance = minutesToNearestWindow(new Date(), RADAR.peakWindowsJst);
    // 許容幅は超えたが近接ピークからさほど離れていない場合、GitHub Actionsの
    // cron遅延/欠落で本来のピーク回を逃した可能性が高いため警告を出す
    // （discover専用の時間帯では毎回距離が大きく鳴らないようnearMiss内だけに限定）。
    if (distance <= RADAR.peakWindowNearMissMin) {
      console.warn(`  ⚠️ ピーク時間帯から${distance}分超過してのスキップ（cron遅延の疑い）`);
      await notifyRadarSkip(
        `promote.ts: ピーク時間帯を${distance}分超過してスキップ（許容${RADAR.peakWindowToleranceMin}分）。GitHub Actionsのcron遅延/欠落の可能性`,
      );
    }

    // 最終防衛ライン: 時間帯を外し続けて何時間も1本も公開されていない場合、
    // 深夜早朝（daily_limit等と紛れないよう配信に適さない時間は除く）以外なら強制的に走らせる。
    // 実際にcronが6回連続で全時間帯を外し、17時間超公開ゼロが続いた事故が起きたための保険。
    const jstHour = new Date(Date.now() + 9 * 60 * 60_000).getUTCHours();
    const withinPublishableHours = jstHour >= 6 && jstHour < 24;
    const lastIssue = await prisma.issue.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (withinPublishableHours && isOverdue(lastIssue?.createdAt ?? null, RADAR.promoteOverdueHours)) {
      console.warn(`  ⚠️ 時間帯外だが最終公開から${RADAR.promoteOverdueHours}時間超過 → 停止防止のため強制実行`);
      await notifyRadarSkip(
        `promote.ts: 最終公開から${RADAR.promoteOverdueHours}時間超過を検知し、時間帯外だが強制実行しました`,
      );
    } else {
      console.log("  ピーク時間帯外のためスキップ（--forceで無視可）");
      return;
    }
  }

  const freshSince = new Date(Date.now() - CANDIDATE_FRESHNESS_HOURS * 60 * 60_000);
  const rows = await prisma.topicCandidate.findMany({
    where: {
      discoverySource: "buzz",
      status: "PENDING",
      issueId: null,
      evidenceJson: { not: Prisma.JsonNull },
      updatedAt: { gte: freshSince },
    },
    orderBy: { updatedAt: "desc" },
    take: 100, // buzzScore/sufficiencyで絞る前の母集団（鮮度内で広めに取る）
  });

  const candidates: PromotionCandidate[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    topicTerm: r.topicTerm,
    sourceUrls:
      (r.sourceUrls as unknown as { title: string; url: string; feed: string; publishedAt?: string }[]) ?? [],
    evidence: r.evidenceJson as unknown as SavedEvidence,
    updatedAt: r.updatedAt,
  }));

  const selected = selectTopicsForPromotion(
    candidates,
    RADAR.minBuzzScoreForPromotion,
    PROMOTE_LIMIT,
    RADAR.maxSameCategoryPerPromoteWindow,
  );
  console.log(
    `  ${candidates.length}件のPENDING候補 → buzzScore>=${RADAR.minBuzzScoreForPromotion}かつ証拠十分で${selected.length}件選定`,
  );

  // 同一ラン内で選ばれた候補同士に「同一出来事」の重複が無いか確認し、あれば1本に統合する
  // （例: 「代表辞任」と「辞任のきっかけになった道交法違反」が別トピックとして同時に選ばれるケース）。
  // 統合後は証拠の厚い方を主候補にし、きっかけ→結果の時系列を1記事にまとめて書けるようにする。
  const deduped = dedupeSelectedCandidates(selected);
  for (const g of deduped) {
    if (g.absorbed.length > 0) {
      console.log(
        `  🔗 [ラン内統合] ${g.absorbed.map((a) => a.title).join(" / ")} を「${g.primary.title}」に統合`,
      );
    }
  }

  // detect.ts（RSS経路）とdiscover.ts（バズ経路）は別々のnanoプロンプトが独立にタイトルを
  // 生成するため、同じ出来事でもdedupKeyの文字列一致だけでは重複を防げないことがある。
  // 新規Issue作成前に、既存のアクティブなIssueと出来事として同一でないか機械的に再確認する。
  const activeIssues: ActiveIssueForDedup[] = await prisma.issue.findMany({
    where: {
      status: { in: ["ACTIVE", "TRENDING"] },
      confirmation: { in: ["OFFICIAL", "REPORTED"] },
      monitoringUntil: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: RADAR.followUpMaxActiveIssuesForMatch,
    select: { id: true, title: true, keywords: true },
  });

  for (const g of deduped) {
    try {
      const duplicate = findDuplicateActiveIssue(g.primary.title, g.primary.topicTerm, activeIssues);
      let issueId: string | null;
      if (duplicate) {
        await mergeIntoExistingIssue(g.primary, duplicate);
        issueId = duplicate.id;
      } else {
        issueId = await promoteOne(g.primary);
      }
      if (issueId && g.absorbed.length > 0) {
        await absorbIntoIssue(g.absorbed, issueId, g.primary.title);
      }
    } catch (e) {
      console.error(`  ❌ 記事化失敗: ${g.primary.title} (${e})`);
      await notifyRadarFailure(`promote.ts: 記事化失敗 ${g.primary.title}`, e);
    }
  }

  console.log("📰 Radar promote 完了");
}

/**
 * ラン内統合（dedupeSelectedCandidates）で主候補に吸収された候補を、
 * 実際に作成/紐づけされたIssueへ後追いで紐づける（記事は別途生成しない）。
 */
async function absorbIntoIssue(absorbed: PromotionCandidate[], issueId: string, primaryTitle: string): Promise<void> {
  if (DRY_RUN) {
    for (const a of absorbed) {
      console.log(`  📝 [dry-run] ${a.title} は「${primaryTitle}」に統合（DB書き込みなし）`);
    }
    return;
  }
  for (const a of absorbed) {
    // TopicCandidate.issueId は @unique のため、吸収候補には issueId を付けない
    // （主候補だけが Issue に紐づく。decision で統合先を残す）
    await prisma.$transaction([
      prisma.topicCandidate.update({
        where: { id: a.id },
        data: {
          status: "PUBLISHED",
          decision: `merged_into:${issueId}:${primaryTitle.slice(0, 80)}`,
        },
      }),
      prisma.issueTimeline.create({
        data: { issueId, label: `バズ検知: 関連トピックとして検知（${a.title.slice(0, 60)}）` },
      }),
    ]);
  }
}

/**
 * 既存のアクティブなIssueと同一出来事だと判定した場合、新規Issueは作らず
 * タイムラインに1行追記するだけに留める（記事本文の再生成はfollowup.tsの担当）。
 */
async function mergeIntoExistingIssue(c: PromotionCandidate, duplicate: ActiveIssueForDedup): Promise<void> {
  console.log(`  🔗 [重複回避] ${c.title} は既存Issue「${duplicate.title}」と同一出来事と判定 — 続報として統合`);
  if (DRY_RUN) return;

  // TopicCandidate.issueId は @unique。duplicate.id は既に別の候補（Issue作成の主候補、
  // または過去の別の続報統合）が保持している可能性が高く、ここでも同じ値をセットすると
  // 一意制約違反でトランザクション全体が失敗する（実際に本番で発生した障害）。
  // absorbIntoIssue と同じ方針で、続報側にはissueIdを付けずdecisionにだけ統合先を残す。
  await prisma.$transaction([
    prisma.topicCandidate.update({
      where: { id: c.id },
      data: { status: "PUBLISHED", decision: `merged_into_existing_issue:${duplicate.id}` },
    }),
    prisma.issueTimeline.create({
      data: {
        issueId: duplicate.id,
        label: `バズ検知: 関連トピックとして検知（${c.title.slice(0, 60)}）`,
      },
    }),
  ]);
}

/** 公開できた場合は作成したIssueのidを返す（ラン内統合の吸収候補を後から紐づけるため）。HELD/dry-runはnull */
async function promoteOne(c: PromotionCandidate): Promise<string | null> {
  let isOfficial = c.evidence.officialEvents.length > 0 || c.evidence.laws.length > 0;
  const internationalSources = c.evidence.internationalNews.map((n) => ({
    title: n.title,
    url: n.url,
    feed: n.source || "international",
  }));

  let primaryExcerpts = isOfficial
    ? await fetchPrimaryExcerpts(
        c.evidence.officialEvents.map((o) => ({ title: o.title, url: o.url, feed: o.feed })),
      )
    : [];

  if (isOfficial && primaryExcerpts.length === 0) {
    console.warn(`  ⚠️ OFFICIAL判定だが一次本文なし → REPORTEDにフォールバック: ${c.title}`);
    isOfficial = false;
  }

  const useInternational = shouldUseInternationalReports(c.category, c.topicTerm || c.title);
  const debateTypePreview =
    c.evidence.debateType ?? resolveCandidateDebateType(c);
  const topicForHistory = c.topicTerm || c.evidence.topic || c.title;
  const doHistorical = needsHistoricalEnrich({
    debateType: debateTypePreview,
    sustained: c.evidence.sustained === true,
    topic: topicForHistory,
  });

  const [reportExcerpts, internationalReportExcerpts, pollingExcerpts, datedExcerpts] =
    await Promise.all([
      isOfficial ? Promise.resolve([]) : fetchReportExcerpts(c.sourceUrls),
      useInternational ? fetchReportExcerpts(internationalSources) : Promise.resolve([]),
      fetchReportExcerpts(pollingNewsSources(c.evidence)),
      doHistorical ? fetchHistoricalDatedExcerpts(topicForHistory) : Promise.resolve([]),
    ]);
  if (!useInternational && internationalSources.length > 0) {
    console.log(`  🌍 国内主争点のため海外報道抜粋はスキップ（${internationalSources.length}件あり）`);
  }
  if (doHistorical) {
    console.log(`  📚 historical-enrich 対象（${datedExcerpts.length}件の過去抜粋）: ${c.title}`);
  }

  // REPORTED: 抜粋が薄いとカスカス記事になるため、生成前に機械チェックでHELD
  // 長期争点は国際＋過去抜粋も厚さに含める（速報だけ薄いが経緯で書けるケース）
  if (!isOfficial) {
    const thickness = assessReportExcerptThickness([
      ...reportExcerpts,
      ...internationalReportExcerpts,
      ...datedExcerpts,
    ]);
    if (!thickness.ok) {
      console.warn(`  ⚠️ 薄い報道抜粋「${thickness.reason}」→ 公開せずHELD: ${c.title}`);
      await prisma.topicCandidate.update({
        where: { id: c.id },
        data: { status: "HELD", decision: `thin_excerpts:${(thickness.reason ?? "").slice(0, 200)}` },
      });
      return null;
    }
  }

  // カードのサムネイル取得（リンクプレビュー用・自前保存なし）。本文取得に既に成功したURLを
  // 候補にすることで無駄打ちを減らす。記事生成と並行して走らせ、公開直前にまとめて待つ。
  const thumbnailPromise = fetchArticleThumbnail(
    [...reportExcerpts, ...internationalReportExcerpts, ...datedExcerpts].map((e) => ({
      url: e.url,
      feed: e.feed,
    })),
  ).catch(() => null);

  const debateResolved = resolveDebateType({
    topic: c.topicTerm || c.evidence.topic || c.title,
    category: c.category,
    title: c.title,
    voteQuestion: c.evidence.voteQuestion,
    newsTitles: (c.evidence.news ?? []).map((n) => n.title),
    debateType: debateTypePreview,
    reignite: c.evidence.reignite,
  });
  const reignite = resolveReigniteFromSustained({
    debateType: debateResolved?.debateType ?? debateTypePreview,
    sustained: c.evidence.sustained === true,
    reignite: debateResolved?.reignite ?? c.evidence.reignite === true,
  });
  const timelineFirst = shouldUseTimelineFirstMode({
    debateType: debateResolved?.debateType ?? debateTypePreview,
    sustained: c.evidence.sustained === true,
    reignite,
    datedExcerptCount: datedExcerpts.length,
  });

  // ④ 媒体別主張のdiff（一致点/食い違い/単独媒体限定）を先に機械抽出し、Writerには生抜粋と併せて渡す。
  let claimDiffBlock = "";
  try {
    claimDiffBlock = formatClaimDiffBlock(
      await buildClaimDiff(
        [...reportExcerpts, ...internationalReportExcerpts].map((e) => ({
          feed: e.feed,
          title: e.title,
          text: e.text,
        })),
      ),
    );
  } catch (e) {
    console.warn(`  ⚠️ 媒体diffのnano失敗（fail-open・生抜粋のみで続行）: ${c.title} (${e})`);
  }

  if (timelineFirst) {
    console.log(`  🧭 timeline-first モード（reignite=${reignite}）: ${c.title}`);
  }

  const {
    article: generatedArticle,
    verified,
    unresolvedClaims,
    sideRepairUsed,
  } = await generateVerifiedArticle({
    issueTitle: c.title,
    isReported: !isOfficial,
    sources: c.sourceUrls,
    primaryExcerpts,
    reportExcerpts,
    internationalReportExcerpts,
    claimDiffBlock,
    pollingExcerpts,
    dietSpeeches: c.evidence.dietSpeeches,
    background: c.evidence.background,
    laws: c.evidence.laws,
    estatStats: c.evidence.estatStats,
    debateType: debateResolved?.debateType ?? null,
    reignite,
    datedExcerpts,
    timelineFirst,
  });
  let article = generatedArticle;

  if (!verified) {
    const reasons = unresolvedClaims.map((c2) => `${c2.text}(${c2.reason})`).join(" / ");
    console.warn(`  ⚠️ 主張の裏取り不合格「${reasons}」→ 公開せずHELD: ${c.title}`);
    await prisma.topicCandidate.update({
      where: { id: c.id },
      data: { status: "HELD", decision: `unverified_claim:${reasons.slice(0, 200)}` },
    });
    return null;
  }

  const banned = violatesBan(article);
  if (banned) {
    console.warn(`  ⚠️ 断定表現検出「${banned}」→ 公開せずHELD: ${c.title}`);
    await prisma.topicCandidate.update({
      where: { id: c.id },
      data: { status: "HELD", decision: `banned_phrase:${banned}` },
    });
    return null;
  }

  try {
    const hints = collectSourceHintsForRepair({
      reportExcerpts,
      primaryExcerpts,
      internationalReportExcerpts,
      dietSpeeches: c.evidence.dietSpeeches,
      claimDiffBlock,
    });
    const { gate, articleHtml: gatedHtml, repaired } = await checkArticleQualityGateWithRepair(
      {
        title: c.title,
        lead: article.lead,
        articleHtml: article.articleHtml,
      },
      hints,
      { sideRepairAlreadyUsed: sideRepairUsed },
    );
    if (repaired) {
      article = { ...article, articleHtml: gatedHtml };
      console.log(`  🔧 両側mini修理で品質ゲート通過: ${c.title}`);
    }
    if (!gate.ok) {
      console.warn(`  ⚠️ 品質ゲート不合格「${gate.reason}」→ 公開せずHELD: ${c.title}`);
      await prisma.topicCandidate.update({
        where: { id: c.id },
        data: { status: "HELD", decision: `quality_gate:${(gate.reason ?? "").slice(0, 200)}` },
      });
      return null;
    }
  } catch (e) {
    console.warn(`  ⚠️ 品質ゲートnano失敗（fail-open・公開続行）: ${c.title} (${e})`);
  }

  // discover段階の仮設問・選択肢（見出しだけを見て作った）を、実際の記事本文と確定debateTypeに
  // 合わせて作り直す。失敗時はdiscover段階の値にフォールバックする（記事公開は止めない）。
  const fallbackChoices =
    c.evidence.voteChoices ?? { for: "支持する", against: "支持しない", undecided: "わからない" };
  const { question: voteQuestionTitle, choices } = await composeVoteQuestion({
    issueTitle: c.title,
    lead: article.lead,
    bullets: article.bullets,
    debateType: debateResolved?.debateType ?? "policy",
    fallbackQuestion: c.evidence.voteQuestion || c.title,
    fallbackChoices,
  });

  if (DRY_RUN) {
    const thumbnail = await thumbnailPromise;
    console.log(
      `  📝 [dry-run] ${c.title}（buzzScore=${c.evidence.buzzScore} / ${isOfficial ? "OFFICIAL" : "REPORTED"}）`,
    );
    console.log(`     lead: ${article.lead}`);
    console.log(`     question: ${voteQuestionTitle}`);
    console.log(
      `     choices: for=${choices.for} / against=${choices.against} / undecided=${choices.undecided}`,
    );
    console.log(
      `     thumbnail: ${thumbnail ? `${thumbnail.thumbnailUrl}（出典: ${thumbnail.thumbnailSourceFeed}）` : "取得失敗/なし"}`,
    );
    return null;
  }

  const slug = `radar-buzz-${jstDateString()}-${randomUUID().slice(0, 8)}`;
  const thumbnail = await thumbnailPromise;

  // shareTitle（X/OG/SEO用の「自分ごとフック」）はtitle（中立な投票設問）と分離して生成する。
  // 失敗してもtitleへフォールバックするだけなので記事公開は止めない。
  const [shareTitle, glossary] = await Promise.all([
    composeIssueTitle({
      clusterTitle: c.title,
      question: voteQuestionTitle,
      sourceTitles: c.sourceUrls.map((s) => s.title),
      classification: isOfficial ? "official" : "reported",
      category: c.category ?? "",
      primaryExcerpts,
      debateType: debateResolved?.debateType,
    }).catch((e) => {
      console.warn(`  ⚠️ shareTitle生成失敗（titleにフォールバック）: ${e}`);
      return "";
    }),
    composeGlossary({ lead: article.lead, bullets: article.bullets }),
  ]);

  // 実際に本文を取得して読み比べた媒体数（表示用sourcesは5件に間引くため、
  // 「何件のソースを横断比較したか」はここで別途数える。reportExcerpts〜pollingExcerptsは
  // すべてWriterに実際に渡された抜粋なので、この集合が「本当に比較した数」の実態に近い。
  // primaryExcerptsは一次情報（官報・議事録等）でfeed名を持たないため、あれば+1件として数える）
  const distinctSourceCount =
    new Set(
      [...reportExcerpts, ...internationalReportExcerpts, ...datedExcerpts, ...pollingExcerpts]
        .map((e) => e.feed)
        .filter(Boolean),
    ).size + (primaryExcerpts.length > 0 ? 1 : 0);

  const issue = await prisma.issue.create({
    data: {
      slug,
      title: voteQuestionTitle,
      shareTitle: shareTitle || null,
      category: toIssueCategory(c.category ?? ""),
      status: "TRENDING",
      confirmation: isOfficial ? "OFFICIAL" : "REPORTED",
      summaryJson: {
        lead: article.lead,
        bullets: article.bullets,
        sources: c.sourceUrls.slice(0, 5).map((s) => ({ label: `${s.title.slice(0, 40)}（${s.feed}）`, url: s.url })),
        sourceCount: Math.max(distinctSourceCount, Math.min(c.sourceUrls.length, 5)),
      } as unknown as Prisma.InputJsonValue,
      articleHtml: article.articleHtml,
      articleGeneratedAt: new Date(),
      voteLabelsJson: choices as unknown as Prisma.InputJsonValue,
      glossaryJson: glossary.length > 0 ? (glossary as unknown as Prisma.InputJsonValue) : undefined,
      debateType: debateResolved?.debateType ?? null,
      thumbnailUrl: thumbnail?.thumbnailUrl ?? null,
      thumbnailSourceUrl: thumbnail?.thumbnailSourceUrl ?? null,
      thumbnailSourceFeed: thumbnail?.thumbnailSourceFeed ?? null,
      keywords: c.topicTerm ? [c.topicTerm] : [c.title],
      monitoringUntil: new Date(Date.now() + 60 * 86400_000),
    },
  });

  await prisma.$transaction([
    prisma.topicCandidate.update({
      where: { id: c.id },
      data: { status: "PUBLISHED", issueId: issue.id },
    }),
    prisma.issueTimeline.create({
      data: {
        issueId: issue.id,
        label: `バズ検知→一次情報調査を経て記事を公開（buzzScore=${c.evidence.buzzScore}）`,
      },
    }),
  ]);

  const linkSources = [
    ...c.sourceUrls,
    ...c.evidence.officialEvents.map((o) => ({ title: o.title, url: o.url, feed: o.feed })),
    ...c.evidence.news.map((n) => ({ title: n.title, url: n.url, feed: n.source || "google-news" })),
  ];
  const linked = await linkBuzzSourcesToIssue(prisma, issue.id, linkSources, c.topicTerm);
  if (linked.created + linked.linkedExisting > 0) {
    console.log(`  🔗 SourceEvent紐づけ: 新規${linked.created}・既存RSS${linked.linkedExisting}件`);
  }

  await notifyRevalidate(slug, issue.id);
  console.log(`  ✅ /issues/${slug} を公開（${isOfficial ? "OFFICIAL" : "REPORTED"}・buzzScore=${c.evidence.buzzScore}）`);
  return issue.id;
}

main()
  .catch(async (e) => {
    console.error(e);
    await notifyRadarFailure("promote.ts 致命的エラー（ジョブ全体が停止）", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
