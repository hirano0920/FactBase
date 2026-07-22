/**
 * 政治家/政党の「争点横断・中立層への説得力」集計。
 * IssuePolitician（争点×どちら側の立場を取ったか）を起点に、その立場側のコメントが
 * 相手陣営・中立層からどれだけhelpful評価を受けたか（bridging.tsと同じ考え方）を積み上げる。
 * 生の支持率（好き嫌い投票）にしないのは、陣営ファンダム化を避け、常に
 * 「なぜ支持されたか」に理由（説得力）を紐付けるため。
 */
import { prisma } from "@/lib/prisma";

export interface PoliticianPersuasionScore {
  politicianId: string;
  name: string;
  party: string | null;
  /** タグ付けされた争点の数 */
  issueCount: number;
  /** 政治家の立場側コメントが受けたhelpful合計 */
  totalHelpful: number;
  /** そのうち相手陣営・中立層からのhelpful（=bridging） */
  bridgingHelpful: number;
  /** bridgingHelpful / totalHelpful（0〜100）。totalHelpful=0ならnull */
  bridgingRate: number | null;
}

const MIN_HELPFUL_FOR_RATE = 5;

export async function getPoliticianPersuasionScore(
  politicianId: string,
): Promise<PoliticianPersuasionScore | null> {
  const politician = await prisma.politician.findUnique({
    where: { id: politicianId },
    select: {
      id: true,
      name: true,
      party: true,
      issues: { select: { issueId: true, stance: true } },
    },
  });
  if (!politician) return null;

  // ABSTAIN(棄権)はComment.stance(FOR/AGAINST/UNDECIDED)側に対応する陣営が無いため集計から除外する
  const pairs = politician.issues.filter((p) => p.stance !== "ABSTAIN");
  if (pairs.length === 0) {
    return {
      politicianId: politician.id,
      name: politician.name,
      party: politician.party,
      issueCount: politician.issues.length,
      totalHelpful: 0,
      bridgingHelpful: 0,
      bridgingRate: null,
    };
  }

  const issueIds = pairs.map((p) => p.issueId);
  // FOR/AGAINSTはPoliticianStanceとVoteChoueの両方に存在する文字列なので、
  // テキストとして渡してVoteChoiceにキャストする（型としては別enumなので直接は比較できない）
  const stances = pairs.map((p) => p.stance as string);

  const rows = await prisma.$queryRaw<{ total_helpful: bigint; bridging_helpful: bigint }[]>`
    WITH pairs AS (
      SELECT unnest(${issueIds}::text[]) AS "issueId", unnest(${stances}::text[])::"VoteChoice" AS stance
    )
    SELECT
      COUNT(*)::bigint AS total_helpful,
      COUNT(*) FILTER (WHERE v.choice = 'UNDECIDED' OR v.choice != c.stance)::bigint AS bridging_helpful
    FROM "Helpful" h
    INNER JOIN "Comment" c ON c.id = h."commentId"
    INNER JOIN pairs p ON p."issueId" = c."issueId" AND p.stance = c.stance
    INNER JOIN "Vote" v ON v."userId" = h."userId" AND v."issueId" = c."issueId"
  `;

  const totalHelpful = Number(rows[0]?.total_helpful ?? 0);
  const bridgingHelpful = Number(rows[0]?.bridging_helpful ?? 0);
  const bridgingRate =
    totalHelpful >= MIN_HELPFUL_FOR_RATE
      ? Math.round((bridgingHelpful / totalHelpful) * 1000) / 10
      : null;

  return {
    politicianId: politician.id,
    name: politician.name,
    party: politician.party,
    // ABSTAIN分も含めた「タグ付けされた争点の総数」。bridging集計自体はFOR/AGAINSTのみが対象
    issueCount: politician.issues.length,
    totalHelpful,
    bridgingHelpful,
    bridgingRate,
  };
}

export interface RelatedNewsBrief {
  slug: string;
  title: string;
  createdAt: string;
}

/**
 * 政治家名が争点タグ付け（IssuePolitician）ではなくタイトル・キーワードに出てくるNews記事。
 * 「賛否タグが付くほど法案化していないが、この政治家に関するニュースがある」ケースを拾う
 * （タグ付けはdietVote由来の法案系のみなので、スキャンダル・人事等のNewsは別ルートが必要）。
 */
export async function getRelatedNewsForPolitician(
  name: string,
  limit = 5,
): Promise<RelatedNewsBrief[]> {
  const rows = await prisma.issue.findMany({
    where: {
      track: "NEWS",
      underReview: false,
      status: { not: "ARCHIVED" },
      OR: [{ title: { contains: name } }, { keywords: { has: name } }],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { slug: true, title: true, createdAt: true },
  });
  return rows.map((r) => ({ slug: r.slug, title: r.title, createdAt: r.createdAt.toISOString() }));
}

export interface PoliticianVoteRecord {
  issueId: string;
  issueSlug: string;
  issueTitle: string;
  stance: "FOR" | "AGAINST" | "ABSTAIN";
  votedAt: string;
  /** タグ付けの出典（"dietVote:party"=本会議記名投票の政党多数派 / "dietVote:defector"=同・個人票 / null=手動） */
  source: string | null;
  /** 争点が今もアクティブか（関連Debateへの誘導CTAの出し分け用） */
  issueStatus: "ACTIVE" | "TRENDING" | "PASSED" | "ARCHIVED";
}

/** 「この政治家が直近の争点で賛成/反対/棄権どれだったか」の一覧。新しい順 */
export async function getPoliticianVoteHistory(
  politicianId: string,
  limit = 20,
): Promise<PoliticianVoteRecord[]> {
  const rows = await prisma.issuePolitician.findMany({
    where: { politicianId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      stance: true,
      source: true,
      createdAt: true,
      issue: { select: { id: true, slug: true, title: true, status: true } },
    },
  });
  return rows.map((r) => ({
    issueId: r.issue.id,
    issueSlug: r.issue.slug,
    issueTitle: r.issue.title,
    stance: r.stance,
    votedAt: r.createdAt.toISOString(),
    source: r.source,
    issueStatus: r.issue.status,
  }));
}
