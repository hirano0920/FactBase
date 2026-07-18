/**
 * Selection V2.1 — Rank スコア（Buzz' × ClickHeat' × DebateHeat'）。
 *
 * 2026-07-17 全面改訂:
 * - Heat'（主85%+副15%混在）を ClickHeat'（ツイート量）と
 *   DebateHeat'（コメント摩擦・投票分断）に分離。
 * - これにより「ツイートは多いが議論ゼロのゴシップ」と
 *   「ツイート少ないがコメントで大荒れの政治争点」を正しく区別する。
 * - rankScore = Buzz' × ClickHeat' × DebateHeat'
 * - Freshness は呼び出し側 (weightedPromoteScore) で乗算。
 * - Conflict'（旧DVS因子）は削除。DebateHeat' がその機能を包含する。
 */
import type { SavedEvidence } from "./promote-logic";

/** 「特大」SNSクリック熱の目安。実分布で校正する */
export const TWEET_REF = 5000;

/** 積スコアの下限（3因子積） */
export const RANK_MIN_DEFAULT = 0.02;

/**
 * Buzz' 下限。0.4 ≒ effectiveScore>=2（クロスソース最低ライン）。
 * 露出が無ければ出さない。
 */
export const BUZZ_MIN_DEFAULT = 0.4;

/**
 * ClickHeat' 下限。tweetCount無しでもコメント・摩擦がある話題を通すため 0。
 * （clickHeat=0 でも debateHeat>0 なら rankScore=0 なので実質debateだけでは通らない）
 */
export const CLICK_HEAT_MIN = 0;

/**
 * DebateHeat' 下限。コメント100程度で届く最低ライン。
 * 全く議論がない話題は clickHeat が高くても弾く。
 */
export const DEBATE_HEAT_MIN = 0.05;

/**
 * 実測DVSが極端に低いときのソフト下限（旧互換）。
 * 現在は DebateHeat' に包含されるが、audit用に残す。
 * @deprecated DebateHeat' が代替
 */
export const DVS_SOFT_FLOOR = 0.15;

export interface SelectionV2Breakdown {
  buzzPrime: number;
  /**
   * @deprecated ClickHeat' + DebateHeat' に分離。互換性のため残す。
   * rankScore計算には使わない。
   */
  heatPrime: number;
  /**
   * 「いま人がそれを見たいと思ってる」度。
   * tweetCountを対数圧縮（log1p）した値。tweetCount無しは0。
   */
  clickHeat: number;
  /**
   * 「人がそれについて議論したがってる」度。
   * コメント数 + 摩擦度 + YouTube返信 + 投票拮抗 を総合。
   */
  debateHeat: number;
  /**
   * 「これは国を揺るがす重要問題」度。
   * 皇室典範改正や憲法改正のような国家的重大イベントのRankを引き上げる。
   * 通常のBuzz/Click/Debateデータでは捉えきれない社会的重大性を考慮。
   */
  nationalImportance: number;
  /**
   * @deprecated Conflict'に統合。rankScore計算には使わない。互換性のために残す。
   */
  dvsPrime: number;
  /**
   * @deprecated DebateHeat' が包含。互換性のために残す。
   */
  conflictPrime: number;
  combinedConflictPrime?: number;
  claimDiffConflicts?: number;
  /** @deprecated use clickHeat */
  tweetHeat: number;
  /** @deprecated not used in rankScore */
  secondaryHeat: number;
  rankScore: number;
  hasTweetCount: boolean;
  tweetCount: number;
  hasMeasuredDvs: boolean;
  /**
   * News候補（debatable=false）か。News は「賛否の熱量」ではなく「話題の到達量」で選ぶため、
   * rankScore から DebateHeat 因子を外し、DebateHeat 下限ゲートも免除する。
   */
  isNews: boolean;
}

export type HeatEvidence = Pick<
  SavedEvidence,
  | "commentCount"
  | "commentCountSurge"
  | "externalPoll"
  | "tweetCount"
  | "youtubeCommentCount"
  | "youtubeReplyCount"
  | "youtubeLikeCount"
  | "commentStanceSpread"
  | "commentFrictionScore"
  | "predictedDivisionScore"
  | "googleTrendTraffic"
  | "newsClusterCount"
  | "buzzSources"
  | "buzzScore"
  | "topic"
  | "debatable"
>;

export type DivisionEvidence = Pick<
  SavedEvidence,
  "externalPoll" | "commentStanceSpread" | "commentFrictionScore" | "predictedDivisionScore"
