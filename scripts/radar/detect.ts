/**
 * FactBase Radar — 検知・分類・スコアリング・自動公開（Level 1速報スレ）。
 *
 * 実行: npx tsx scripts/radar/detect.ts
 * 設計原則:
 *   - ニュース見出しは「話題検知シグナル」。記事本文は取得も保存もしない
 *   - nano呼び出しは1実行あたり最大1回（新着見出しのクラスタリング）
 *   - 公開判断は decidePublish（ハードブロック > 複数媒体一致 > スコア閾値 > 日次上限）
 *   - 速報スレの本文はテンプレート生成（AIに自由記述させない＝出鱈目要約の構造的排除）
 *   - 候補は一発判定ではなく累積判定: 未公開候補（HELD/スコア不足REJECTED）には
 *     新しい証拠をマージして再判定する。国会審議のようなスローバーン型と、
 *     日次上限後に来た重要トピックの翌日復活の両方をこれで拾う
 *   - 累積判定の同一性はnanoのmatch_candidate_id（+機械裏取り）で行い、dedupKeyの
 *     文字列一致だけには頼らない。nanoは実行のたびにcluster.titleの言い回しを変えうるため、
 *     文字列一致だけだと同じ出来事でも別候補として重複登録され証拠が積み上がらない
 *   - バズシグナル（Google Trends急上昇・はてブ人気エントリ）は優先順位付けのみに使い、
 *     安全ゲート（複数媒体一致・一次情報要求）は一切バイパスしない
 *   - 議案フィードのステータス変化はnanoを介さずIssue.keywordsと直接照合し、
 *     審議進捗（委員会可決→本会議可決→成立）を確実にタイムライン追記する
 */
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient, type IssueCategory, type Prisma } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import {
  classifyHeadlines,
  type RadarCluster,
  type ActiveIssueForMatch,
  type PendingCandidateForMatch,
} from "../../src/lib/ai";
import {
  decidePublish,
  dedupKey,
  clusterCoherence,
  COHERENCE_THRESHOLD,
  isOutOfScopeTopic,
  isBreakingNews,
  isPlausibleFollowUp,
  hotScore,
  riskScore,
  matchesTrending,
  buzzTitleMatch,
  extractBillTitle,
} from "../../src/lib/radar";
import { RADAR } from "../../src/lib/constants";
import type { FeedItem } from "./sources/common";
import { fetchCourtsNews, fetchCourtsKijitsu } from "./sources/courts";
import { fetchShugiinBills, fetchSangiinBills } from "./sources/diet";
import { fetchTrendingKeywords } from "./sources/trends";
import { fetchHotentryTitles } from "./sources/buzz";
import { notifyRadarFailure } from "./notify";
import { notifyRevalidate } from "./lib/notify-revalidate";

const prisma = new PrismaClient();

interface FeedConfig {
  name: string;
  url: string;
  trust: number;
}

const parser = new XMLParser({ ignoreAttributes: false });

