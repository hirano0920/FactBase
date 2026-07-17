/**
 * TwoSides Radar 能動調査パイプライン（①バズ検知 → ②関連性判定 → ③能動調査）。
 *
 * 実行: npx tsx scripts/radar/discover.ts [--dry-run] [--force]
 * 本番 cron は discover → promote のみ（detect/summarize/followup は外している）。
 *
 * 設計思想: 固定RSSを待ち受ける受け身型ではなく、
 *   「ネットでバズった／継続的に話題なトピック」を起点に一次情報を能動的に調べにいく。
 *   ① 収集: Google Trends / Yahoo!リアルタイム / Yahoo!ニュースランキング / YouTubeトレンド
 *            + 継続的話題(sustained) + 新規法案
 *   ② 判定: mini が賛否を取れる火種候補を通し、ゴシップ等を捨て、表記ゆれを正規化
 *   ③ 調査: 上位トピックについて国会会議録・法令・関連ニュースを横断取得し証拠バンドル化
 * 成果物は TopicCandidate(discoverySource, evidenceJson, status=PENDING)。
 * evidenceJsonには証拠バンドルに加えbuzzScore/buzzSources/voteQuestion/voteChoicesも埋め込む
 * （promote.tsがピーク時間帯にこれを読んで Selection V2（Buzz'×Heat'）順に記事化する）。
 *
 * 実行タイミング: cron は15分間隔だが discover 本体は JST 1日7回(RADAR.discoverWindowsJst)のみ。
 * 各 promote ピークの約90分前＋昼後/夕方/夜の中間スイープで1日のバズを取りこぼさない。
 * 時間外は即 no-op（外部API・filterRelevantTopics/mini も呼ばない）。
 *
 * TrendSighting の書き込みは従来 detect.ts が担当していた。cron から外したため sustained は
 * 徐々に古くなる。4ソースのライブ取得は毎 discover で行うので主力検知は維持される。
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// tsx は .env.local を自動ロードしない（CI では secrets が既にあるので no-op）
(function loadLocalEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    try {
      process.loadEnvFile(path);
    } catch {
      /* Node が古い等 */
    }
  }
})();

import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { RADAR } from "../../src/lib/constants";
import { dedupKey, extractBillTitle, computeBuzzScore, buzzSourceLabels, buzzEffectiveScore, type BuzzSourceHit } from "../../src/lib/radar";
import { filterRelevantTopics } from "../../src/lib/ai";
import { getSustainedTerms } from "./lib/trend-sightings";
import {
  researchTopic,
  isEmptyEvidence,
  evaluateEvidenceSufficiency,
  evaluateBuzzPromoteSufficiency,
  createPollDetailCache,
  type EvidenceBundle,
} from "./lib/research";
import type { SavedEvidence } from "./lib/promote-logic";
import { isWithinPeakWindow, isOverdue } from "./lib/schedule";
import { fetchTrendingKeywords, fetchTrendingItems, type GoogleTrendItem } from "./sources/trends";
import { fetchYahooRealtimeBuzzPolitics } from "./sources/yahoo-realtime";
import {
  fetchYahooNewsRankingTitles,
  fetchYahooCommentRankingEntries,
  fetchYahooArticleCommentCount,
  type YahooRankingEntry,
} from "./sources/yahoo-news-ranking";
import {
  fetchYouTubeTrendingTitles,
  matchYouTubeEntry,
  fetchYouTubeReplyIntensity,
  type YouTubeVideoEntry,
} from "./sources/youtube-trending";
import { fetchRecentYahooPolls } from "./sources/yahoo-polls";
import { fetchShugiinBills, fetchSangiinBills } from "./sources/diet";
import { fetchTVNewsTitles } from "./sources/tv-news";
import { notifyRadarFailure } from "./notify";
import { prefilterBuzzInputs, type BuzzTermInput } from "../../src/lib/buzz-prefilter";
import { buildBuzzAnchorCandidates, assembleBuzzScore, buzzMatchesStrictTitleCorpus } from "../../src/lib/buzz-cross-match";
import { selectResearchTargets } from "./lib/discover-logic";
import { CONSENSUS_MIN_OUTLETS } from "./lib/promote-logic";
import { matchBroadcastArticle, mergeBroadcastMatch } from "./lib/match-broadcast";
import { matchYahooTweetCount } from "./lib/match-tweet-count";

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force"); // 起動時間帯チェックを無視（動作確認用）

