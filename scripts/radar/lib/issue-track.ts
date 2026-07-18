/**
 * TwoSides Debate / News トラック判定。
 * debateType（policy等）とは別軸。プロダクトとしての出し分けに使う。
 */
export type IssueTrackId = "debate" | "news";

export interface TrackSignals {
  /** Legitimacy Gate 通過なら true */
  legitimate: boolean;
  /** discover由来: false=最初から両論なし（News直行） */
  debatable?: boolean;
  /** Yahoo!投票の分断スコア */
  externalPollDivision?: number;
  /** コメント摩擦度 */
  commentFrictionScore?: number;
  /** 媒体間の食い違い件数 */
  claimDiffConflictCount?: number;
  /**
   * axis-lock の classifyTopic 結果。
   * stock_crash / corporate 等は News 向きになりやすい。
   */
  topicClass?: string;
}

/**
 * Debate と News のどちらで出すかを決める。
 *
 * - discover で debatable=false → 即 NEWS（コスト高な両論判定をスキップする前提）
 * - 実測の両論シグナルが強い → DEBATE
 * - Legitimacy 不合格 or 経済ショック系で摩擦が薄い → NEWS
 * - それ以外で Legitimate → DEBATE
 */
export function resolveIssueTrack(signals: TrackSignals): IssueTrackId {
  if (signals.debatable === false) return "news";

  const friction = signals.commentFrictionScore ?? 0;
  const pollDiv = signals.externalPollDivision ?? 0;
  const conflicts = signals.claimDiffConflictCount ?? 0;
  const hasStrongDebateSignals =
    pollDiv >= 0.2 || friction >= 0.25 || conflicts >= 1;

  if (signals.legitimate && hasStrongDebateSignals) return "debate";

  const newsishClass =
    signals.topicClass === "stock_crash" ||
    signals.topicClass === "corporate" ||
    signals.topicClass === "tech_social";

  // 経済ショック等で摩擦が薄いのに無理やり Debate にすると軸が苦しい → News
  if (newsishClass && friction < 0.25 && conflicts === 0) return "news";

  if (signals.legitimate) return "debate";
  return "news";
}

export function trackLabel(track: IssueTrackId | null | undefined): string {
  return track === "news" ? "News" : "Debate";
}

export function trackDbEnum(track: IssueTrackId): "DEBATE" | "NEWS" {
  return track === "news" ? "NEWS" : "DEBATE";
}

export function parseIssueTrack(raw: string | null | undefined): IssueTrackId {
  return raw === "NEWS" || raw === "news" ? "news" : "debate";
}