>;

/**
 * 分断シグナルを信頼度順に統合する（1つの数値・0〜1）。
 *   1. externalPoll.divisionScore — Yahoo!投票の実測集計（最優先）
 *   2. commentFrictionScore — Yahooコメントの反応数（共感/うーん）から算術だけで求めた実測値
 *   3. commentStanceSpread — コメント文面のLLM判定（confidenceで重み付け）
 *   4. predictedDivisionScore — Gate（assessDebateLegitimacy）が抜粋から推定したLLM予測
 * 上位が無ければ下位へフォールバック。何も無ければ 0。
 */
export function resolveDivisionScore(evidence: DivisionEvidence): number {
  if (evidence.externalPoll && Number.isFinite(evidence.externalPoll.divisionScore)) {
    return Math.min(1, Math.max(0, evidence.externalPoll.divisionScore));
  }
  if (typeof evidence.commentFrictionScore === "number" && Number.isFinite(evidence.commentFrictionScore)) {
    return Math.min(1, Math.max(0, evidence.commentFrictionScore));
  }
  const spread = evidence.commentStanceSpread;
  if (spread?.split && Number.isFinite(spread.confidence)) {
    return Math.min(1, Math.max(0, spread.confidence));
  }
  if (
    typeof evidence.predictedDivisionScore === "number" &&
    Number.isFinite(evidence.predictedDivisionScore)
  ) {
    return Math.min(1, Math.max(0, evidence.predictedDivisionScore));
  }
  return 0;
}

/** 分断シグナルが1つでもあるか */
export function hasMeasuredDivision(evidence: DivisionEvidence): boolean {
  if (evidence.externalPoll && Number.isFinite(evidence.externalPoll.divisionScore)) return true;
  if (typeof evidence.commentFrictionScore === "number" && Number.isFinite(evidence.commentFrictionScore)) {
    return true;
  }
  const spread = evidence.commentStanceSpread;
  if (spread?.split && Number.isFinite(spread.confidence)) return true;
  if (
    typeof evidence.predictedDivisionScore === "number" &&
    Number.isFinite(evidence.predictedDivisionScore)
  ) {
    return true;
  }
  return false;
}

/**
 * DVS'（独立因子）- 互換性のために残す。
 * @deprecated DebateHeat' が代替。rankScore計算で使用しない。
 */
export function dvsPrime(evidence: DivisionEvidence): { dvsPrime: number; hasMeasured: boolean } {
  if (!hasMeasuredDivision(evidence)) {
    return { dvsPrime: 1, hasMeasured: false };
  }
  const raw = resolveDivisionScore(evidence);
  return { dvsPrime: Math.max(DVS_SOFT_FLOOR, Math.min(1, raw)), hasMeasured: true };
}

/**
 * Buzz' = clamp(effectiveScore / 5, 0, 1)
 */
export function buzzPrime(buzzScore: number | undefined | null): number {
  const raw = typeof buzzScore === "number" && Number.isFinite(buzzScore) ? buzzScore : 0;
  return Math.min(1, Math.max(0, raw / 5));
}

/**
 * クリック熱量: log1p(tweetCount) / log1p(TWEET_REF)
 * 「いま人がそれを見たいと思ってる」度の代理指標。
 * tweetCount無しは0（別途 buzzScore で露出は評価済み）。
 */
export function tweetHeat(tweetCount: number, tweetRef: number = TWEET_REF): number {
  const n = Math.max(0, tweetCount);
  const ref = Math.max(1, tweetRef);
  return Math.min(1, Math.log1p(n) / Math.log1p(ref));
}

