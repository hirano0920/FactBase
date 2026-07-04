/**
 * FactBase Radar — 検知・分類・スコアリング・自動公開（Level 1速報スレ）。
 *
 * 実行: npx tsx scripts/radar/detect.ts
 * 設計原則:
 *   - ニュース見出しは「話題検知シグナル」。記事本文は取得も保存もしない
 *   - nano呼び出しは1実行あたり最大1回（新着見出しのクラスタリング）
 *   - 公開判断は decidePublish（ハードブロック > 複数媒体一致 > スコア閾値 > 日次上限）
 *   - 速報スレの本文はテンプレート生成（AIに自由記述させない＝出鱈目要約の構造的排除）
 */
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient, type IssueCategory, type Prisma } from "@prisma/client";
import { XMLParser } from "fast-xml-parser";
import { classifyHeadlines, type RadarCluster } from "../../src/lib/ai";
import { decidePublish, dedupKey, clusterCoherence, COHERENCE_THRESHOLD, isOutOfScopeTopic, isBreakingNews } from "../../src/lib/radar";
import { RADAR } from "../../src/lib/constants";
import type { FeedItem } from "./sources/common";
import { fetchCourtsNews, fetchCourtsKijitsu } from "./sources/courts";
import { fetchShugiinBills, fetchSangiinBills } from "./sources/diet";
import { notifyRadarFailure } from "./notify";

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
  retries = 2,
): Promise<RadarCluster[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await classifyHeadlines(headlines);
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

/** 政治・経済・法令系をnano分類の先頭に回す（NHK総合・W杯等に埋もれないように） */
const CLASSIFY_PRIORITY_FEED =
  /^(kantei|cao|digital|boj-|mof|fsa|moj-|mhlw|mlit-|maff|mod-|mofa-|fed-|ecb-|courts|shugiin|sangiin|gnews-politics|gnews-diet|gnews-economy|gnews-fiscal|gnews-law|gnews-rights|gnews-international|gnews-en-|nhk-politics|nhk-economy|nhk-international|bloomberg|whitehouse|state-|defense-gov|bbc-world|bbc-middle-east|aljazeera|guardian-world)/;

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
  const [rssItems, courtsNews, courtsKijitsu, shugiin, sangiin] = await Promise.all([
    Promise.all(config.feeds.map(fetchFeed)).then((r) => r.flat()),
    fetchCourtsNews(),
    fetchCourtsKijitsu(),
    fetchShugiinBills(),
    fetchSangiinBills(),
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
  const recent = selectForClassification(recentRaw);
  if (recent.length === 0) {
    console.log("  今回の新規イベントなし — スキップ");
    return;
  }
  console.log(`  分類対象 ${recent.length}件（今回の新規のみ）`);
  const clusters = await classifyWithRetry(
    recent.map((e, i) => ({ index: i, feed: e.feedName, title: e.title })),
  );
  console.log(`  ${clusters.length}クラスタ検出`);

  // 3. スコアリング → 公開判断
  console.log("3/4 スコアリング・公開判断…");
  const publishedToday = await prisma.topicCandidate.count({
    where: {
      status: "PUBLISHED",
      createdAt: { gte: new Date(new Date().toISOString().slice(0, 10)) },
    },
  });
  const dailyLimit = Number(process.env.RADAR_AUTO_PUBLISH_PER_DAY ?? RADAR.autoPublishPerDay);
  let publishedThisRun = 0;

  for (const cluster of clusters) {
    const key = dedupKey(cluster.title);
    const exists = await prisma.topicCandidate.findUnique({ where: { dedupKey: key } });
    if (exists) continue; // 既知トピック（続報はsummarize/timelineの担当）

    const members = cluster.member_indices
      .filter((i) => i >= 0 && i < recent.length)
      .map((i) => recent[i]);
    if (members.length === 0) continue;

    if (isOutOfScopeTopic(cluster.title, members.map((m) => m.title))) {
      console.log(`  [reject/out_of_scope] ${cluster.title} — スポーツ・エンタメ等`);
      continue;
    }

    // nanoのクラスタリングが無関係な見出しを誤って束ねていないか機械的に再検証する。
    // 一貫性が低ければ「実際は単一ソースの誤報」とみなし、distinctFeedsを1に強制して
    // decidePublishのsingle_sourceゲートに必ず引っかかるようにする（誤報の自動公開防止）。
    const coherence = clusterCoherence(members.map((m) => m.title));
    const coherent = coherence >= COHERENCE_THRESHOLD;
    const distinctFeeds = coherent ? new Set(members.map((m) => m.feedName)).size : 1;

    const input = {
      eventCount: members.length,
      distinctFeeds,
      minutesSinceLatest: Math.floor(
        (Date.now() - Math.max(...members.map((m) => m.publishedAt.getTime()))) / 60_000,
      ),
      maxTrustWeight: Math.max(...members.map((m) => m.trustWeight)),
      riskFlags: cluster.risk_flags ?? [],
      classification: cluster.classification,
      publishedToday: publishedToday + publishedThisRun,
      dailyLimit,
      feedNames: members.map((m) => m.feedName),
      clusterTitle: cluster.title,
    };
    const decision = decidePublish(input);
    if (!coherent) {
      console.log(
        `  [low_coherence=${coherence.toFixed(2)}] ${cluster.title} — distinctFeedsを1に強制`,
      );
    }

    const sources = members.map((m) => ({ title: m.title, url: m.url, feed: m.feedName }));
    const candidate = await prisma.topicCandidate.create({
      data: {
        dedupKey: key,
        title: cluster.title,
        category: cluster.category,
        classification: cluster.classification,
        eventCount: input.eventCount,
        distinctFeeds: input.distinctFeeds,
        hotScore: 0,
        trustScore: input.maxTrustWeight,
        riskScore: 0,
        riskFlags: input.riskFlags,
        decision: `${decision.action}: ${decision.reason} coherence=${coherence.toFixed(2)}`,
        status:
          decision.action === "publish" ? "PUBLISHED" : decision.action === "hold" ? "HELD" : "REJECTED",
        sourceUrls: sources as unknown as Prisma.InputJsonValue,
      },
    });

    if (decision.action !== "publish") {
      console.log(`  [${decision.action}] ${cluster.title} (${decision.reason})`);
      continue;
    }

    // 4. Level 1速報スレを自動公開
    const slug = `radar-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
    const breaking = isBreakingNews(input);
    const summaryMode = decision.confirmation === "OFFICIAL" ? "official" : "breaking";
    const monitoringDays = breaking ? 7 : 60;
    const issue = await prisma.issue.create({
      data: {
        slug,
        title: cluster.question || cluster.title,
        category: toIssueCategory(cluster.category),
        status: "TRENDING",
        confirmation: decision.confirmation,
        summaryJson: level1Summary(cluster, sources, summaryMode) as unknown as Prisma.InputJsonValue,
        voteLabelsJson: cluster.choices as unknown as Prisma.InputJsonValue,
        keywords: [cluster.title],
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
    publishedThisRun += 1;
    console.log(`  ✅ [publish/${decision.confirmation}] /issues/${slug} — ${cluster.title}`);
  }

  console.log(
    `4/4 完了: 本日公開 ${publishedToday + publishedThisRun}/${dailyLimit}件・HELDは人間確認待ち`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