/** 同一トピックをこの時間内に調査済みなら再調査しない（外部API・nanoコスト節約） */
const RERESEARCH_MIN_INTERVAL_HOURS = 12;

/**
 * トピックに対応するYahoo!コメントランキングの記事を探す（あれば個別ページのコメント数を
 * 取得し「炎上の強度」の絶対値・時系列差分を得る）。複数一致時は先頭（ランキング上位）を採用。
 */
function matchCommentRankingEntry(
  topic: string,
  entries: YahooRankingEntry[],
): YahooRankingEntry | null {
  return entries.find((e) => buzzMatchesStrictTitleCorpus(topic, [e.title])) ?? null;
}

interface TopicToResearch {
  topic: string;
  category: string;
  discoverySource: "buzz" | "bill";
  sustained: boolean;
  reason: string;
  question: string;
  choices: { for: string; against: string; undecided: string };
  /** Trends/Yahoo/Yahooニュース/YouTubeのクロス照合スコア（bill由来はundefined=対象外） */
  buzz?: BuzzSourceHit;
  /** Yahoo RT の tweetCount（X投稿量）。Selection V2 Heat' 用。突合できなければ undefined */
  tweetCount?: number;
  /** 突合できたYouTube動画の再生数・コメント数（「実際に見られている・議論になっている」の実測） */
  youtubeEntry?: YouTubeVideoEntry;
  /** detect.ts（RSS経路）が見送った候補を引き取って調査するもの（media consensus 経路で promote 可） */
  carriedOver?: boolean;
  /** 一次情報や対立する言い分を根拠に議論を組み立てられるか（filterRelevantTopicsの判定。法案/引き取りは常にtrue） */
  debatable: boolean;
  /** TwoSides 争点タイプ。本線6型以外は調査しても promote しない */
  debateType?: import("../../src/lib/debate-type").DebateType | null;
  /** policy のスローバーン再燃 */
  reignite?: boolean;
}