/**
 * ClickHeat': クリック熱量（0〜1）。
 * 「いま人がそれを見たいと思ってる」度を複数の独立シグナルから測定。
 *
 * 構成:
 * ① tweetHeat（対数圧縮）: X上の言及量。tweetCountが無い=0。
 * ② trendHeat: Google Trends 検索ボリューム。急上昇ワードとして実際に
 *    人が検索している量（Yahoo RTに載らない関心も拾う）。
 * ③ newsHeat: Yahoo!ニュースランキングのクラスタ数。編集部が「今、読者が
 *    知るべき」と判断した複数記事の掲載。
 * ④ commentHeat: Yahoo!コメント数。コメントを書く人はまず記事をクリックしている。
 *    tweetCountが無いトピックでも「人が関心を持っている」実測として使う。
 *    ただしスポーツ等のclickはdebateHeatのfrictionWeightで除外されるので
 *    ここでは生の関心量をそのまま測る。
 * ⑤ buzzBreadth: 横断ソース種別の多様性。同じ話題がニュース・TV・YouTube等
 *    複数の異なるソース種別で拾われている＝編集部横断の関心の証拠。
 *
 * tweetCount無しでも Google Trends で急上昇 + Yahoo News で複数記事 → 関心は高い。
 * 逆に tweetCount だけ高いゴシップは newsHeat/trendHeat が低く clickHeat 全体も低め。
 *
 * ClickHeat' 単独でのハード下限は設けていない（CLICK_HEAT_MIN=0）。
 * 最終的な rankScore = Buzz'×Click'×Debate' の積で自然にフィルタリングされる。
 * clickHeat=0 → rank=0 → 自動的に弾かれる（ゴシップはdebateも0なので死ぬ）。
 */
export function clickHeat(
  evidence: HeatEvidence,
  tweetCountOverride?: number | null,
  tweetRef: number = TWEET_REF,
): number {
  // ① tweetHeat — 実測tweetCountがない場合も、高コメント＋高クラスターのトピックは
  //    Yahoo RTのカバレッジ不足でtweetCountを拾えていない可能性が高いため、
  //    緩いプロキシを設定する（最大100tweet相当）。
  const fromEvidence =
    typeof evidence.tweetCount === "number" && Number.isFinite(evidence.tweetCount)
      ? evidence.tweetCount
      : null;
  const fromOverride =
    typeof tweetCountOverride === "number" && Number.isFinite(tweetCountOverride)
      ? tweetCountOverride
      : null;
  const fromProxy =
    !fromOverride &&
    !fromEvidence &&
    (evidence.commentCount ?? 0) >= 300 &&
    (evidence.newsClusterCount ?? 0) >= 5
      ? Math.min(100, Math.round((evidence.commentCount ?? 0) / 5))
      : null;
  const count = fromOverride ?? fromEvidence ?? fromProxy ?? 0;
  const th = count > 0 ? tweetHeat(count, tweetRef) : 0;

  // ② trendHeat: Google Trends 検索トラフィック
  const traffic = evidence.googleTrendTraffic ?? 0;
  const trendH = traffic >= 100_000 ? 0.30 : traffic >= 10_000 ? 0.15 : 0;

  // ③ newsHeat: Yahoo!ニュースクラスタ数（同一争点の見出し数）
  const cluster = evidence.newsClusterCount ?? 0;
  const newsH = cluster >= 10 ? 0.20 : cluster >= 8 ? 0.15 : cluster >= 5 ? 0.10 : cluster >= 3 ? 0.05 : cluster >= 2 ? 0.03 : 0;

  // ④ commentHeat: コメント数もクリック誘引の実測値
  //   「コメントした人はクリックした人」＝関心の証明
  const cc = evidence.commentCount ?? 0;
  const commentH = cc >= 2000 ? 0.15 : cc >= 500 ? 0.08 : cc >= 100 ? 0.07 : 0;

  // ⑤ buzzBreadth: 横断ソース種別の多様性（独自ソース種の数に応じて）
  //    buzzSources = ["yahoo_news_ranking","news_cluster","yahoo_comment_ranking","google_trends","tv_news","youtube_trending","yahoo_realtime"]
  //    異なる種別（prefix）をカウント: yahoo_news_ranking/yahoo_comment_rankingは両方「Yahoo系」だが
  //    種別としてはnews_clusterとyoutube_trendingとは独立なので区別する
  const sources = evidence.buzzSources ?? [];
  let breadth = 0;
  if (sources.length >= 5) breadth = 0.20;
  else if (sources.length >= 4) breadth = 0.18;
  else if (sources.length >= 3) breadth = 0.15;
  else if (sources.length >= 2) breadth = 0.08;
  else if (sources.length >= 1) breadth = 0.03;

  const total = th + trendH + newsH + commentH + breadth;
  return Math.min(1, total);
}

