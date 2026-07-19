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
  /** Yahoo!投票の分断スコア（実測のみ。AI仮設問は含めない） */
  externalPollDivision?: number;
  /** コメント摩擦度 */
  commentFrictionScore?: number;
  /** 媒体間の食い違い件数 */
  claimDiffConflictCount?: number;
  /**
   * axis-lock の classifyTopic 結果。
   * stock_crash / corporate / consumer_price 等は News 向き。
   */
  topicClass?: string;
  /**
   * Yahoo!リアル投票が実在するか。
   * AIがdiscoverで作った仮設問は false。これがない限り newsish は Debate にしない。
   */
  hasRealExternalPoll?: boolean;
}

/** News向きクラス: 摩擦コメントがあっても「賛否の軸」が自然に立たない類型 */
export function isNewsishTopicClass(topicClass: string | null | undefined): boolean {
  return (
    topicClass === "stock_crash" ||
    topicClass === "corporate" ||
    topicClass === "consumer_price" ||
    topicClass === "tech_social" ||
    topicClass === "fact_scandal" ||
    topicClass === "war_tech_foreign" ||
    topicClass === "foreign_spectacle"
  );
}

/**
 * Debate と News のどちらで出すかを決める。
 *
 * 順序が重要（2026-07-18 PDCA Day2 事故の根因）:
 * 1. debatable=false → 即 NEWS
 * 2. newsishクラス → 原則 NEWS。Yahoo実測投票で明確に割れている時だけ Debate
 * 3. Legitimacy不合格 → NEWS
 * 4. 実測の両論シグナルが強い＋legitimate → DEBATE
 * 5. legitimate → DEBATE / それ以外 NEWS
 *
 * 旧実装の欠陥: 「摩擦≥0.25なら先にDebate」としていたため、
 * キオクシア急落（摩擦0.51）やiPhone値上げが強制Debate化されていた。
 */
export function resolveIssueTrack(signals: TrackSignals): IssueTrackId {
  if (signals.debatable === false) return "news";

  const friction = signals.commentFrictionScore ?? 0;
  const pollDiv = signals.externalPollDivision ?? 0;
  const conflicts = signals.claimDiffConflictCount ?? 0;
  const hasRealPoll = signals.hasRealExternalPoll === true;

  // ★ newsish を先に判定。コメント摩擦や媒体差分だけでは Debate にしない。
  //   「株が下がった」「値が上がった」「巨額賠償」は事実速報であり、
  //   読者の不満コメント ≠ 両論の対立軸。
  if (isNewsishTopicClass(signals.topicClass)) {
    // Yahoo実測投票があり、明らかに割れている場合のみ Debate を許可
    if (hasRealPoll && pollDiv >= 0.35) return "debate";
    return "news";
  }

  if (!signals.legitimate) return "news";

  const hasStrongDebateSignals =
    (hasRealPoll && pollDiv >= 0.2) || friction >= 0.25 || conflicts >= 1;

  if (hasStrongDebateSignals) return "debate";
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