async function fetchFeed(feed: FeedConfig): Promise<FeedItem[]> {
  try {
    // 米国務省・一部省庁は素のbot UA を拒否するため compatible 形式にする（+https://factbase.tokyo で識別可能）
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FactBaseRadar/1.0; +https://factbase.tokyo)",
        Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml, */*;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = parser.parse(await res.text());

    // RSS2.0 / RDF / Atom を吸収
    const rawItems =
      xml?.rss?.channel?.item ?? xml?.["rdf:RDF"]?.item ?? xml?.feed?.entry ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items
      .map((item: Record<string, unknown>): FeedItem | null => {
        const title = String(item.title ?? "").trim();
        const link =
          typeof item.link === "string"
            ? item.link
            : String((item.link as Record<string, unknown>)?.["@_href"] ?? "");
        const pub = String(item.pubDate ?? item["dc:date"] ?? item.updated ?? "");
        if (!title || !link) return null;
        const publishedAt = pub ? new Date(pub) : new Date();
        return {
          feedName: feed.name,
          trust: feed.trust,
          title: title.slice(0, 300),
          url: link.slice(0, 1000),
          publishedAt: isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
        };
      })
      .filter((x): x is FeedItem => x !== null)
      .slice(0, 30);
  } catch (e) {
    console.warn(`  ⚠️ ${feed.name}: 取得失敗 (${e})`);
    return [];
  }
}

function itemHash(item: FeedItem): string {
  return createHash("sha256").update(`${item.feedName}:${item.title}`).digest("hex");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** classifyHeadlines失敗時は最大2回まで指数バックオフで再試行。全滅してもジョブは落とさずスキップする */
async function classifyWithRetry(
  headlines: { index: number; feed: string; title: string }[],
  activeIssues: ActiveIssueForMatch[],
  pendingCandidates: PendingCandidateForMatch[],
  retries = 2,
): Promise<RadarCluster[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await classifyHeadlines(headlines, activeIssues, pendingCandidates);
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        const delayMs = 2000 * 3 ** attempt;
        console.warn(
          `  ⚠️ classifyHeadlines失敗（${attempt + 1}/${retries + 1}回目）: ${e} — ${delayMs}ms後に再試行`,
        );
        await sleep(delayMs);
      }
    }
  }
  console.error(`  ❌ classifyHeadlines 全${retries + 1}回失敗 — 今回はクラスタリングをスキップ（次回cronで再試行）`);
  await notifyRadarFailure("classifyHeadlines 全リトライ失敗", lastError);
  return [];
}

function toIssueCategory(category: string): IssueCategory {
  const map: Record<string, IssueCategory> = {
    politics: "POLITICS",
    economy: "ECONOMY",
    law: "LAW",
    finance: "FINANCE",
    education: "EDUCATION",
    rights: "POLITICS",
    international: "POLITICS",
  };
  return map[category] ?? "POLITICS";
}

/** 速報スレのsummaryJson（テンプレート生成・AIの自由記述なし） */
function level1Summary(
  cluster: RadarCluster,
  sources: { title: string; url: string; feed: string }[],
  mode: "official" | "breaking",
) {
  if (mode === "official") {
    return {
      lead: `「${cluster.title}」に関する公式発表・一次情報が確認されています。詳細まとめを準備中です。`,
      bullets: [
        `確認できること: ${sources.length}件の公式発表・報道（下記出典）`,
        "一次情報に基づく詳細まとめを自動生成中（10〜30分）",
        "続報・関連動向はタイムラインで更新されます",
      ],
      sources: sources.slice(0, 5).map((s) => ({ label: `${s.title.slice(0, 40)}（${s.feed}）`, url: s.url })),
    };
  }
  return {
    lead: `「${cluster.title}」に関する速報が複数媒体で確認されています。事態は発展中の可能性があり、続報をタイムラインで追います。`,
    bullets: [
      `確認できること: ${sources.length}件の報道が存在（下記出典）`,
      "確認中: 公式声明・当事者の反応・被害規模など（続報待ち）",
      "🔴 LIVE — 新しい報道・声明はタイムラインに随時追加されます",
    ],
    sources: sources.slice(0, 5).map((s) => ({ label: `${s.title.slice(0, 40)}（${s.feed}）`, url: s.url })),
  };
}

interface SourceRef {
  title: string;
  url: string;
  feed: string;
}

/**
 * 既存候補を「生きたレコード」として再判定してよいか。
 * 一発判定だと (a) 日次上限でHELDになった大ニュースが翌日以降永久に埋もれる
 * (b) 国会審議のように数日かけて媒体数が増えるスローバーン型を拾えない、の2つの穴があるため、
 * 未公開の候補には新しい証拠をマージして decidePublish をやり直す。
 * ただし人間確認が必須のもの（ハードブロック・管理者却下）と対象外却下は復活させない。
 */
function isRevivableCandidate(c: {
  status: string;
  issueId: string | null;
  decision: string | null;
}): boolean {
  if (c.issueId || c.status === "PUBLISHED") return false;
  const d = c.decision ?? "";
  if (d.includes("hard_block") || d.includes("out_of_scope") || d.includes("admin_rejected")) {
    return false;
  }
  return c.status === "HELD" || c.status === "REJECTED";
}