async function main() {
  console.log(`🔎 Radar discover 開始${DRY_RUN ? "（--dry-run: DB書き込みなし）" : ""}`);

  const inDiscoverWindow =
    FORCE || isWithinPeakWindow(new Date(), RADAR.discoverWindowsJst, RADAR.discoverWindowToleranceMin);

  if (!inDiscoverWindow) {
    // GitHub Actionsのcron遅延で全時間帯を外し続けるとdiscoverが完全に止まる事故が
    // 実際に起きた（6回連続スキップ・17時間超の停止）。時間帯を大きく外していても、
    // 最後の候補更新からRADAR.discoverOverdueHours以上経っていれば強制的に走らせる。
    const lastCandidate = await prisma.topicCandidate.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    });
    if (!isOverdue(lastCandidate?.updatedAt ?? null, RADAR.discoverOverdueHours)) {
      console.log("  discover 時間帯外のためスキップ（--forceで無視可）");
      return;
    }
    console.warn(
      `  ⚠️ 時間帯外だが最終更新から${RADAR.discoverOverdueHours}時間超過 → 停止防止のため強制実行`,
    );
  }

  const researchLimit = RADAR.researchTopicsPerRun;
  const billResearchLimit = RADAR.researchBillTopicsPerRun;

  // ① 収集 — バズ検知4ソース（政治・経済・国際・時事寄りは②のnanoが最終フィルタ）:
  //   Google Trends / Yahoo!リアルタイム / Yahoo!ニュースランキング / YouTube Data API
  //   YouTubeはタイトルだけでなくview/like/コメント数も取得し（videos.listのstatisticsは
  //   snippetと同時取得でも無料）、突合できた候補はevidence.youtubeViewCount/youtubeCommentCount
  //   として保存する（Heat'のsecondaryHeatにも合流。詳細はsources/youtube-trending.ts参照）。
  const [
    googleTerms,
    yahooBuzz,
    newsRankingTitles,
    commentRankingEntries,
    sustainedGoogle,
    sustainedYahoo,
    shugiin,
    sangiin,
  ] = await Promise.all([
    fetchTrendingKeywords(),
    fetchYahooRealtimeBuzzPolitics(),
    fetchYahooNewsRankingTitles(),
    fetchYahooCommentRankingEntries(),
    getSustainedTerms(prisma, "google_trends"),
    getSustainedTerms(prisma, "yahoo_realtime"),
    fetchShugiinBills(),
    fetchSangiinBills(),
  ]);
  const commentRankingTitles = commentRankingEntries.map((e) => e.title);

  const youtubeTrending = await fetchYouTubeTrendingTitles(newsRankingTitles);
  // discover候補の掘り起こしは「ニュース見出しシード検索」込みのallでよいが、
  // バズ横断スコア（cross-match）は自己参照を避けるためorganicだけを使う（下記buzzSourceInputs）。
  const youtubeTitles = youtubeTrending.all.map((e) => e.title);
  // Yahoo!「みんなの意見」新着一覧は1実行につき1回だけ取得し、③の調査対象トピック全件で使い回す
  // （researchTopicごとに一覧を叩き直すのは無駄打ち）。
  const yahooPolls = await fetchRecentYahooPolls();
  // テレビ各局ニュースは独立して取得（BuzzScore第5ソース）
  const tvNewsTitles = await fetchTVNewsTitles();

  // バズ検知5ソースが同時に全滅＝スクレイピング系の構造変化が疑われる（個々は静かに空配列へ落ちる）。
  if (
    googleTerms.length === 0 &&
    yahooBuzz.length === 0 &&
    newsRankingTitles.length === 0 &&
    youtubeTrending.organic.length === 0 &&
    tvNewsTitles.length === 0
  ) {
    await notifyRadarFailure(
      "バズ検知ソース全滅（discover）",
      "Google Trends / Yahoo!リアルタイム / Yahoo!ニュース / YouTube / TV各局 が同時に0件（スクレイピング構造変化の可能性）",
    );
  }

  const sustainedSet = new Set([...sustainedGoogle, ...sustainedYahoo]);

  const rawBuzzInputs: BuzzTermInput[] = [
    ...googleTerms.map((term) => ({ term, source: "trends" as const })),
    ...yahooBuzz.map((b) => ({ term: b.term, source: "yahoo_rt" as const, genre: b.genre })),
    ...newsRankingTitles.map((term) => ({ term, source: "yahoo_news" as const })),
    ...youtubeTitles.map((term) => ({ term, source: "youtube" as const })),
  ];
  const filteredInputs = prefilterBuzzInputs(rawBuzzInputs);
  const buzzSourceInputs = {
    googleTerms,
    yahooRealtimeTerms: yahooBuzz.map((b) => b.term),
    newsRankingTitles,
    // cross-match（横断バズ判定）はニュース見出しシード検索を含まないorganicのみを使う。
    // シード検索はクエリ自体がニュース見出し由来のため、allを使うと「Yahoo!ニュースに載っている」
    // ことと「YouTubeで独立にバズっている」ことを同じ1ソースで二重カウントしてしまう。
    youtubeTrendingTitles: youtubeTrending.organic.map((e) => e.title),
    commentRankingTitles,
    // テレビ各局ニュースはBuzzScore第5ソース。独立RSS取得なので他ソースと重複しない。
    tvNewsTitles,
  };
  const anchorCandidates = buildBuzzAnchorCandidates(filteredInputs, buzzSourceInputs);
  const score2Count = anchorCandidates.filter((c) => c.hit.effectiveScore >= 2).length;

  // nano には見出し・検索語の多様性を保つ（アンカーは横断スコア計算用。同一争点の重複見出しだけ除く）
  const buzzTerms = [...new Set(filteredInputs.map((i) => i.term.trim()).filter(Boolean))].sort((a, b) => {
    const scoreOf = (term: string) => {
      const linked = anchorCandidates.find(
        (c) => c.anchor === term || c.variants.includes(term) || term.includes(c.anchor),
      );
      return linked?.hit.effectiveScore ?? assembleBuzzScore(term, buzzSourceInputs).effectiveScore;
    };
    return scoreOf(b) - scoreOf(a) || a.localeCompare(b, "ja");
  });

  console.log(
    `  ① 収集: Trends${googleTerms.length}・Yahoo${yahooBuzz.length}・ニュース${newsRankingTitles.length}・コメント${commentRankingTitles.length}・YouTube${youtubeTitles.length}・TV${tvNewsTitles.length}=生${rawBuzzInputs.length}語 → 政治圏プリフィルタ後${filteredInputs.length}語（nano候補${buzzTerms.length}）・横断アンカー≥2: ${score2Count}件 / 継続${sustainedSet.size} / 法案${shugiin.length + sangiin.length}件`,
  );

  // ② 関連性判定（バズ語のみnanoに通す。法案は自明に関連なので直行）
  // nanoが落ちてもバズ語を諦めるだけで、法案トラッキング（③）は続行させる。
  let relevant: Awaited<ReturnType<typeof filterRelevantTopics>> = [];
  if (buzzTerms.length > 0) {
    try {
      relevant = await filterRelevantTopics(
        buzzTerms.map((term) => ({
          term,
          sustained: sustainedSet.has(term),
          discussed: buzzMatchesStrictTitleCorpus(term, commentRankingTitles),
        })),
      );
    } catch (e) {
      console.warn(`  ⚠️ ② 関連性判定nano失敗 — バズ語をスキップし法案のみ続行 (${e})`);
      await notifyRadarFailure("discover: 関連性判定nano失敗（法案のみ続行）", e);
    }
  }
  console.log(`  ② 関連性判定: ${buzzTerms.length}語 → 争点${relevant.length}件が通過`);
  if (buzzTerms.length > 0 && relevant.length === 0) {
    console.log(
      "  ⚠️ バズ語は集まったが政治争点0件 — nanoがW杯・芸能等を除外した可能性大。buzzのPENDINGは作られません",
    );
  }

  const billTitles = Array.from(
    new Set(
      [...shugiin, ...sangiin]
        .map((item) => extractBillTitle(item.title))
        .filter((t): t is string => t !== null),
    ),
  );

  // トピック統合（法案優先、続いて継続的話題→通常のバズ）
  const buzzTopics: TopicToResearch[] = relevant.map((r) => {
    const strictMatch = (topic: string, term: string) =>
      buzzMatchesStrictTitleCorpus(topic, [term]) || buzzMatchesStrictTitleCorpus(term, [topic]);
    const tweetCount = matchYahooTweetCount(r.topic, yahooBuzz, {
      matches: strictMatch,
    });
    const youtubeEntry = matchYouTubeEntry(r.topic, youtubeTrending.all, {
      matches: strictMatch,
    });
    return {
      topic: r.topic,
      category: r.category,
      discoverySource: "buzz" as const,
      sustained: sustainedSet.has(r.topic),
      reason: r.reason,
      question: r.question,
      choices: r.choices,
      buzz: computeBuzzScore(r.topic, buzzSourceInputs),
      tweetCount,
      youtubeEntry,
      debatable: r.debatable,
      debateType: r.debateType,
      reignite: r.reignite,
    };
  });
  const billTopics: TopicToResearch[] = billTitles.map((topic) => ({
    topic,
    category: "law",
    discoverySource: "bill",
    sustained: false,
    reason: "国会提出法案",
    // 法案はpromote.ts（バズ駆動記事）の対象外。既存detect.ts側で公開されるためquestion/choicesは不要
    question: "",
    choices: { for: "", against: "", undecided: "" },
    debatable: true,
    debateType: "policy" as const,
    reignite: false,
  }));

  // detect.ts（RSS経路）が「報道多数だが一次情報なし／バズ前」で見送った候補を引き取る（#2/#3の救済）。
  // 既存のバズ争点・法案と重複するものは除く（それらは通常経路で調査されるため）。
  const carriedOverTopics = await loadCarryOverTopics(
    new Set([...buzzTopics, ...billTopics].map((t) => dedupKey(t.topic))),
  );

  // ③ 能動調査 — バズは buzzScore 降順で枠を埋める。法案・引き取りは別枠（promote 対象外の枠を食わない）。
  const recentCache = new Map<string, boolean>();
  for (const t of [...buzzTopics, ...billTopics, ...carriedOverTopics]) {
    if (!recentCache.has(t.topic)) {
      recentCache.set(t.topic, !DRY_RUN && (await isRecentlyResearched(t.topic)));
    }
  }

  const { deepResearch: buzzBillTargets, buzzRefreshOnly: refreshedOnly } = selectResearchTargets(
    buzzTopics,
    billTopics,
    researchLimit,
    billResearchLimit,
    (topic) => recentCache.get(topic) ?? false,
  );

  // 引き取り候補は別枠（researchCarryOverPerRun）で、buzz/法案と重複しない分だけ追加調査する。
  const targetedKeys = new Set(buzzBillTargets.map((t) => dedupKey(t.topic)));
  const carryOverTargets: TopicToResearch[] = [];
  for (const t of carriedOverTopics) {
    if (carryOverTargets.length >= RADAR.researchCarryOverPerRun) break;
    const key = dedupKey(t.topic);
    if (targetedKeys.has(key) || recentCache.get(t.topic)) continue;
    targetedKeys.add(key);
    carryOverTargets.push(t);
  }
  const targets = [...buzzBillTargets, ...carryOverTargets];

  console.log(
    `  ③ 能動調査: ${targets.length}トピック（buzz≤${researchLimit}・法案≤${billResearchLimit}・引き取り${carryOverTargets.length}≤${RADAR.researchCarryOverPerRun}）・${refreshedOnly.length}件はbuzzScoreのみ更新`,
  );

  if (!DRY_RUN) {
    for (const t of refreshedOnly) await refreshBuzzScoreOnly(t);
  }

  const limits = {
    kokkaiRecords: RADAR.kokkaiRecords,
    lawRecords: RADAR.lawRecords,
    newsRecords: RADAR.newsRecords,
    internationalNewsRecords: RADAR.internationalNewsRecords,
  };

  // 調査（遅い外部API）は先に並列でまとめて実行し、DB書き込みは後段の短いループに固める。
  // 1件ずつ「調査→書き込み」を交互にやると外部取得中にDB接続が遊んでNeonに切断される(P1017)。
  // 同一ラン内で同じYahoo投票詳細を二重取得しない
  const pollDetailCache = createPollDetailCache();
  const researched = await Promise.all(
    targets.map(async (t) => {
      const evidence = await researchTopic(t.topic, limits, prisma, yahooPolls, pollDetailCache);
      // YouTubeバズ由来のトピックは、放送局公式サイトの記事があれば本文取得できるよう優先的に探して合流する
      if (t.buzz?.inYouTubeTrending) {
        const broadcastMatch = await matchBroadcastArticle(t.topic).catch(() => null);
        evidence.news = mergeBroadcastMatch(evidence.news, broadcastMatch);
      }
      const suff = evaluateEvidenceSufficiency(evidence);
      const promoteSuff = evaluateBuzzPromoteSufficiency(evidence);
      // ①社会炎上量の実測: コメントランキングに載っていれば個別記事ページの総コメント数を取得する
      const commentEntry = matchCommentRankingEntry(t.topic, commentRankingEntries);
      const commentCount = commentEntry
        ? await fetchYahooArticleCommentCount(commentEntry.url)
        : null;
      // 突合できたYouTube動画があれば、上位コメントへの返信数を合計する。
      // いいね数と違い「賛同されて終わる」のではなく実際に応酬（賛否のやり取り）が
      // 起きていることの実測シグナルになる（totalReplyCount）。
      const youtubeReplyCount = t.youtubeEntry
        ? await fetchYouTubeReplyIntensity(t.youtubeEntry.videoId)
        : undefined;
      const summary =
        `国会${evidence.dietSpeeches.length}/法令${evidence.laws.length}/国内報道${evidence.news.length}/海外報道${evidence.internationalNews.length}` +
        `(異なる媒体${suff.distinctNewsOutlets})/背景${evidence.background ? "○" : "×"}/官庁${evidence.officialEvents.length}` +
        `/buzzScore${t.buzz ? buzzEffectiveScore(t.buzz) : "n/a"}(raw${t.buzz?.score ?? "n/a"})/promote${promoteSuff.sufficient ? "可" : "不可"}` +
        `/コメント${commentCount ?? "n/a"}` +
        `/Yahoo意見${evidence.externalPoll ? `分断度${evidence.externalPoll.divisionScore.toFixed(2)}` : "n/a"}` +
        `/コメント摩擦度${typeof evidence.commentFrictionScore === "number" ? evidence.commentFrictionScore.toFixed(2) : "n/a"}` +
        `/YouTube${t.youtubeEntry ? `再生${t.youtubeEntry.viewCount}・コメ${t.youtubeEntry.commentCount}・返信${youtubeReplyCount ?? 0}` : "n/a"}`;
      const mark = isEmptyEvidence(evidence) ? "⚠️ 証拠なし" : promoteSuff.sufficient ? "✅" : suff.sufficient ? "△promote不可" : "△証拠薄い";
      console.log(`    ${mark} [${t.discoverySource}] ${t.topic} — ${summary}`);
      return { t, evidence, suff, commentCount, youtubeReplyCount };
    }),
  );

  if (DRY_RUN) {
    for (const { t, evidence } of researched) printEvidence(t, evidence);
  } else {
    for (const { t, evidence, suff, commentCount, youtubeReplyCount } of researched) {
      await upsertCandidate(t, evidence, suff, commentCount, youtubeReplyCount);
    }
  }

  console.log("🔎 Radar discover 完了");
}