/**
 * DebateHeat': 議論熱量（0〜1）。
 * 「人がそれについて議論したがってる」度をコメント・摩擦・投票・YouTube応酬から測定。
 *
 * 構成（合計1.0超える場合はclamp）:
 * - コメント数: Yahoo+YouTubeの高い方（3000超で+0.35、1000超+0.30、500超+0.20、200超+0.10、80超+0.04）
 * - コメント急増: +0.40（炎上加速）
 * - YouTube返信（応酬の実測）: 300超+0.30、100超+0.15
 * - YouTubeいいね（共感）: 1万超+0.15、3000超+0.08
 * - コメント摩擦度: 0.5超+0.30、0.3超+0.15（コメント数が少なくても摩擦自体が議論の存在証明）
 * - 投票拮抗: divisionScore>=0.2で+0.20
 */
export function debateHeat(evidence: HeatEvidence): number {
  let heat = 0;

  // コメント数（Yahoo + YouTube、高い方）
  const count = Math.max(evidence.commentCount ?? 0, evidence.youtubeCommentCount ?? 0);
  const friction = evidence.commentFrictionScore;
  // frictionWeight: 実測値があれば weight = max(0.1, min(1, friction*3))
  //   - 実測0でも最低0.1を確保（コメントそのものの存在が最低限の関心を示す）
  //   - 未測定(undefined)かつ高コメント数(1000+) = ノイズの可能性が高いので低weight
  //   - 未測定かつ低コメント = データ不足として標準weight
  const frictionWeight = friction === undefined
    ? (count >= 1000 ? 0.15 : 0.3)
    : Math.max(0.1, Math.min(1, friction * 3));

  let countHeat = 0;
  if (count >= 2000) countHeat = 0.40;
  else if (count >= 800) countHeat = 0.30;
  else if (count >= 400) countHeat = 0.20;
  else if (count >= 150) countHeat = 0.12;
  else if (count >= 50) countHeat = 0.06;
  heat += countHeat * frictionWeight;

  // コメント急増（炎上加速）
  if (evidence.commentCountSurge) heat += 0.40;

  // YouTube返信（実際の応酬）
  const replyCount = evidence.youtubeReplyCount ?? 0;
  let ytReplyHeat = 0;
  if (replyCount >= 300) ytReplyHeat = 0.30;
  else if (replyCount >= 100) ytReplyHeat = 0.15;
  else if (replyCount >= 30) ytReplyHeat = 0.08;

  // YouTubeいいね（共感）
  const likeCount = evidence.youtubeLikeCount ?? 0;
  let ytLikeHeat = 0;
  if (likeCount >= 10000) ytLikeHeat = 0.15;
  else if (likeCount >= 3000) ytLikeHeat = 0.08;

  // YouTubeデータは摩擦実測との相互検証がないと「単なる話題性」と「実際の議論」の区別がつかない
  // （例: ブレインチップ移植のような驚き系トピックではコメントが多くても議論ではない）
  // 摩擦が未測定の場合はYouTube信号の合計を上限0.06に制限する
  const yahooCount = evidence.commentCount ?? 0;
  if (friction !== undefined && friction > 0.05) {
    // 摩擦実測あり→YouTube信号をそのまま信用
    heat += ytReplyHeat + ytLikeHeat;
  } else {
    // 摩擦未測定→YouTube信号は割り引く（キャップ0.06）
    heat += Math.min(ytReplyHeat + ytLikeHeat, 0.06);
  }

  // 投票拮抗（実際の世論の分断）
  const pollDiv = evidence.externalPoll?.divisionScore;
  if (typeof pollDiv === "number" && pollDiv >= 0.2) {
    heat += 0.20;
  }

  // コメント摩擦度自体が議論の存在証明
  if (friction !== undefined) {
    if (friction > 0.5) heat += 0.30;
    else if (friction > 0.3) heat += 0.15;
    else if (friction > 0.15) heat += 0.08;
  }

  // テレビ報道ボーナス: 同じ話題がテレビニュースでも報じられている＝社会的に重要な議論
  // かつYahooニュースランキングとコメントランキングにも載っている＝多方面で注目
  // ただし、コメント摩擦が未測定でコメント数が多い場合（=ノイズの可能性）、
  // または摩擦が0.05以下（=実測で議論なしと判定）の場合は適用しない。
  const sources = evidence.buzzSources ?? [];
  const hasTv = sources.includes("tv_news");
  const hasNews = sources.includes("yahoo_news_ranking");
  const hasComment = sources.includes("yahoo_comment_ranking");
  // 摩擦が実測されていて0.05超(=議論あり)であるか、コメント数少(=未知の話題だが高品質な可能性)
  const frictionUsable = (friction !== undefined && friction > 0.05) || count < 1000;
  if (hasTv && hasNews && hasComment && frictionUsable) {
    heat += 0.15; // テレビ＋ニュース＋コメントの3面同時ヒット＝社会的にホット
  }

  // 法案通過ボーナス: 「可決」「成立」「改正」を含むトピックは
  // 実際に制度が変わる瞬間だが、これらは「議論の熱量」ではなく「制度変更の事実」。
  // 大きすぎると手続き型法案を過大評価するので一律0.05に抑える。
  if (evidence.topic) {
    const t = evidence.topic;
    if (/可決|成立/.test(t)) heat += 0.05;
    else if (/改正案|改正/.test(t)) heat += 0.05;
  }

  // ニュースクラスタ数: 多くの媒体が報じている＝露出の広さであり、議論の熱量ではない。
  // コメント・摩擦・YouTube返信などの直接的な議論シグナルがない場合、
  // クラスター数だけでは「議論が起きている」とは言えないので寄与を抑える。
  const cluster = evidence.newsClusterCount ?? 0;
  // 直接的な議論シグナルの有無をチェック（Yahooコメントのみ、YouTubeはノイズの可能性）
  const hasDirectDebateSignals =
    yahooCount >= 200 ||
    (evidence.youtubeReplyCount ?? 0) >= 100 ||
    (evidence.externalPoll?.divisionScore ?? 0) >= 0.1 ||
    (friction !== undefined && friction > 0.1);
  const clusterMultiplier = hasDirectDebateSignals ? 1.0 : 0.3;
  if (cluster >= 15) heat += 0.15 * clusterMultiplier;
  else if (cluster >= 10) heat += 0.10 * clusterMultiplier;
  else if (cluster >= 8) heat += 0.06 * clusterMultiplier;
  else if (cluster >= 5) heat += 0.04 * clusterMultiplier;
  else if (cluster >= 3) heat += 0.02 * clusterMultiplier;

  // --- 海外国内人事キャップ ---
  // ウクライナ国防相更迭のように「日本に関係ない海外の人事/内政」は
  // コメント摩擦が高くても「そのトピック固有の議論」ではなく
  // 国全体への総論的な分断が混入しているため、debateHeatを上限20%までに制限。
  heat = Math.min(heat, foreignDomesticCap(evidence.topic, evidence.buzzSources));

  return Math.min(1, heat);
}

