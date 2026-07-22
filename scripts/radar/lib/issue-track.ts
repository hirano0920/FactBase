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
  /**
   * 討論動画（ABEMA Prime/ReHacQ/NewsPicks等）をGemini動画理解APIが実際に視聴し、
   * track="debate"（賛否が明確に分かれる討論回）と判定済みであることを示す。
   * externalPollDivision/commentFrictionScore/claimDiffConflictCountはテキストニュース向けの
   * 信号で動画由来の候補には存在しないため、これらが無いことを理由に「動画自身が持つ
   * 賛否構造の判定」まで握りつぶさないようにする（この信号はhasStrongDebateSignalsと同格の
   * 強いDebateシグナルとして扱う）。
   */
  videoDebateConfirmed?: boolean;
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
 * 5. 上記のどれにも該当しない（legitimateだが両論シグナルが弱い） → NEWS
 *
 * 旧実装の欠陥: 「摩擦≥0.25なら先にDebate」としていたため、
 * キオクシア急落（摩擦0.51）やiPhone値上げが強制Debate化されていた。
 *
 * 2026-07-22判明の第2の欠陥: 上のステップ5を「legitimate → DEBATE」と誤って実装していたため、
 * hasStrongDebateSignals（実測の両論シグナル）が無いlegitimateな候補まで無条件でDebateになり、
 * 実測7日間でNews:Debate=6:53という狙い(News20:Debate5)の完全な逆転が起きていた。
 * legitimacy（品質ゲート通過）と「両論の対立軸が実在するか」は別の軸であり、
 * 前者を満たすだけで後者を満たしたことにはならない。
 *
 * 2026-07-22判明の第3の欠陥: hasStrongDebateSignals はテキストニュース向けの信号
 * （Yahoo投票・コメント摩擦・媒体食い違い）のみで構成されていたため、
 * ABEMA Prime/ReHacQ/NewsPicks討論動画由来の候補（これらの信号が存在しない）は
 * Geminiが動画を実際に視聴して「討論回」と判定していてもほぼ確実にNewsへ格下げされていた。
 * videoDebateConfirmedをhasStrongDebateSignalsと同格の入力に追加して救済する。
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
  //   ただし討論動画（Gemini実視聴で確認済み）は例外扱いにする — 番組側が
  //   賛否のある論点として編成した回であり、newsishクラスの誤判定より信頼できる。
  if (isNewsishTopicClass(signals.topicClass) && !signals.videoDebateConfirmed) {
    // Yahoo実測投票があり、明らかに割れている場合のみ Debate を許可
    if (hasRealPoll && pollDiv >= 0.35) return "debate";
    return "news";
  }

  if (!signals.legitimate) return "news";

  const hasStrongDebateSignals =
    (hasRealPoll && pollDiv >= 0.2) ||
    friction >= 0.25 ||
    conflicts >= 1 ||
    signals.videoDebateConfirmed === true;

  return hasStrongDebateSignals ? "debate" : "news";
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