/**
 * detect.ts（RSS経路）が見送った候補のうち「バズ前の重要報道」を discover が引き取る対象を返す。
 * 対象は「一次情報が無い(no_primary_source)」または「バズ経路へ譲った(defer_buzz_pipeline)」見送りで、
 * かつ複数媒体（distinctFeeds≥2）が既に報じているもの。人間確認必須（hard_block）・対象外却下は救済しない。
 * ここで返した候補は discoverySource="buzz" として調査され、強い媒体一致が確認できれば
 * media consensus 経路（promote-logic）でバズ前でも公開される。
 */
async function loadCarryOverTopics(excludeKeys: Set<string>): Promise<TopicToResearch[]> {
  const since = new Date(Date.now() - RADAR.carryOverLookbackHours * 60 * 60_000);
  const rows = await prisma.topicCandidate.findMany({
    where: {
      issueId: null,
      discoverySource: null, // RSS経路由来のみ（buzz/bill候補は通常経路で扱う）
      status: { in: ["HELD", "REJECTED"] },
      updatedAt: { gte: since },
      distinctFeeds: { gte: 2 },
    },
    orderBy: { updatedAt: "desc" },
    take: 40,
  });

  const out: TopicToResearch[] = [];
  for (const r of rows) {
    const d = r.decision ?? "";
    const eligible =
      (d.includes("no_primary_source") || d.includes("defer_buzz_pipeline")) &&
      !d.includes("hard_block") &&
      !d.includes("out_of_scope") &&
      !d.includes("admin_rejected");
    if (!eligible) continue;
    if (excludeKeys.has(dedupKey(r.title))) continue;
    out.push({
      topic: r.title,
      category: r.category || "politics",
      discoverySource: "buzz",
      sustained: false,
      reason: "報道多数・一次情報待ち（RSS経路から引き取り）",
      question: "",
      choices: { for: "", against: "", undecided: "" },
      carriedOver: true,
      debatable: true,
      // debateType は調査後の見出しで promote 側が機械推定（ここでは未確定のまま可）
      debateType: null,
      reignite: false,
    });
  }
  return out;
}

