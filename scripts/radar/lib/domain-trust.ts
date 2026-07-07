/**
 * Tavily発見結果のドメイン信頼度フィルタ。
 *
 * 全ドメインを事前に格付けするホワイトリスト方式は取らない
 * （Tavilyの価値はfeeds.jsonに無い未知の良質ソース＝専門メディア・シンクタンク等を
 * 見つけることなので、事前ホワイトリストに絞ると発見の意味が無くなる）。
 * 代わりに、既知の国家プロパガンダ系・低品質スパム系ドメインだけを機械的に除外する
 * デナイリスト方式にする。それ以外の品質担保は既存の主張裏取り検証
 * （src/lib/radar-article.ts の generateVerifiedArticle）に委ねる。
 *
 * denylistは2階建て:
 *   1. コード内固定リスト（DENYLIST_DOMAINS/SUSPICIOUS_TLD_PATTERNS。デプロイ必須・レビュー付き）
 *   2. DB管理リスト（DomainTrustRule。運用中に見つけた低品質ドメインを管理画面からデプロイ無しで追加）
 * 2は1を置き換えず追加するだけなので、コード内リストを緩めるような変更にはならない。
 */

/** 国家プロパガンダ系・情報操作リスクが高いことが広く指摘されているドメイン（feeds.jsonのtrust低評価と同じ選定基準） */
const DENYLIST_DOMAINS: RegExp[] = [
  /(^|\.)rt\.com$/i,
  /(^|\.)tass\.com$/i,
  /(^|\.)sputniknews\.[a-z.]+$/i,
  /(^|\.)presstv\.ir$/i,
  /(^|\.)globaltimes\.cn$/i,
  /(^|\.)pravda\.ru$/i,
  /(^|\.)ria\.ru$/i,
];

/** 低品質・スパムサイトによくあるドメインパターン（コンテンツファーム・激安TLD等） */
const SUSPICIOUS_TLD_PATTERNS: RegExp[] = [/\.(xyz|top|click|loan|work|gq|tk|ml|ga|cf)$/i];

/** hostがdeny登録ホスト名そのもの、またはそのサブドメインかどうか（前方一致による誤検出を避ける） */
export function matchesHostnameOrSubdomain(hostname: string, denyHostname: string): boolean {
  const h = hostname.toLowerCase();
  const d = denyHostname.toLowerCase().trim();
  if (!d) return false;
  return h === d || h.endsWith(`.${d}`);
}

/**
 * @param extraDenyHostnames DB管理リスト（DomainTrustRule）由来の追加拒否ホスト名。省略時はコード内リストのみで判定
 */
export function isDeniedDomain(hostname: string, extraDenyHostnames: string[] = []): boolean {
  const h = hostname.toLowerCase();
  if (DENYLIST_DOMAINS.some((p) => p.test(h)) || SUSPICIOUS_TLD_PATTERNS.some((p) => p.test(h))) {
    return true;
  }
  return extraDenyHostnames.some((d) => matchesHostnameOrSubdomain(h, d));
}

/** Tavily結果採用前のURLフィルタ。不正なURLは信頼できないものとして除外する */
export function isTrustedTavilyUrl(url: string, extraDenyHostnames: string[] = []): boolean {
  try {
    return !isDeniedDomain(new URL(url).hostname, extraDenyHostnames);
  } catch {
    return false;
  }
}

interface DomainTrustRuleSource {
  domainTrustRule: {
    findMany: (args: { where: { action: string }; select: { hostname: true } }) => Promise<{ hostname: string }[]>;
  };
}

let cachedDenylist: { hostnames: string[]; loadedAt: number } | null = null;
/** DB問い合わせ頻度を絞るキャッシュ有効期間。discover.ts等が1実行内に何十回もresearchTopicを呼ぶため。 */
const DB_DENYLIST_CACHE_TTL_MS = 5 * 60_000;

/**
 * DomainTrustRule（action="DENY"）をDBから読み込む。
 * ハードコードのDENYLIST_DOMAINSと違い、運用中に管理画面（/admin/domain-trust）から
 * コード変更・デプロイ無しで追加・削除できる。DB接続失敗時はハードコードのdenylistのみで
 * 処理を続行する（Radar全体を止めない）。
 */
export async function loadDomainTrustDenylist(prisma: DomainTrustRuleSource): Promise<string[]> {
  if (cachedDenylist && Date.now() - cachedDenylist.loadedAt < DB_DENYLIST_CACHE_TTL_MS) {
    return cachedDenylist.hostnames;
  }
  try {
    const rows = await prisma.domainTrustRule.findMany({
      where: { action: "DENY" },
      select: { hostname: true },
    });
    const hostnames = rows.map((r) => r.hostname);
    cachedDenylist = { hostnames, loadedAt: Date.now() };
    return hostnames;
  } catch (e) {
    console.warn(`  ⚠️ domain-trust: DB拒否リストの取得に失敗、コード内denylistのみで続行 (${e})`);
    return cachedDenylist?.hostnames ?? [];
  }
}

/** テスト専用。モジュール内キャッシュをリセットしてDB読み込みをやり直させる。 */
export function resetDomainTrustDenylistCache(): void {
  cachedDenylist = null;
}