/**
 * 海外トピックのdebateHeat上限。
 * 2種類の対象がある:
 *   1) 海外国内人事: ウクライナ国防相更迭（既存）
 *   2) 日本無関係国際問題: 中国のフィリピン侮蔑（新規）
 * いずれもコメントの分断がトピック固有でなく総論的なので上限を低くする。
 */
function foreignDomesticCap(
  topic: string | null | undefined,
  sources: string[] | undefined,
): number {
  if (!topic) return 1.0;

  // 判定1: 海外国内人事（辞任/更迭/任命）
  const isForeignPersonnel =
    /^(ウクライナ|米|米国|アメリカ|中国|韓国|ロシア|英国|フランス|ドイツ|インド|豪州|豪|EU)\S{0,6}/.test(topic) &&
    !/日本|日米|日韓|日中|日露/.test(topic) &&
    /更迭|辞任|任命|選出|就任|退任|交代/.test(topic);

  if (isForeignPersonnel) return 0.20;

  // 判定2: 日本無関係国際問題
  // 「中国がフィリピン国民を侮蔑」「米下院が〜決議」のように
  // 日本が出てこない国際問題。日本人が議論しても当事者意識が薄い。
  const isUnrelatedInternational =
    /^(ウクライナ|米|米国|アメリカ|中国|韓国|ロシア|フランス|ドイツ|インド|豪州|豪|EU|イラン|イスラエル|パレスチナ)\S{0,6}/.test(topic) &&
    !/日本|日米|日韓|日中|日露|安保|同盟|首脳会談|外相/.test(topic);

  if (isUnrelatedInternational) return 0.25;

  return 1.0;
}

/**
 * 副熱量（旧互換用）。debateHeat と同じ計算だが、commentCountSurgeを
 * 別枠にしないなど厳密な互換が必要な audit 用。
 * @deprecated debateHeat を使うこと
 */