/** 同一トピックが直近 RERESEARCH_MIN_INTERVAL_HOURS 以内に調査済み（evidenceあり）か */
async function isRecentlyResearched(topic: string): Promise<boolean> {
  const existing = await prisma.topicCandidate.findUnique({ where: { dedupKey: dedupKey(topic) } });
  if (!existing || !existing.evidenceJson) return false;
  const ageMs = Date.now() - existing.updatedAt.getTime();
  return ageMs < RERESEARCH_MIN_INTERVAL_HOURS * 60 * 60_000;
}

/**
 * 高コストな証拠の再取得（国会・法令・ニュース等）はしないが、まだ今回もトレンド中と
 * 確認できたトピックについてbuzzScoreだけ最新値に更新する。既存の証拠（news/laws/dietSpeeches等）
 * はそのまま保持し、buzzScore/buzzSources/updatedAtだけ書き換える安価な更新。
 */
async function refreshBuzzScoreOnly(t: TopicToResearch): Promise<void> {
  const key = dedupKey(t.topic);
  const existing = await prisma.topicCandidate.findUnique({ where: { dedupKey: key } });
  if (!existing || !existing.evidenceJson || existing.status !== "PENDING") return;

  const prevEvidence = existing.evidenceJson as unknown as SavedEvidence;
  const savedEvidence: SavedEvidence = {
    ...prevEvidence,
    buzzScore: t.buzz ? buzzEffectiveScore(t.buzz) : undefined,
    buzzSources: t.buzz ? buzzSourceLabels(t.buzz) : undefined,
    tweetCount: t.tweetCount ?? prevEvidence.tweetCount,
    youtubeViewCount: t.youtubeEntry?.viewCount ?? prevEvidence.youtubeViewCount,
    youtubeLikeCount: t.youtubeEntry?.likeCount ?? prevEvidence.youtubeLikeCount,
    youtubeCommentCount: t.youtubeEntry?.commentCount ?? prevEvidence.youtubeCommentCount,
  };
  await prisma.topicCandidate.update({
    where: { id: existing.id },
    data: {
      evidenceJson: savedEvidence as unknown as Prisma.InputJsonValue,
      decision: `${existing.decision ?? ""} / buzzScore refresh=${t.buzz ? buzzEffectiveScore(t.buzz) : "n/a"}`,
    },
  });
  console.log(`  🔄 buzzScore更新のみ: ${t.topic} → ${t.buzz ? buzzEffectiveScore(t.buzz) : "n/a"}`);
}