/** 既存候補のソースと今回の新規ソースをURL重複排除でマージ（新しいものを末尾に、上限あり） */
function mergeSources(prev: SourceRef[], next: SourceRef[]): SourceRef[] {
  const seen = new Set(prev.map((s) => s.url));
  return [...prev, ...next.filter((s) => !seen.has(s.url))].slice(-RADAR.sourceCap);
}

/** 政治・経済・法令系をnano分類の先頭に回す（NHK総合・W杯等に埋もれないように） */
const CLASSIFY_PRIORITY_FEED =
  /^(kantei|cao|digital|boj-|mof|fsa|moj-|mhlw|mlit-|maff|mod-|mofa-|fed-|ecb-|courts|shugiin|sangiin|gnews-politics|gnews-diet|gnews-economy|gnews-fiscal|gnews-law|gnews-rights|gnews-international|gnews-immigration|gnews-war|gnews-en-|nhk-politics|nhk-economy|nhk-international|bloomberg|whitehouse|state-|defense-gov|bbc-world|bbc-middle-east|aljazeera|guardian-world)/;

function selectForClassification<T extends { id: string; feedName: string; trustWeight: number; publishedAt: Date }>(
  events: T[],
  limit = 80,
): T[] {
  const official = events.filter((e) => e.trustWeight >= 85);
  const priority = events.filter(
    (e) => CLASSIFY_PRIORITY_FEED.test(e.feedName) && !official.some((o) => o.id === e.id),
  );
  const rest = events.filter(
    (e) => !official.some((o) => o.id === e.id) && !priority.some((p) => p.id === e.id),
  );
  const sortByDate = (a: T, b: T) => b.publishedAt.getTime() - a.publishedAt.getTime();
  const merged = [
    ...official.sort(sortByDate),
    ...priority.sort(sortByDate),
    ...rest.sort(sortByDate),
  ];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of merged) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