export function secondaryHeat(evidence: HeatEvidence): number {
  let commentHeat = 0;
  if (evidence.commentCountSurge) commentHeat += 0.4;
  const count = Math.max(evidence.commentCount ?? 0, evidence.youtubeCommentCount ?? 0);
  if (count >= 3000) commentHeat += 0.35;
  else if (count >= 1000) commentHeat += 0.3;
  else if (count >= 500) commentHeat += 0.2;
  else if (count >= 300) commentHeat += 0.12;
  const replyCount = evidence.youtubeReplyCount ?? 0;
  if (replyCount >= 300) commentHeat += 0.3;
  else if (replyCount >= 100) commentHeat += 0.15;
  const likeCount = evidence.youtubeLikeCount ?? 0;
  if (likeCount >= 10000) commentHeat += 0.15;
  else if (likeCount >= 3000) commentHeat += 0.08;
  return Math.min(1, commentHeat);
}

/**
 * Heat'（旧 - 主85%+副15%混在モデル）。
 * @deprecated ClickHeat' + DebateHeat' に分離。互換性のために残す。
 */
export function heatPrime(
  evidence: HeatEvidence,
  tweetCountOverride?: number | null,
  tweetRef: number = TWEET_REF,
): {
  heatPrime: number;
  tweetHeat: number;
  secondaryHeat: number;
  tweetCount: number;
  hasTweetCount: boolean;
} {
  const fromEvidence =
    typeof evidence.tweetCount === "number" && Number.isFinite(evidence.tweetCount)
      ? evidence.tweetCount
      : null;
  const fromOverride =
    typeof tweetCountOverride === "number" && Number.isFinite(tweetCountOverride)
      ? tweetCountOverride
      : null;
  const tweetCount = fromOverride ?? fromEvidence ?? 0;
  const hasTweetCount = (fromOverride ?? fromEvidence) !== null && tweetCount > 0;
  const th = tweetHeat(tweetCount, tweetRef);
  const sh = secondaryHeat(evidence);
  if (hasTweetCount) {
    return {
      heatPrime: Math.min(1, 0.85 * th + 0.15 * sh),
      tweetHeat: th,
      secondaryHeat: sh,
      tweetCount,
      hasTweetCount: true,
    };
  }
  return {
    heatPrime: Math.min(0.55, sh),
    tweetHeat: 0,
    secondaryHeat: sh,
    tweetCount: 0,
    hasTweetCount: false,
  };
}

/**
 * Conflict'（対立因子）- 互換性のために残す。
 * @deprecated DebateHeat' が包含。rankScore計算で使用しない。
 */
export function conflictPrime(
  evidence: DivisionEvidence & Pick<HeatEvidence, "tweetCount" | "commentCount" | "commentCountSurge">,
): number {
  const hasHeatEvidence =
    (typeof evidence.tweetCount === "number" && evidence.tweetCount > 0) ||
    (typeof evidence.commentCount === "number" && evidence.commentCount >= 300) ||
    evidence.commentCountSurge === true;
  if (hasHeatEvidence) return 1.0;
  if (!hasMeasuredDivision(evidence)) return 1.0;
  return Math.max(DVS_SOFT_FLOOR, Math.min(1, resolveDivisionScore(evidence)));
}

/**
 * combineConflictPrime: 互換性のために残す。
 * @deprecated debateHeat が claimDiff を包含する形で代替。
 */
export function combineConflictPrime(
  baseConflictPrime: number,
  claimDiffConflicts: number,
): number {
  if (claimDiffConflicts <= 0) return baseConflictPrime;
  const mediaBonus = Math.min(0.15, claimDiffConflicts * 0.05);
  return Math.min(1.0, baseConflictPrime + mediaBonus);
}

/**
 * 国家的に重要な話題（皇室典範改正、憲法改正など）のRankを引き上げる。
 * 通常のBuzz/Click/Debateのデータでは捉えきれない「社会的な重大性」を考慮する。
 * 具体的には：
 *   - 皇室典範改正（男系継承問題）→ 3.0x（一代限りの憲法級の改正）
 *   - 憲法改正関連 → 2.5x
 *   - 一般の法案可決（可決/成立）→ tv_newsと合わせて1.5x
 */
export function nationalImportanceFactor(
  topic: string | null | undefined,
  buzzSources?: string[],
): number {
  if (!topic) return 1.0;
  // 皇室典範は最高の重み（国会では事実上の憲法議論）
  if (/皇室典範/.test(topic)) return 3.0;
  // 憲法改正関連
  if (/憲法改正/.test(topic)) return 2.5;
  // 国旗毀損罪（新しい法律の成立）
  if (/国旗損壊罪/.test(topic)) return 1.5;
  // 一般の法案通過: tv_newsでも報じられる法律改正
  if (buzzSources?.includes("tv_news") && /可決|成立/.test(topic)) return 1.5;
  return 1.0;
}