async function upsertCandidate(
  t: TopicToResearch,
  evidence: EvidenceBundle,
  suff: ReturnType<typeof evaluateEvidenceSufficiency>,
  commentCount?: number | null,
  youtubeReplyCount?: number,
): Promise<void> {
  const key = dedupKey(t.topic);
  // 関連ニュース（国内+海外）を既存機構が読める sourceUrls 形式に変換（{title,url,feed}）。
  // 記事生成（generateArticle）はこのsourceUrlsをsourcesとして受け取るため、
  // ここで国内外を合流させておかないと「海外メディアの報道」が記事に反映されない。
  const sourceUrls = [...evidence.news, ...evidence.internationalNews].map((n) => ({
    title: n.title,
    url: n.url,
    feed: n.source || "google-news",
    publishedAt: n.pubDate || undefined,
  }));
  const existing = await prisma.topicCandidate.findUnique({
    where: { dedupKey: key },
    select: { status: true, evidenceJson: true },
  });
  const prevCommentCount = (existing?.evidenceJson as unknown as SavedEvidence | null)?.commentCount;
  // コメント数が短時間で急増＝炎上が加速中の実測シグナル（絶対値だけでは「元から人気の話題」と区別できない）
  const commentCountSurge =
    typeof commentCount === "number" &&
    typeof prevCommentCount === "number" &&
    commentCount - prevCommentCount >= RADAR.commentCountSurgeThreshold;

  const decision =
    `discover/${t.discoverySource}: ${t.reason} ` +
    `(${evidence.dietSpeeches.length}国会/${evidence.laws.length}法令/${evidence.news.length}国内報道/${evidence.internationalNews.length}海外報道/` +
    `異なる媒体${suff.distinctNewsOutlets}/背景${evidence.background ? "○" : "×"}) ` +
    `buzzScore=${t.buzz ? buzzEffectiveScore(t.buzz) : "n/a"} sufficient=${suff.sufficient}` +
    `${typeof commentCount === "number" ? ` commentCount=${commentCount}${commentCountSurge ? "(急増)" : ""}` : ""}`;

  const savedEvidence: SavedEvidence = {
    ...evidence,
    buzzScore: t.buzz ? buzzEffectiveScore(t.buzz) : undefined,
    buzzSources: t.buzz ? buzzSourceLabels(t.buzz) : undefined,
    voteQuestion: t.question || undefined,
    voteChoices: t.choices.for ? t.choices : undefined,
    // 引き取り候補で強い媒体一致が確認できれば media consensus 経路で promote 可にする
    mediaConsensus:
      t.carriedOver && suff.distinctNewsOutlets >= CONSENSUS_MIN_OUTLETS ? true : undefined,
    debatable: t.debatable,
    debateType: t.debateType ?? undefined,
    reignite: t.reignite || undefined,
    sustained: t.sustained || undefined,
    commentCount: typeof commentCount === "number" ? commentCount : prevCommentCount,
    commentCountSurge: commentCountSurge || undefined,
    tweetCount: t.tweetCount,
    youtubeViewCount: t.youtubeEntry?.viewCount,
    youtubeLikeCount: t.youtubeEntry?.likeCount,
    youtubeCommentCount: t.youtubeEntry?.commentCount,
    youtubeReplyCount,
    // ClickHeat' 用: Google Trends 検索トラフィック + ニュースクラスタ数
    googleTrendTraffic: t.buzz?.maxTrendTraffic,
    newsClusterCount: t.buzz?.newsClusterCount,
  };

  const data = {
    title: t.topic,
    category: t.category || null,
    discoverySource: t.discoverySource,
    topicTerm: t.topic,
    evidenceJson: savedEvidence as unknown as Prisma.InputJsonValue,
    sourceUrls: sourceUrls as unknown as Prisma.InputJsonValue,
    decision,
    // ④状態判定・⑤記事生成が後続で消費するため PENDING のまま置く
    status: "PENDING" as const,
  };

  await prisma.topicCandidate.upsert({
    where: { dedupKey: key },
    create: { dedupKey: key, ...data },
    // 既存候補（RSSクラスタ由来含む）に証拠を上書き付与。
    // buzz 経路は promote が PENDING を読むため、未公開なら status も PENDING に戻す。
    update: {
      discoverySource: t.discoverySource,
      topicTerm: t.topic,
      evidenceJson: data.evidenceJson,
      sourceUrls: data.sourceUrls,
      decision,
      category: data.category,
      ...(t.discoverySource === "buzz" && existing?.status !== "PUBLISHED"
        ? { status: "PENDING" as const, issueId: null }
        : {}),
    },
  });
}