async function main() {
  const config = JSON.parse(
    readFileSync(new URL("./feeds.json", import.meta.url), "utf-8"),
  ) as { feeds: FeedConfig[] };

  // 1. 全フィード取得 → 新規イベントだけ保存
  // RSS(feeds.json)に加え、公式RSSがない裁判所・衆参両院はHTML差分/SMRI議案DBで補う。
  // どちらも同じFeedItem形式で返し、既存のfeedName+titleハッシュ重複排除にそのまま乗る。
  console.log("1/4 フィード取得…");
  const runStarted = new Date();
  const [rssItems, courtsNews, courtsKijitsu, shugiin, sangiin, trendingKeywords, hotentryTitles] =
    await Promise.all([
      Promise.all(config.feeds.map(fetchFeed)).then((r) => r.flat()),
      fetchCourtsNews(),
      fetchCourtsKijitsu(),
      fetchShugiinBills(),
      fetchSangiinBills(),
      fetchTrendingKeywords(),
      fetchHotentryTitles(),
    ]);
  const allItems: FeedItem[] = [...rssItems, ...courtsNews, ...courtsKijitsu, ...shugiin, ...sangiin];

  // 67フィード中0件は通常運用ではまず起きない（fetchFeedは個別失敗を握りつぶす設計なので、
  // これが起きるということは広範な障害＝DNS/ネットワーク遮断等が疑われる）
  if (rssItems.length === 0 && config.feeds.length > 0) {
    await notifyRadarFailure(
      "RSSフィード全滅",
      `${config.feeds.length}件中0件取得（ネットワーク障害の可能性）`,
    );
  }

  const result = await prisma.sourceEvent.createMany({
    data: allItems.map((item) => ({
      feedName: item.feedName,
      trustWeight: item.trust,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      hash: itemHash(item),
    })),
    skipDuplicates: true,
  });
  console.log(`  ${allItems.length}件取得 / 新規${result.count}件`);

  // 古いイベントの掃除（Layer 2は短期保持）
  await prisma.sourceEvent.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - RADAR.eventRetentionDays * 86400_000) } },
  });

  if (result.count === 0) {
    console.log("新着なし — nano呼び出しもなし（この実行のコスト: ¥0）");
    return;
  }

  // 今回新規分だけを分類（初回の国会一括取り込み等で6h窓が数千件になるのを防ぐ）
  console.log("2/4 クラスタリング（nano 1回）…");
  const recentRaw = await prisma.sourceEvent.findMany({
    where: { createdAt: { gte: runStarted } },
    orderBy: { publishedAt: "desc" },
    take: 200,
  });
  const selected = selectForClassification(recentRaw);
  if (selected.length === 0) {
    console.log("  今回の新規イベントなし — スキップ");
    return;
  }

  // 続報マッチング候補: 監視期限内でまだアクティブな公開済みIssue（新規クラスタ化のスキップ判定に使う）
  const activeIssuesRaw = await prisma.issue.findMany({
    where: {
      status: { in: ["ACTIVE", "TRENDING"] },
      confirmation: { in: ["OFFICIAL", "REPORTED"] },
      monitoringUntil: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: RADAR.followUpMaxActiveIssuesForMatch,
    select: { id: true, slug: true, title: true, keywords: true },
  });
  const activeIssueIds = new Set(activeIssuesRaw.map((i) => i.id));

  // 2a. 議案ステータス変化の直接トラッキング（nano不要・確実）
  // 議案フィードのタイトルには法案名が「」で埋め込まれているので、公開中Issueの
  // keywords（法案名を保存済み）と機械照合し、一致したらタイムラインへ即追記する。
  // nanoのクラスタリングを介さないため、審議進捗（委員会可決→本会議可決→成立）を取り逃さない。
  const directlyLinked = new Set<string>();
  for (const ev of selected) {
    if (ev.feedName !== "shugiin-gian" && ev.feedName !== "sangiin-gian") continue;
    const billTitle = extractBillTitle(ev.title);
    if (!billTitle) continue;
    const issue = activeIssuesRaw.find(
      (i) => i.keywords.some((kw) => kw.length >= 4 && (kw === billTitle || kw.includes(billTitle) || billTitle.includes(kw))) ||
        i.title.includes(billTitle),
    );
    if (!issue) continue;

    const statusPart = ev.title.split("→").pop()?.trim() ?? "";
    await prisma.$transaction([
      prisma.sourceEvent.update({ where: { id: ev.id }, data: { issueId: issue.id } }),
      prisma.issueTimeline.create({
        data: {
          issueId: issue.id,
          label: `🏛️ 審議状況: ${(statusPart || billTitle).slice(0, 60)}`,
          sourceUrl: ev.url,
        },
      }),
    ]);
    await notifyRevalidate(issue.slug, issue.id);
    directlyLinked.add(ev.id);
    console.log(`  📜 [議案進捗] ${issue.title} ← ${statusPart || ev.title.slice(0, 40)}`);
  }

  const recent = selected.filter((e) => !directlyLinked.has(e.id));
  if (recent.length === 0) {
    console.log("  分類対象なし（議案進捗のみ） — nano呼び出しスキップ");
    return;
  }
  console.log(`  分類対象 ${recent.length}件（今回の新規のみ）`);

  // 累積判定のマッチ対象: まだ公開されていないHELD/REJECTED候補。
  // nanoは実行のたびにcluster.titleの言い回しを変えることがあり、dedupKeyの文字列一致だけに
  // 頼ると同じ出来事の証拠が積み上がらない（スローバーン型の法案審議等で顕著）。
  // 既存Issueへの続報判定(match_issue_id)と同じ仕組みを未公開候補にも適用し、
  // 意味的に同一と判断できればidで直接紐付ける。
  const pendingCandidatesRaw = await prisma.topicCandidate.findMany({
    where: { issueId: null, status: { in: ["HELD", "REJECTED"] } },
    orderBy: { updatedAt: "desc" },
    take: RADAR.followUpMaxActiveIssuesForMatch,
  });
  const pendingCandidates = pendingCandidatesRaw.filter(isRevivableCandidate);
  const pendingCandidateMap = new Map(pendingCandidates.map((c) => [c.id, c]));

  const clusters = await classifyWithRetry(
    recent.map((e, i) => ({ index: i, feed: e.feedName, title: e.title })),
    activeIssuesRaw,
    pendingCandidates.map((c) => ({ id: c.id, title: c.title })),
  );
  console.log(`  ${clusters.length}クラスタ検出`);

  // 3. スコアリング → 公開判断
  console.log("3/4 スコアリング・公開判断…");
  // 候補の累積再判定（昨日の候補が今日公開されるケース）があるため、
  // 候補のcreatedAtではなく「今日実際に公開されたIssue数」を上限の分母にする
  const publishedToday = await prisma.issue.count({
    where: {
      confirmation: { in: ["OFFICIAL", "REPORTED"] },
      createdAt: { gte: new Date(new Date().toISOString().slice(0, 10)) },
    },
  });
  const dailyLimit = Number(process.env.RADAR_AUTO_PUBLISH_PER_DAY ?? RADAR.autoPublishPerDay);
  let publishedThisRun = 0;

  // バズ（Google Trends=検索急増・はてブ=SNS継続関心）で話題性を判定し、
  // 話題性の高いクラスタから日次上限を消費させる
  // （鈍い話題が先に枠を埋めてバズっている話題が見送りになるのを防ぐ）
  const prioritized = clusters
    .map((cluster) => {
      const members = cluster.member_indices
        .filter((i) => i >= 0 && i < recent.length)
        .map((i) => recent[i]);
      if (members.length === 0) return null;
      const titles = [cluster.title, ...members.map((m) => m.title)];
      const trending = matchesTrending(titles, trendingKeywords);
      const socialBuzz = buzzTitleMatch(titles, hotentryTitles);
      const priority = hotScore({
        eventCount: members.length,
        distinctFeeds: new Set(members.map((m) => m.feedName)).size,
        minutesSinceLatest: Math.floor(
          (Date.now() - Math.max(...members.map((m) => m.publishedAt.getTime()))) / 60_000,
        ),
        maxTrustWeight: Math.max(...members.map((m) => m.trustWeight)),
        riskFlags: cluster.risk_flags ?? [],
        trending,
        socialBuzz,
      });
      return { cluster, members, trending, socialBuzz, priority };
    })
    .filter(
      (
        x,
      ): x is {
        cluster: RadarCluster;
        members: (typeof recent)[number][];
        trending: boolean;
        socialBuzz: boolean;
        priority: number;
      } => x !== null,
    )
    .sort((a, b) => b.priority - a.priority);

  for (const { cluster, members, trending, socialBuzz } of prioritized) {

    // AIが既存の公開済みIssueの続報だと判定した場合: 新規クラスタ化せず、
    // 該当SourceEventを紐付けてタイムラインに1行追記するだけに留める（軽量・即時）。
    // 記事本文の再生成は followup.ts が頻度制御込みで別途担当する。
    if (cluster.match_issue_id && activeIssueIds.has(cluster.match_issue_id)) {
      const matchedIssue = activeIssuesRaw.find((i) => i.id === cluster.match_issue_id);
      const memberTitles = members.map((m) => m.title);
      // nanoのマッチ判定は機械裏取りしてから信用する（誤マッチによるタイムライン汚染防止）。
      // 裏取りに落ちたクラスタは続報扱いせず、下の新規クラスタ処理に流す。
      if (matchedIssue && isPlausibleFollowUp(cluster.title, memberTitles, matchedIssue)) {
        const matchedIssueId = matchedIssue.id;
        await prisma.sourceEvent.updateMany({
          where: { id: { in: members.map((m) => m.id) } },
          data: { issueId: matchedIssueId },
        });
        // 公式ソース（省庁・国会等 trust>=85）由来の続報は目立たせる。
        // タイムラインUIはlabelをそのまま表示するのでプレフィックスだけで強調が効く
        const officialMembers = members.filter((m) => m.trustWeight >= 85);
        const highlight = officialMembers.length > 0;
        const linkSource = (highlight ? officialMembers : members).reduce((a, b) =>
          a.publishedAt > b.publishedAt ? a : b,
        );
        await prisma.issueTimeline.create({
          data: {
            issueId: matchedIssueId,
            label: `${highlight ? "🏛️ 公式発表: " : "続報: "}${cluster.title.slice(0, 60)}`,
            sourceUrl: linkSource.url,
          },
        });
        await notifyRevalidate(matchedIssue.slug, matchedIssueId);
        console.log(`  🔗 [続報${highlight ? "/公式" : ""}] ${matchedIssue.title} ← ${cluster.title}`);
        continue;
      }
      console.log(`  ⚠️ [続報マッチ棄却] ${cluster.title} — 裏取り類似度不足のため新規扱い`);
    }

    // nanoが未公開候補と同一の出来事だと判定した場合はidで直接紐付ける（dedupKeyの文字列一致に
    // 依存しない）。機械裏取り（isPlausibleFollowUp）に落ちたら通常のdedupKey照合にフォールバック
    let matchedCandidate = cluster.match_candidate_id
      ? (pendingCandidateMap.get(cluster.match_candidate_id) ?? null)
      : null;
    if (
      matchedCandidate &&
      !isPlausibleFollowUp(cluster.title, members.map((m) => m.title), {
        title: matchedCandidate.title,
        keywords: [],
      })
    ) {
      console.log(`  ⚠️ [候補マッチ棄却] ${cluster.title} — 裏取り類似度不足のため新規扱い`);
      matchedCandidate = null;
    }

    const key = dedupKey(cluster.title);
    const exists = matchedCandidate ?? (await prisma.topicCandidate.findUnique({ where: { dedupKey: key } }));
    // 公開済み・人間確認必須・対象外却下は再処理しない（続報はfollowup.ts/上の続報マッチの担当）
    if (exists && !isRevivableCandidate(exists)) continue;

    if (isOutOfScopeTopic(cluster.title, members.map((m) => m.title))) {
      console.log(`  [reject/out_of_scope] ${cluster.title} — スポーツ・エンタメ等`);
      continue;
    }

    // 既存の未公開候補があれば証拠をマージ（累積判定）。
    // 国会審議のように数日かけて媒体が増える話題は、ここで媒体数・イベント数が積み上がり
    // いずれ閾値を超えて公開される。日次上限でHELDになった候補も翌日ここで復活できる。
    const newSources = members.map((m) => ({ title: m.title, url: m.url, feed: m.feedName }));
    const prevSources = exists ? ((exists.sourceUrls as unknown as SourceRef[]) ?? []) : [];
    const sources = mergeSources(prevSources, newSources);

    // nanoのクラスタリングが無関係な見出しを誤って束ねていないか機械的に再検証する。
    // 一貫性が低ければ「実際は単一ソースの誤報」とみなし、distinctFeedsを1に強制して
    // decidePublishのsingle_sourceゲートに必ず引っかかるようにする（誤報の自動公開防止）。
    // 累積候補はマージ後の全タイトルで判定（別の出来事が混ざった汚染マージも検出できる）。
    const coherence = clusterCoherence(sources.map((s) => s.title));
    const coherent = coherence >= COHERENCE_THRESHOLD;
    const distinctFeeds = coherent ? new Set(sources.map((s) => s.feed)).size : 1;

    const input = {
      eventCount: sources.length,
      distinctFeeds,
      minutesSinceLatest: Math.floor(
        (Date.now() - Math.max(...members.map((m) => m.publishedAt.getTime()))) / 60_000,
      ),
      maxTrustWeight: Math.max(exists?.trustScore ?? 0, ...members.map((m) => m.trustWeight)),
      riskFlags: cluster.risk_flags ?? [],
      classification: cluster.classification,
      publishedToday: publishedToday + publishedThisRun,
      dailyLimit,
      feedNames: sources.map((s) => s.feed),
      clusterTitle: cluster.title,
      memberTitles: members.map((m) => m.title),
      trending,
      socialBuzz,
    };
    const decision = decidePublish(input);
    if (!coherent) {
      console.log(
        `  [low_coherence=${coherence.toFixed(2)}] ${cluster.title} — distinctFeedsを1に強制`,
      );
    }

    const decisionLog = `${decision.action}: ${decision.reason} coherence=${coherence.toFixed(2)}${trending ? " trending" : ""}${socialBuzz ? " social_buzz" : ""}`;
    const candidateData = {
      title: cluster.title,
      category: cluster.category,
      classification: cluster.classification,
      eventCount: input.eventCount,
      distinctFeeds: input.distinctFeeds,
      hotScore: hotScore(input),
      trustScore: input.maxTrustWeight,
      riskScore: riskScore(input),
      riskFlags: input.riskFlags,
      decision: exists ? `${decisionLog} (再判定/前回:${exists.status})` : decisionLog,
      status: (decision.action === "publish"
        ? "PUBLISHED"
        : decision.action === "hold"
          ? "HELD"
          : "REJECTED") as "PUBLISHED" | "HELD" | "REJECTED",
      sourceUrls: sources as unknown as Prisma.InputJsonValue,
    };
    const candidate = exists
      ? await prisma.topicCandidate.update({ where: { id: exists.id }, data: candidateData })
      : await prisma.topicCandidate.create({ data: { dedupKey: key, ...candidateData } });

    if (decision.action !== "publish") {
      console.log(`  [${decision.action}] ${cluster.title} (${decision.reason})`);
      continue;
    }

    // 4. Level 1速報スレを自動公開
    const slug = `radar-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const breaking = isBreakingNews(input);
    const summaryMode = decision.confirmation === "OFFICIAL" ? "official" : "breaking";
    const monitoringDays = breaking ? 7 : 60;
    // 議案フィード由来の法案名をkeywordsに保存 → 以後の審議状況変化は
    // ステップ2aの直接トラッキングがnano抜きでタイムラインに追記できる
    const billTitles = members
      .filter((m) => m.feedName === "shugiin-gian" || m.feedName === "sangiin-gian")
      .map((m) => extractBillTitle(m.title))
      .filter((t): t is string => t !== null);
    const issue = await prisma.issue.create({
      data: {
        slug,
        title: cluster.question || cluster.title,
        category: toIssueCategory(cluster.category),
        status: "TRENDING",
        confirmation: decision.confirmation,
        summaryJson: level1Summary(cluster, sources, summaryMode) as unknown as Prisma.InputJsonValue,
        voteLabelsJson: cluster.choices as unknown as Prisma.InputJsonValue,
        keywords: Array.from(new Set([cluster.title, ...billTitles])),
        monitoringUntil: new Date(Date.now() + monitoringDays * 86400_000),
      },
    });
    await prisma.$transaction([
      prisma.topicCandidate.update({
        where: { id: candidate.id },
        data: { issueId: issue.id },
      }),
      prisma.issueTimeline.create({
        data: {
          issueId: issue.id,
          label: breaking
            ? `🔴 速報LIVE開始（${input.distinctFeeds}媒体・続報をタイムラインで追跡）`
            : `速報スレを自動公開（${input.distinctFeeds}媒体・一次情報を検知）`,
        },
      }),
    ]);
    await notifyRevalidate(slug, issue.id);
    publishedThisRun += 1;
    console.log(`  ✅ [publish/${decision.confirmation}]${trending ? " 🔥trending" : ""} /issues/${slug} — ${cluster.title}`);
  }

  console.log(
    `4/4 完了: 本日公開 ${publishedToday + publishedThisRun}/${dailyLimit}件・HELDは人間確認待ち`,
  );
}

main()
  .catch(async (e) => {
    // main()内の個別失敗は各所でnotifyRadarFailure済みだが、DB接続断や未捕捉例外で
    // main()自体が丸ごと落ちた場合は今まで何も通知されず「静かに壊れる」経路だった
    console.error(e);
    await notifyRadarFailure("detect.ts 致命的エラー（ジョブ全体が停止）", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
