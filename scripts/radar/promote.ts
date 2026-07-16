/**
 * FactBase Radar バズ駆動記事の公開（④ 選定・公開ロジック）。
 *
 * 実行: npx tsx scripts/radar/promote.ts [--dry-run] [--force]
 * cron内で discover.ts の後に走る（本番は discover → promote のみ）。
 * discover.ts が集めた PENDING 候補（discoverySource="buzz"）を
 * ピーク時間帯（通勤・昼休み・夜）にだけ、buzzScore（クロス照合の強さ）と証拠十分性でtop2〜3本を
 * 選んで記事化する。detect/summarize/followup は cron 外（必要なら手動）。
 *
 * 選定基準（Selection V2）— 3条件すべて必須:
 *   1. 両論Gate（抜粋後 assessDebateLegitimacy、fail-closed）
 *   2. Buzz' 下限以上（露出）
 *   3. Heat' 下限以上（盛り上がり）
 *   Rank: Buzz'×Heat'×DVS'。日次最低本数キャッチアップなし（硬上限のみ）
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { RADAR } from "../../src/lib/constants";
import { toIssueCategory, jstDateString, jstDayStart, shouldUseInternationalReports } from "../../src/lib/radar";
import { generateVerifiedArticle, violatesBan, hasFactualClaimIssue } from "../../src/lib/radar-article";
import {
  assessReportExcerptThickness,
  finalizeArticleForSave,
  sideSectionsPlain,
} from "../../src/lib/article-quality";
import { checkArticleQualityGateWithRepair } from "./lib/article-judge";
import { collectSourceHintsForRepair } from "../../src/lib/article-repair";
import { buildClaimDiff, formatClaimDiffBlock, type ClaimDiffResult } from "./lib/claim-diff";
import { fetchArticleThumbnail } from "./lib/og-image";
import {
  composeIssueTitle,
  composeVoteQuestion,
  verifyVoteChoicesReflectSides,
  assessEvidenceWriteability,
  assessDebateLegitimacy,
} from "../../src/lib/ai";
import { pickBestIssueTitle } from "./lib/issue-title";
import { composeGlossary } from "../../src/lib/glossary";
import { fetchPrimaryExcerpts } from "./lib/primary-text";
import { fetchReportExcerpts } from "./lib/report-text";
import { pollingNewsSources } from "./lib/enrich";
import {
  selectTopicsForPromotion,
  findDuplicateActiveIssue,
  dedupeSelectedCandidates,
  resolveCandidateDebateType,
  weightedPromoteScore,
  type SavedEvidence,
  type PromotionCandidate,
  type ActiveIssueForDedup,
} from "./lib/promote-logic";
import { selectionV2RankScore, passesSelectionV2, combineConflictPrime, type SelectionV2Breakdown } from "./lib/selection-v2";
import {
  evaluateBuzzPromoteSufficiency,
  refreshDivisionSignals,
  createPollDetailCache,
} from "./lib/research";
import { computePromoteRunBudget, countRemainingPeaks } from "./lib/daily-quota";
import { fetchRecentYahooPolls } from "./sources/yahoo-polls";
import { resolveDebateType } from "../../src/lib/debate-type";
import { isWithinPeakWindow, minutesToNearestWindow, isOverdue } from "./lib/schedule";
import { notifyRadarFailure, notifyRadarSkip } from "./notify";
import { notifyRevalidate } from "./lib/notify-revalidate";
import { linkBuzzSourcesToIssue } from "./lib/link-buzz-sources";
import { buildLockedAxis } from "./lib/axis-lock";
import {
  fetchHistoricalDatedExcerpts,
  needsHistoricalEnrich,
  resolveReigniteFromSustained,
  shouldUseTimelineFirstMode,
} from "./lib/historical-enrich";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force"); // ピーク時間帯チェックを無視（動作確認用）
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const BASE_PROMOTE_LIMIT = LIMIT_ARG
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

/**
 * 実際にWriterまで進める本数より広めに「本文取得・厚さ判定」の対象を取る。
 * 従来はbuzzScore上位を選んだ直後にWriter執筆を試み、証拠が薄いと判明してから
 * HELDにしていた（一番コストの高い工程まで無駄打ちしていた）。ここを広げ、
 * ①本文取得(ネットワークのみ・LLM課金なし)は候補プール全件で並列に済ませ、
 * ②厚さゲート通過後にbuzz+分断度で並べ、③成功本数に達するまでWriterに進める。
 */
function researchPoolSize(targetCount: number): number {
  return Math.max(targetCount, targetCount * RADAR.researchPoolMultiplier);
}