/**
 * rankScore = Buzz' × ClickHeat' × DebateHeat' × NationalImportance（4因子）。
 * Freshness は呼び出し側で乗算。
 *
 * News候補（debatable=false・キオクシア株価急落型）は「賛否の熱量」ではなく
 * 「話題の到達量」で公開すべきなので、DebateHeat 因子を外して
 * rankScore = Buzz' × ClickHeat' × NationalImportance で評価する。
 * DebateHeatを掛けると、賛否が割れない速報は本来の到達量に関わらずrankScoreが潰れてしまう
 * （②で救ったNews候補が選定段階で再び落ちる問題への対処）。
 */
export function selectionV2RankScore(
  evidence: Pick<SavedEvidence, "buzzScore"> & HeatEvidence,
  opts?: { tweetCountOverride?: number | null; tweetRef?: number },
): SelectionV2Breakdown {
  const bp = buzzPrime(evidence.buzzScore);
  const ch = clickHeat(evidence, opts?.tweetCountOverride, opts?.tweetRef);
  const dh = debateHeat(evidence);
  const ni = nationalImportanceFactor(evidence.topic, evidence.buzzSources);
  const isNews = evidence.debatable === false;
  // 旧互換
  const heat = heatPrime(evidence, opts?.tweetCountOverride, opts?.tweetRef);
  const dvs = dvsPrime(evidence);
  const cp = conflictPrime(evidence);
  return {
    buzzPrime: bp,
    heatPrime: heat.heatPrime,
    clickHeat: ch,
    debateHeat: dh,
    nationalImportance: ni,
    dvsPrime: dvs.dvsPrime,
    conflictPrime: cp,
    tweetHeat: heat.tweetHeat,
    secondaryHeat: heat.secondaryHeat,
    rankScore: isNews ? bp * ch * ni : bp * ch * dh * ni,
    hasTweetCount: heat.hasTweetCount,
    tweetCount: heat.tweetCount,
    hasMeasuredDvs: dvs.hasMeasured,
    isNews,
  };
}

/** @deprecated passesSelectionV2 を使うこと */
export function passesRankMin(rankScore: number, rankMin: number = RANK_MIN_DEFAULT): boolean {
  return rankScore >= rankMin;
}

/**
 * 公開してよい Rank か（Buzz・ClickHeat・DebateHeat・積の下限）。
 * 両論Gateは呼び出し側（assessDebateLegitimacy）で別途必須。
 *
 * 注意: buzzPrime < buzzMin でも tweetCount が実測100超の場合は通過させる（データ不足の誤排除防止）。
 * 例: 改正皇室典範（tweet=604）はbuzzScore=1だがtweetCount=604あって確実に話題になっている。
 *
 * News候補（isNews=true）は「賛否の熱量」で公開するものではないので DebateHeat 下限を免除する。
 * rankScore は selectionV2RankScore 側で既に DebateHeat 因子を外して計算されている。
 */
export function passesSelectionV2(
  breakdown: Pick<SelectionV2Breakdown, "buzzPrime" | "clickHeat" | "debateHeat" | "heatPrime" | "rankScore"> & { tweetCount?: number; isNews?: boolean },
  opts?: { rankMin?: number; buzzMin?: number; clickMin?: number; debateMin?: number },
): boolean {
  const rankMin = opts?.rankMin ?? RANK_MIN_DEFAULT;
  const buzzMin = opts?.buzzMin ?? BUZZ_MIN_DEFAULT;
  const clickMin = opts?.clickMin ?? CLICK_HEAT_MIN;
  const debateMin = opts?.debateMin ?? DEBATE_HEAT_MIN;
  // buzzPrimeは下限未満でも、tweetCount実測があれば通す
  const buzzOk = breakdown.buzzPrime >= buzzMin || (breakdown.tweetCount ?? 0) >= 100;
  // Newsは賛否の熱量で選ばないので DebateHeat 下限を免除
  const debateOk = breakdown.isNews === true || breakdown.debateHeat >= debateMin;
  return (
    breakdown.rankScore >= rankMin &&
    buzzOk &&
    breakdown.clickHeat >= clickMin &&
    debateOk
  );
}