function printEvidence(t: TopicToResearch, e: EvidenceBundle): void {
  console.log(`\n────────── ${t.topic}（${t.discoverySource}/${t.category}）──────────`);
  console.log(`理由: ${t.reason}`);
  if (e.dietSpeeches.length > 0) {
    console.log("  【国会会議録】");
    for (const s of e.dietSpeeches.slice(0, 3))
      console.log(`   - ${s.date} ${s.house}${s.meeting} ${s.speaker}: ${s.snippet.slice(0, 50)}…`);
  }
  if (e.laws.length > 0) {
    console.log("  【関連法令】");
    for (const l of e.laws) console.log(`   - ${l.lawTitle}（${l.lawNum}）${l.repealStatus || ""}`);
  }
  if (e.news.length > 0) {
    console.log("  【国内報道】");
    for (const n of e.news.slice(0, 5)) console.log(`   - [${n.source}] ${n.title}`);
  }
  if (e.internationalNews.length > 0) {
    console.log("  【海外/英字メディア報道】");
    for (const n of e.internationalNews.slice(0, 5)) console.log(`   - [${n.source}] ${n.title}`);
  }
  if (e.background) {
    console.log("  【背景解説（Wikipedia）】");
    console.log(`   - ${e.background.title}: ${e.background.extract.slice(0, 80)}…`);
  }
  if (e.officialEvents.length > 0) {
    console.log("  【官庁一次情報（既存RSS収集分）】");
    for (const o of e.officialEvents) console.log(`   - [${o.feed}] ${o.title}`);
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await notifyRadarFailure("discover.ts 致命的エラー（ジョブ全体が停止）", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