/** 候補ごとの本文取得を並列化する上限（Yahoo/Tavily のレート制限と Neon 接続圧を避ける） */
const RESEARCH_CONCURRENCY = 4;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** 本日JSTで公開済みのバズ記事本数（slug prefix で集計） */
async function countTodayBuzzPublished(): Promise<number> {
  return prisma.issue.count({
    where: {
      slug: { startsWith: "radar-buzz-" },
      createdAt: { gte: jstDayStart() },
    },
  });
}

// ★ C: HELD理由集計用
const heldReasons = new Map<string, number>();
function trackHeld(decision: string, title: string) {
  // decision の先頭 prefix（例: "thin_excerpts:理由..." → "thin_excerpts"）
  const prefix = decision.split(":")[0];
  const detail = decision.includes(":") ? decision.split(":").slice(1).join(":").slice(0, 100) : "";
  heldReasons.set(prefix, (heldReasons.get(prefix) ?? 0) + 1);
  console.warn(`  ⚠️ HELD->${prefix}${detail ? `「${detail}」` : ""}: ${title}`);
}
function logHeldSummary() {
  if (heldReasons.size === 0) return;
  console.log("\n📊 HELD分析サマリー（このラン）:");
  for (const [reason, count] of [...heldReasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}件`);
  }
  console.log("  各HELD理由は記事生成パイプライン改善の優先度判断に使ってください。\n");
}

async function main() {
  heldReasons.clear(); // ★ C: HELD集計リセット
  console.log(`📰 Radar promote 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);

  const now = new Date();
  const peakCheck = isWithinPeakWindow(now, RADAR.peakWindowsJst, RADAR.peakWindowToleranceMin);
  const todayCount = await countTodayBuzzPublished();
  const remainingPeaks = countRemainingPeaks(now, RADAR.peakWindowsJst, RADAR.peakWindowToleranceMin);
  let budgetForRun = computePromoteRunBudget({
    todayCount,
    baseLimit: BASE_PROMOTE_LIMIT,
    minTarget: RADAR.dailyPublishMinTarget,
    softTarget: RADAR.dailyPublishSoftTarget,
    hardCap: RADAR.dailyPublishHardCap,
    inPeakWindow: FORCE || peakCheck,
    remainingPeaks: FORCE ? Math.max(1, remainingPeaks) : remainingPeaks,
    force: FORCE,
  });

  console.log(
    `  日次枠: 本日${todayCount}本済 / min${RADAR.dailyPublishMinTarget} soft${RADAR.dailyPublishSoftTarget} cap${RADAR.dailyPublishHardCap} → このラン目標${budgetForRun.targetCount}本（${budgetForRun.reason}）`,
  );

  // 硬上限到達
  if (budgetForRun.reason === "daily_hard_cap") {
    console.log(`  本日すでに硬上限${RADAR.dailyPublishHardCap}本に達しているためスキップ`);
    return;
  }

  // ピーク外かつ最低達成 → overdue保険だけ確認して、ダメならスキップ
  if (!FORCE && !peakCheck && !budgetForRun.shouldRun) {
    const distance = minutesToNearestWindow(now, RADAR.peakWindowsJst);
    if (distance <= RADAR.peakWindowNearMissMin) {
      console.warn(`  ⚠️ ピーク時間帯から${distance}分超過してのスキップ（cron遅延の疑い）`);
      await notifyRadarSkip(
        `promote.ts: ピーク時間帯を${distance}分超過してスキップ（許容${RADAR.peakWindowToleranceMin}分）。GitHub Actionsのcron遅延/欠落の可能性`,
      );
    }
    const jstHour = new Date(Date.now() + 9 * 60 * 60_000).getUTCHours();
    const withinPublishableHours = jstHour >= 6 && jstHour < 24;
    const lastIssue = await prisma.issue.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (withinPublishableHours && isOverdue(lastIssue?.createdAt ?? null, RADAR.promoteOverdueHours)) {
      console.warn(
        `  ⚠️ 時間帯外だが最終公開から${RADAR.promoteOverdueHours}時間超過 → 停止防止のため強制実行`,
      );
      await notifyRadarSkip(
        `promote.ts: 最終公開から${RADAR.promoteOverdueHours}時間超過を検知し、時間帯外だが強制実行しました`,
      );
      budgetForRun = computePromoteRunBudget({
        todayCount,
        baseLimit: BASE_PROMOTE_LIMIT,
        minTarget: RADAR.dailyPublishMinTarget,
        softTarget: RADAR.dailyPublishSoftTarget,
        hardCap: RADAR.dailyPublishHardCap,
        inPeakWindow: true,
        remainingPeaks: Math.max(1, remainingPeaks),
        force: true,
      });
    } else {
      console.log("  ピーク時間帯外のためスキップ（--forceで無視可）");
      return;
    }
  }

  // Selection V2: 日次最低本数キャッチアップは廃止（budget が outside_peak を返す）

  if (!budgetForRun.shouldRun || budgetForRun.targetCount <= 0) {
    console.log("  このランの公開枠が0のためスキップ");
    return;
  }

  const PROMOTE_LIMIT = budgetForRun.targetCount;
  const RESEARCH_POOL_SIZE = researchPoolSize(PROMOTE_LIMIT);
  // ラン途中でも硬上限を超えないよう、開始時点の残室を保持
  const roomAtStart = Math.max(0, RADAR.dailyPublishHardCap - todayCount);
  const successCap = Math.min(PROMOTE_LIMIT, roomAtStart);

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
    RESEARCH_POOL_SIZE,
    RADAR.maxSameCategoryPerPromoteWindow,
  );
  console.log(
    `  ${candidates.length}件のPENDING候補 → buzzScore>=${RADAR.minBuzzScoreForPromotion}かつ証拠十分で${selected.length}件を調査対象に選定（本文取得後に上位${PROMOTE_LIMIT}件へ絞り込み）`,
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

  // ①本文取得・厚さ判定を候補プール全件で並列に済ませる（ネットワークのみ・LLM課金なし）。
  // 薄い候補はここでHELDにし、Writerまでは進めない（researchCandidate内で判定）。
  // 並列数は RESEARCH_CONCURRENCY で上限（無制限 Promise.all はレート制限・接続枯渇の原因になる）。
  const researched = await mapPool(deduped, RESEARCH_CONCURRENCY, async (g) => {
    try {
      return { g, r: await researchCandidate(g.primary) };
    } catch (e) {
      console.error(`  ❌ 調査失敗: ${g.primary.title} (${e})`);
      await notifyRadarFailure(`promote.ts: 調査失敗 ${g.primary.title}`, e);
      return { g, r: null };
    }
  });

  const thicknessOk = researched.filter(
    (x): x is { g: (typeof deduped)[number]; r: ResearchedCandidate } => x.r !== null,
  );

  // ②厚さOK候補だけ、分断シグナル（Yahoo投票/コメント）をpromote直前に再取得して順位を更新する。
  // discover時の証拠は最大36時間古いことがあり、投票数やコメント分布が変わっているため。
  const yahooPolls = await fetchRecentYahooPolls();
  const pollDetailCache = createPollDetailCache();
  await mapPool(thicknessOk, RESEARCH_CONCURRENCY, async (item) => {
    const c = item.r.c;
    try {
      const newsUrls = [
        ...c.sourceUrls.map((s) => s.url),
        ...(c.evidence.news ?? []).map((n) => n.url),
        ...(c.evidence.internationalNews ?? []).map((n) => n.url),
      ];
      const refreshed = await refreshDivisionSignals({
        topic: c.topicTerm || c.title,
        newsUrls,
        yahooPolls,
        pollDetailCache,
      });
      if (refreshed.externalPoll) {
        c.evidence.externalPoll = refreshed.externalPoll;
        c.evidence.commentStanceSpread = undefined;
      } else if (refreshed.commentStanceSpread) {
        c.evidence.commentStanceSpread = refreshed.commentStanceSpread;
      }
      if (typeof refreshed.commentFrictionScore === "number") {
        c.evidence.commentFrictionScore = refreshed.commentFrictionScore;
      }
      const suff = evaluateBuzzPromoteSufficiency(c.evidence);
      item.r.promoteScore = weightedPromoteScore(c, suff.distinctNewsOutlets);
    } catch (e) {
      console.warn(`  ⚠️ 分断シグナル再取得失敗（既存evidenceで続行）: ${c.title} (${e})`);
    }
    return item;
  });

  // ③両論Gate通過（researchCandidate内）かつ Buzz'×Heat' を満たす候補だけを並べ、
  // ④成功本数が successCap に達するまで Writer を試す（失敗・HELD・マージは枠を消費しない）。
  const ranked = [...thicknessOk]
    .filter((item) => {
      const breakdown = selectionV2RankScore(item.r.c.evidence);
      // promoteScore 再計算後も3下限を再確認（分断シグナル更新で Heat が変わりうる）
      item.r.promoteScore = breakdown.rankScore;
      return passesSelectionV2(breakdown);
    })
    .sort((a, b) => {
      const scoreDiff = b.r.promoteScore - a.r.promoteScore;
      if (scoreDiff !== 0) return scoreDiff;
      return b.r.thicknessScore - a.r.thicknessScore;
    });
  console.log(
    `  両論Gate+厚さOK: ${researched.length}件中 → Buzz×Heat通過${ranked.length}件 → 成功${successCap}本までWriter（候補${ranked.length}件）`,
  );

  let published = 0;
  for (const { g, r } of ranked) {
    if (published >= successCap) break;
    try {
      const duplicate = findDuplicateActiveIssue(g.primary.title, g.primary.topicTerm, activeIssues);
      if (duplicate) {
        await mergeIntoExistingIssue(g.primary, duplicate);
        // 既存Issueへの統合は新規公開枠を消費しない（次の候補で本数を埋める）
        continue;
      }
      const issueId = await writeAndPublish(r);
      if (issueId) {
        published += 1;
        if (g.absorbed.length > 0) {
          await absorbIntoIssue(g.absorbed, issueId, g.primary.title);
        }
      }
    } catch (e) {
      console.error(`  ❌ 記事化失敗: ${g.primary.title} (${e})`);
      await notifyRadarFailure(`promote.ts: 記事化失敗 ${g.primary.title}`, e);
    }
  }
  console.log(
    `  Writer結果: 公開${published}/${successCap}本（厚さOK候補${ranked.length}件から / 本日累計見込${todayCount + published}/${RADAR.dailyPublishHardCap}）`,
  );

  logHeldSummary(); // ★ C

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

interface ResearchedCandidate {
  c: PromotionCandidate;
  isOfficial: boolean;
  primaryExcerpts: Awaited<ReturnType<typeof fetchPrimaryExcerpts>>;
  reportExcerpts: Awaited<ReturnType<typeof fetchReportExcerpts>>;
  internationalReportExcerpts: Awaited<ReturnType<typeof fetchReportExcerpts>>;
  pollingExcerpts: Awaited<ReturnType<typeof fetchReportExcerpts>>;
  datedExcerpts: Awaited<ReturnType<typeof fetchHistoricalDatedExcerpts>>;
  debateTypePreview: ReturnType<typeof resolveCandidateDebateType>;
  useInternational: boolean;
  doHistorical: boolean;
  /** 本文の実測量（assessReportExcerptThicknessのtotalChars相当）。タイブレーカー用 */
  thicknessScore: number;
  /** buzz+分断度など選定スコア。Writer順位の主キー */
  promoteScore: number;
  /**
   * 媒体横断比較（共通点・食い違い・単独報道）。claimDiff前倒しにより本文取得と同時に
   * nanoで機械的に抽出し、Writerだけでなく軸ロック・片側検出にも使う。
   */
  claimDiff: ClaimDiffResult;
  /** formatClaimDiffBlock済みのテキストブロック。Writerプロンプトにそのまま埋め込む */
  claimDiffBlock: string;
  /** 軸ロック: 現実の対立軸を証拠から確定した結果。Writerに「この軸で書け」と拘束するためのもの。null=軸ロック不能（fail-soft） */
  lockedAxis: import("./lib/axis-lock").AxisLockResult | null;
  /** 選定時スコア内訳（publish時にevidenceJsonに保存し、週次キャリブレーションに使う） */
  selectionBreakdown: SelectionV2Breakdown & { combinedConflictPrime: number; claimDiffConflicts: number };
}

/**
 * ①本文取得(ネットワークのみ・LLM課金なし)と厚さ判定だけを行う。薄い場合はここでHELDにし、
 * nullを返す（Writerまで進めない）。OFFICIAL（一次資料あり）は厚さ判定の対象外とし、
 * 一次資料の分量をそのままスコアにする（一次情報がある時点で証拠として十分強いため）。
 */
async function researchCandidate(c: PromotionCandidate): Promise<ResearchedCandidate | null> {
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
  // pollingExcerptsも世論材料として厚さに含める（世論調査報道だけで書ける争点の取りこぼし防止）
  let thicknessScore = 0;
  if (!isOfficial) {
    const thickness = assessReportExcerptThickness([
      ...reportExcerpts,
      ...internationalReportExcerpts,
      ...datedExcerpts,
      ...pollingExcerpts,
    ]);
    if (!thickness.ok) {
      trackHeld(`thin_excerpts:${(thickness.reason ?? "").slice(0, 200)}`, c.title);
      if (!DRY_RUN) {
        await prisma.topicCandidate.update({
          where: { id: c.id },
          data: { status: "HELD", decision: `thin_excerpts:${(thickness.reason ?? "").slice(0, 200)}` },
        });
      }
      return null;
    }
    thicknessScore = thickness.totalChars;
  // ★★★ ⑥B: 可読性ゲート（nano事前スクリーニング）★★★
  // 厚さゲートは通ったが、実際に書けるかnanoで確認する。
  // Writer（generateVerifiedArticle）は高コストなため、書けない材料で呼ぶと無駄になる。
  // nano判定は安価（¥1未満）で、失敗時はwritable=trueで通過（Writer呼び出しを止めない）。
  // 注: このゲートは「書けるか」だけを見る。争点の正当性・軸の正確性は後続の別ゲートが担当する。
    if (thickness.ok) {
      const writeableCheck = await assessEvidenceWriteability([
        ...reportExcerpts,
        ...internationalReportExcerpts,
        ...datedExcerpts,
        ...pollingExcerpts,
      ]);
      if (!writeableCheck.writable) {
        trackHeld(`writeability_rejected:${(writeableCheck.reason ?? "").slice(0, 200)}`, c.title);
        if (!DRY_RUN) {
          await prisma.topicCandidate.update({
            where: { id: c.id },
            data: {
              status: "HELD",
              decision: `writeability_rejected:${(writeableCheck.reason ?? "").slice(0, 200)}`,
            },
          });
        }
        return null;
      }
    }
  } else {
    thicknessScore = primaryExcerpts.reduce((sum, e) => sum + (e.text?.length ?? 0), 0);
  }

  // ★★★ claimDiff前倒し: 媒体横断比較（共通点・食い違い・単独報道）を本文取得と同時にnanoで
  // 機械的に抽出し、片側検出・軸ロック・Writerの3段階で再利用する。
  let claimDiff: ClaimDiffResult = { agreements: [], conflicts: [], outletOnly: [] };
  let claimDiffBlock = "";
  {
    const excerpts = [...reportExcerpts, ...internationalReportExcerpts].map((e) => ({
      feed: e.feed,
      title: e.title,
      text: e.text,
    }));
    const diff = await buildClaimDiff(excerpts).catch(() => ({ agreements: [], conflicts: [], outletOnly: [] }));
    claimDiff = diff;
    claimDiffBlock = formatClaimDiffBlock(diff, excerpts);
    const isEmpty =
      diff.agreements.length === 0 && diff.conflicts.length === 0 && diff.outletOnly.length === 0;
    if (isEmpty) {
      console.warn(`  ⚠️ 媒体diffが空（nano成功したが差分なし）: ${c.title}`);
    } else {
      console.log(
        `  📊 媒体diff: 共通${diff.agreements.length} / 食い違い${diff.conflicts.length} / 単独${diff.outletOnly.length} — ${c.title}`,
      );
    }
  }

  // ★★★ 片側抜粋HELD: media diffで「食い違い（conflicts）」がゼロかつ単独報道しかない場合、
  // 実質的に一方的な報道しか集まっていないと判断し、LLM正当性Gateを呼ぶ前にHELDする。
  // （conflictsが無い＝各社同じ主張を並べているだけ＝両論記事が書けない）
  if (!isOfficial && claimDiff.conflicts.length === 0 && !DRY_RUN) {
    const reason = claimDiff.outletOnly.length === 0
      ? "全媒体一致（食い違いゼロ）"
      : `食い違いゼロ・単独報道のみ${claimDiff.outletOnly.length}件`;
    const decision = `one_sided_excerpts:${reason}`;
    trackHeld(decision, c.title);
    await prisma.topicCandidate.update({
      where: { id: c.id },
      data: { status: "HELD", decision },
    });
    return null;
  }

  // ★★★ 軸ロック: 現実の対立軸を証拠から確定し、Writerの芯ズレを防ぐ。
  let lockedAxis = await buildLockedAxis({
    topic: c.topicTerm || c.evidence.topic || c.title,
    voteQuestion: c.evidence.voteQuestion,
    pollChoices: c.evidence.externalPoll?.choices,
    claimDiffConflicts: claimDiff.conflicts.length > 0 ? claimDiff.conflicts : undefined,
    commentSamples: c.evidence.commentSamples,
    newsTitles: [...reportExcerpts, ...internationalReportExcerpts].map((e) => e.title).filter(Boolean),
  });
  if (lockedAxis) {
    console.log(`  🔒 軸ロック: 「${lockedAxis.axis}」 (sideA: ${lockedAxis.sideA} / sideB: ${lockedAxis.sideB})`);
  } else {
    console.warn(`  ⚠️ 軸ロック不能 → HELD: ${c.title}`);
    trackHeld(`axis_unresolved:軸ロックが全ての情報源から対立軸を確定できなかった (voteQuestion=${c.evidence.voteQuestion ?? "none"})`, c.title);
    if (!DRY_RUN) {
      await prisma.topicCandidate.update({
        where: { id: c.id },
        data: { status: "HELD", decision: `axis_unresolved:軸ロック不成立` },
      });
    }
    return null;
  }

  // ★★★ 争点正当性フィルタ（両論Gate）★★★
  // 抜粋上、賛成/反対の両論が成立する話題だけを Writer 候補に残す。
  // fail-closed: 判定失敗・抜粋不足は通さない（熱量だけでカスが上がるのを防ぐ）。
  // 設問は lockedAxis.axis を使用（仮設問禁止。discover由来のvoteQuestionは使わない）
  {
    const legitimacyResult = await assessDebateLegitimacy({
      topic: c.title,
      voteQuestion: lockedAxis.axis, // ← lockedAxis.axis を使用（仮設問禁止）
      excerpts: [
        ...primaryExcerpts,
        ...reportExcerpts,
        ...internationalReportExcerpts,
        ...datedExcerpts,
        ...pollingExcerpts,
      ],
      category: c.category ?? undefined,
    });
    // 2026-07-16: predictedDivisionScoreによるハードゲート（lopsided_predicted）は撤去。
    // 実際の世論に関する判定（実測でもAI予測でも）は単独のハードゲートにせず、
    // resolveDivisionScore経由でDVS'（独立因子）のソフトランクにのみ
    // 反映する。ここではevidenceに保存し、Gate通過後のpromoteScore計算に効かせる。
    if (legitimacyResult.legitimate && legitimacyResult.predictedDivisionScore !== undefined) {
      c.evidence.predictedDivisionScore = legitimacyResult.predictedDivisionScore;
    }

    if (!legitimacyResult.legitimate) {
      const typeLabel = legitimacyResult.problemType || "unknown";
      const reasonSuffix = legitimacyResult.reason
        ? `:${legitimacyResult.reason.slice(0, 100)}`
        : "";
      trackHeld(`debate_legitimacy_rejected:${typeLabel}${reasonSuffix}`, c.title);

      // salvage: bad_frame + suggestedFrames → 代案設問で1回だけ再判定
      if (
        legitimacyResult.problemType === "bad_frame" &&
        legitimacyResult.suggestedFrames.length > 0
      ) {
        console.log(
          `  💡 bad_frame — 代案設問 "${legitimacyResult.suggestedFrames[0]}" で再判定`,
        );
        const salvageResult = await assessDebateLegitimacy({
          topic: c.title,
          voteQuestion: legitimacyResult.suggestedFrames[0],
          excerpts: [
            ...primaryExcerpts,
            ...reportExcerpts,
            ...internationalReportExcerpts,
            ...datedExcerpts,
            ...pollingExcerpts,
          ],
          category: c.category ?? undefined,
        });
        if (salvageResult.legitimate) {
          console.log(`  ✅ 代案設問でサルベージ成功: "${legitimacyResult.suggestedFrames[0]}"`);
          // salvage成功: lockedAxisを差し替え、Writer以降は差し替え軸で動作
          lockedAxis.axis = legitimacyResult.suggestedFrames[0];
          if (salvageResult.predictedDivisionScore !== undefined) {
            c.evidence.predictedDivisionScore = salvageResult.predictedDivisionScore;
          }
          // legitimacy通過扱いにしてWriterに進む（このifブロックを抜ける）
        } else {
          console.warn(`  ❌ 代案設問でも不合格 → HELD`);
          if (!DRY_RUN) {
            await prisma.topicCandidate.update({
              where: { id: c.id },
              data: { status: "HELD", decision: `debate_legitimacy_rejected:${typeLabel}${reasonSuffix}_salvage_failed` },
            });
          }
          return null;
        }
      } else {
        // bad_frame以外、またはsuggestedFrames無し → 通常HELD
        if (!DRY_RUN) {
          await prisma.topicCandidate.update({
            where: { id: c.id },
            data: {
              status: "HELD",
              decision: `debate_legitimacy_rejected:${typeLabel}${reasonSuffix}`,
            },
          });
        }
        return null;
      }
    }
  }

  const suff = evaluateBuzzPromoteSufficiency(c.evidence);
  const baseBreakdown = selectionV2RankScore(c.evidence);
  const combinedCp = combineConflictPrime(
    baseBreakdown.conflictPrime,
    claimDiff.conflicts.length,
  );
  // 事後的な議論熱（claimDiffの食い違い数）を反映したプロモートスコア
  const promoteScore = baseBreakdown.rankScore * (combinedCp / baseBreakdown.conflictPrime);
  const selectionBreakdown = { ...baseBreakdown, combinedConflictPrime: combinedCp, claimDiffConflicts: claimDiff.conflicts.length };

  return {
    c,
    isOfficial,
    primaryExcerpts,
    reportExcerpts,
    internationalReportExcerpts,
    pollingExcerpts,
    datedExcerpts,
    debateTypePreview,
    useInternational,
    doHistorical,
    thicknessScore,
    promoteScore,
    claimDiff,
    claimDiffBlock,
    lockedAxis,
    selectionBreakdown,
  };
}

/** 公開できた場合は作成したIssueのidを返す（ラン内統合の吸収候補を後から紐づけるため）。HELD/dry-runはnull */
async function writeAndPublish(researched: ResearchedCandidate): Promise<string | null> {
  const {
    c,
    isOfficial,
    primaryExcerpts,
    reportExcerpts,
    internationalReportExcerpts,
    pollingExcerpts,
    datedExcerpts,
    debateTypePreview,
    claimDiffBlock,
    lockedAxis,
    selectionBreakdown,
  } = researched;

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

  // ★ claimDiffは前倒し済み: researchCandidateで既にbuildClaimDiff済みのblockをそのまま使う
  // （一致点・食い違い・単独報道の機械抽出は本文取得と同時に済ませている）
  if (claimDiffBlock) {
    console.log(`  📊 媒体diffブロック準備済み（researchCandidateで抽出済み）`);
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
    lockedAxis: lockedAxis ?? undefined,
  });
  let article = generatedArticle;

  if (!verified) {
    // 2026-07-16: 事実の裏取り失敗(unsupported/ungrounded_number/source_not_found等)と
    // 文章の書き方・構成の問題(bullets_too_thin/incident_first_missing等)を同じ
    // "unverified_claim"プレフィックスで一括りに記録していたため、実際は文章のスタイル要件を
    // 満たせなかっただけの記事まで「事実がでっち上げられた」ように見えるHELD監査上の誤りがあった。
    // hasFactualClaimIssueで分岐し、本物の事実検証失敗だけをunverified_claimと呼ぶ。
    const prefix = hasFactualClaimIssue(unresolvedClaims) ? "unverified_claim" : "style_gate";
    const reasons = unresolvedClaims.map((c2) => `${c2.text}(${c2.reason})`).join(" / ");
    trackHeld(`${prefix}:${reasons.slice(0, 200)}`, c.title);
    if (!DRY_RUN) {
      await prisma.topicCandidate.update({
        where: { id: c.id },
        data: { status: "HELD", decision: `${prefix}:${reasons.slice(0, 200)}` },
      });
    }
    return null;
  }

  const banned = violatesBan(article);
  if (banned) {
    trackHeld(`banned_phrase:${banned}`, c.title);
    if (!DRY_RUN) {
      await prisma.topicCandidate.update({
        where: { id: c.id },
        data: { status: "HELD", decision: `banned_phrase:${banned}` },
      });
    }
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
      trackHeld(`quality_gate:${(gate.reason ?? "").slice(0, 200)}`, c.title);
      if (!DRY_RUN) {
        await prisma.topicCandidate.update({
          where: { id: c.id },
          data: { status: "HELD", decision: `quality_gate:${(gate.reason ?? "").slice(0, 200)}` },
        });
      }
      return null;
    }
  } catch (e) {
    console.warn(`  ⚠️ 品質ゲートnano失敗（fail-open・公開続行）: ${c.title} (${e})`);
  }

  // ★品質ゲート修理（両側mini修理）はarticleHtmlだけを差し替え、lead/bullets再同期・
  // 構造再検証はしない。finalizeArticleForSaveで必ず保存直前にこれを行う
  // （promote.ts/followup.ts共通の最終ゲート。本番で実際にlead≠冒頭セクションのズレが
  // 発生したため、個別に直すのをやめて共通関数化した）。
  let finalized: ReturnType<typeof finalizeArticleForSave>;
  try {
    finalized = finalizeArticleForSave(article, {
      isReported: !isOfficial,
      debateType: debateResolved?.debateType,
      issueTitle: c.title,
    });
  } catch (e) {
    console.warn(`  ⚠️ finalizeArticleForSave失敗（HELD）: ${c.title} (${e})`);
    trackHeld(`finalize_error:${String(e).slice(0, 100)}`, c.title);
    if (!DRY_RUN) {
      await prisma.topicCandidate.update({
        where: { id: c.id },
        data: { status: "HELD", decision: `finalize_error:${String(e).slice(0, 200)}` },
      });
    }
    return null;
  }
  article = finalized.article;
  if (finalized.issues.length > 0) {
    const reasons = finalized.issues.map((i) => `${i.reason}:${i.message}`).join(" / ");
    trackHeld(`final_structure:${reasons.slice(0, 200)}`, c.title);
    if (!DRY_RUN) {
      await prisma.topicCandidate.update({
        where: { id: c.id },
        data: { status: "HELD", decision: `final_structure:${reasons.slice(0, 200)}` },
      });
    }
    return null;
  }

  // discover段階の仮設問・選択肢（見出しだけを見て作った）を、実際の記事本文と確定debateTypeに
  // 合わせて作り直す。失敗時はdiscover段階の値にフォールバックする（記事公開は止めない）。
  const fallbackChoices =
    c.evidence.voteChoices ?? { for: "支持する", against: "支持しない", undecided: "わからない" };
  const voteQuestionInput = {
    issueTitle: c.title,
    lead: article.lead,
    bullets: article.bullets,
    debateType: debateResolved?.debateType ?? ("policy" as const),
    fallbackQuestion: c.evidence.voteQuestion || c.title,
    fallbackChoices,
  };
  let { question: voteQuestionTitle, choices } = await composeVoteQuestion(voteQuestionInput);

  // 選択肢(for/against)が両側セクションの実際の主張内容と噛み合っているかをnanoで確認する
  // （sanitizePolarVoteChoices等は極性の形式しか見ておらず、政党名リーク等の実害があったため）。
  // 不一致なら1回再生成し、再生成結果も再検証する。2回目もダメならそのまま公開（fail-open）。
  const sides = sideSectionsPlain(article.articleHtml);
  if (sides.length >= 2) {
    const [sideA, sideB] = sides;
    const itemsA = sideA.items.length > 0 ? sideA.items : [sideA.text];
    const itemsB = sideB.items.length > 0 ? sideB.items : [sideB.text];
    const runContentCheck = (forLabel: string, againstLabel: string) =>
      verifyVoteChoicesReflectSides({
        choices: { for: forLabel, against: againstLabel },
        sideA: { heading: sideA.heading, items: itemsA },
        sideB: { heading: sideB.heading, items: itemsB },
      });
    const contentCheck = await runContentCheck(choices.for, choices.against);
    if (!contentCheck.aligned) {
      console.warn(`  ⚠️ 投票選択肢が対立の芯とズレている（${contentCheck.reason}）→ 再生成: ${c.title}`);
      const retried = await composeVoteQuestion({
        ...voteQuestionInput,
        avoidHint: `前回の選択肢「${choices.for}」「${choices.against}」は却下されました
（${contentCheck.reason || "両側セクションの実際の主張内容と噛み合っていなかったため"}）。
政党名・人物名ではなく、両側セクションで実際に主張されている理由を指す選択肢にしてください。
設問は「前置き＋選択肢A？選択肢B？」の1文形式を厳守し、二重質問にしないでください。`,
      });
      const recheck = await runContentCheck(retried.choices.for, retried.choices.against);
      if (recheck.aligned) {
        voteQuestionTitle = retried.question;
        choices = retried.choices;
      } else {
        console.warn(
          `  ⚠️ 投票選択肢の再生成後も不一致（${recheck.reason}）→ 再生成案を採用して続行: ${c.title}`,
        );
        voteQuestionTitle = retried.question;
        choices = retried.choices;
      }
    }
  }

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
    // 補充ループの成功カウント用（DBは書かないが「公開相当」として枠を消費する）
    return "__dry_run__";
  }

  const slug = `radar-buzz-${jstDateString()}-${randomUUID().slice(0, 8)}`;
  const thumbnail = await thumbnailPromise;

  // shareTitle（X/OG/SEO用の「自分ごとフック」）はtitle（中立な投票設問）と分離して生成する。
  // composeIssueTitleは3案を返し、pickBestIssueTitleが無料一次フィルタ(空虚な仮定フック・
  // 英語見出し)を通した候補の中からnano選抜(judgeIssueTitleQuality)で最良の1つを選ぶ。
  // 全滅・失敗時はtitle（中立な投票設問）へフォールバックする（記事公開は止めない）。
  const [shareTitleCandidates, glossary] = await Promise.all([
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
      return [];
    }),
    composeGlossary({ lead: article.lead, bullets: article.bullets }),
  ]);

  let shareTitle = "";
  const picked = await pickBestIssueTitle(shareTitleCandidates);
  if (picked) {
    shareTitle = picked;
  } else if (shareTitleCandidates.length > 0) {
    console.warn(
      `  ⚠️ shareTitle候補が全て低品質(空虚な仮定フック/英語)のためtitleにフォールバック: ${shareTitleCandidates.join(" / ")}`,
    );
  }

  // 実際に本文を取得して読み比べた媒体数（実際にWriterに渡した抜粋の数。内部追跡用）。
  // sourceCountとは別に、表示用のsourceCountは候補が持つ全ソースの総数（引き出しの大きさ）を表示する。
  const distinctSourceCount =
    new Set(
      [...reportExcerpts, ...internationalReportExcerpts, ...datedExcerpts, ...pollingExcerpts]
        .map((e) => e.feed)
        .filter(Boolean),
    ).size + (primaryExcerpts.length > 0 ? 1 : 0);

  // 候補が持つ全ソースの総数（発見フェーズで集めた全URL。これが「90+の引き出し」の実態）。
  const totalSourcePool = new Set([
    ...c.sourceUrls.map((s) => s.url),
    ...(c.evidence.news ?? []).map((n) => n.url),
    ...(c.evidence.internationalNews ?? []).map((n) => n.url),
    ...(c.evidence.officialEvents ?? []).map((o) => o.url),
  ]).size;

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
        sources: c.sourceUrls.slice(0, 12).map((s) => ({ label: `${s.title.slice(0, 40)}（${s.feed}）`, url: s.url })),
        sourceCount: Math.max(distinctSourceCount, totalSourcePool),
        externalPoll: c.evidence.externalPoll ?? undefined,
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
      data: {
        status: "PUBLISHED",
        issueId: issue.id,
        evidenceJson: {
          ...c.evidence,
          publishScoreBreakdown: selectionBreakdown,
        } as unknown as Prisma.InputJsonValue,
      },
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
