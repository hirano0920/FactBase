/**
 * 軸ロック（Axis Lock）— ⑤.5: 現実の対立軸を証拠から確定し、Writerの芯ズレを防ぐ。
 *
 * # なぜ必要か
 * 従来はassessDebateLegitimacyやassessEvidenceWriteabilityのような「ゲート」はあっても、
 * Writer（記事生成）に「この軸で書け」と明示的に拘束する仕組みが無かった。
 * その結果、LLMが自身の学習データから「それらしい対立」をでっち上げる芯ズレが発生していた。
 *
 * # 情報源の優先順位（2026-07-18修正）
 * 1. Yahoo!投票の設問＋選択肢 — 編集部が作成した実測軸のみ（AI仮設問は使わない）
 * 2. 複数媒体間の主張の食い違い（claimDiff.conflicts）
 * 3. 読者コメントの実際の対立
 * 4. 構造的テンプレート — トピック種別のデフォルト軸
 *
 * ★ 絶対にやってはいけないこと:
 * discover段階の AI 仮設問（evidence.voteQuestion）を「Yahoo!投票」として最優先すること。
 * これがれいわ辞任を「辞任の容認？」に固定した根因。
 */
import { z } from "zod";
import { createOpenAIClient } from "../../../src/lib/openai-client";
import { AI_MODELS } from "../../../src/lib/constants";

export interface AxisLockInput {
  topic: string;
  /**
   * Yahoo!投票の設問のみ。AIがdiscoverで作った仮設問は渡さないこと。
   * promote.ts は externalPoll?.question だけを渡す。
   */
  yahooPollQuestion?: string;
  /** Yahoo!投票の選択肢ラベル */
  pollChoices?: { choice: string; count: number; percent: number }[];
  /** 媒体間の主張の食い違い（claimDiff.conflicts） */
  claimDiffConflicts?: string[];
  /** 読者コメント本文（最大10件） */
  commentSamples?: { text: string; empathyCount: number; insightCount: number; negativeCount: number }[];
  /** 報道の見出し */
  newsTitles?: string[];
  /**
   * @deprecated AI仮設問。後方互換のため残すが軸の優先根拠には使わない。
   */
  voteQuestion?: string;
}

export interface AxisLockResult {
  /** 論争の軸を一文で */
  axis: string;
  /** 片方の立場のラベル */
  sideA: string;
  /** もう片方の立場のラベル */
  sideB: string;
}

const AXIS_LOCK_SCHEMA = z.object({
  axis: z.string().min(5),
  sideA: z.string().min(2),
  sideB: z.string().min(2),
});

const AXIS_LOCK_SYSTEM = `あなたはリサーチアシスタントです。与えられた論争について、実際に起きている対立の軸を特定してください。

# 重要: 絶対に創作しないこと
- 与えられた情報に基づいて軸を特定する。情報にない対立軸を想像してはいけない。
- 軸の根拠は「現実のデータ（Yahoo投票・報道の食い違い・コメント）」でなければならない。

# トピックの種類に応じた軸のフレーミング
法律/政策/制度改正 → 「賛成か反対か」「支持するか不支持か」
政党代表の辞任・党運営 → 「党は存続・再生できるか」「求心力を失うか」（辞任そのものの容認は軸にしない）
政治スキャンダル/倫理問題 → 「説明責任を果たしたか」「制度の問題か」
外交/地政学リスク → 「評価するか批判するか」
経済ショック/株価暴落/企業危機/値上げ → News向き。無理に賛否にしない。影響の見方の違いだけを軸にする

# 禁止
- 「容認できる？できない？」「擁護？批判？」のような抽象極性だけの軸
- 辞任ニュースで「辞任は妥当か」に矮小化すること（党の将来・組織の存続が本質のことが多い）

# 情報源の優先順位
1. Yahoo!投票（実測）: 編集部が作った公式な軸
2. 媒体間の食い違い
3. 読者コメント
4. 報道の見出し

# 出力（JSONのみ）
- axis: 現実の対立を反映した問い（30〜80字）
- sideA / sideB: 具体的な立場（10〜40字）。「賛成」「反対」の単純ラベル禁止

必ずJSONのみで回答してください。`;

/**
 * トピックの種別をキーワードから判定する。
 */
export function classifyTopic(topic: string): string {
  const t = topic;
  // 株価/経済ショック（News向き）
  if (/暴落|急落|下落|時価総額|株価|バブル|景気|不況|GDP|失業率|インフレ|デフレ/.test(t)) {
    return "stock_crash";
  }
  // 消費者価格・料金改定（News向き。iPhone値上げ等がここに入る）
  if (/値上げ|価格改定|販売価格|料金改定|値下げ|値上がり/.test(t)) {
    return "consumer_price";
  }
  // 企業ニュース（News向き）
  if (/特許|賠償|訴訟|提携|買収|投資|倒産|破綻|上場|新規公開|決算|増収|減収/.test(t)) {
    return "corporate";
  }
  // 事実優位のスキャンダル（News向き。「擁護/批判」に無理にしない）
  if (/利益相反|インサイダー|株購入.*宣伝|宣伝.*株購入/.test(t)) {
    return "fact_scandal";
  }
  // 法律/制度
  if (/法案|改正|可決|成立|制定|制度|法$|罰則|規制|義務化|損壊罪|典範/.test(t)) {
    return "legal";
  }
  // 外国戦場の兵器・AI兵器速報（News向き。Debate軸が立ちにくい）
  if (/ウクライナ/.test(t) && /ドローン|AI|反攻|反撃|兵器/.test(t)) {
    return "war_tech_foreign";
  }
  // 懸賞金・暗殺示唆など奇行ネタ（News向き）
  if (/懸賞金|暗殺示唆|賞金.*表明/.test(t)) {
    return "foreign_spectacle";
  }
  // 外交/地政学
  if (/イラン|ウクライナ|ロシア|中国|北朝鮮|安保|防衛|制裁|軍事|NATO|ミサイル|ホルムズ/.test(t)) {
    return "geopolitics";
  }
  // 一般スキャンダル
  if (/疑惑|問題|批判|謝罪|不祥事|隠蔽|不正|告発|逮捕|捜査/.test(t)) {
    return "scandal";
  }
  // 政治/人事
  if (/選挙|内閣|総理|大臣|知事|市長|辞任|更迭|政局|新選組|政党/.test(t)) {
    return "politics";
  }
  // 社会/技術
  if (/AI|人工知能|技術|研究|開発|宇宙|気候|環境|温暖化/.test(t)) {
    return "tech_social";
  }
  return "other";
}

/** classifyTopicの分類のうち、政治・国際安保・法制度系（フラッグシップWriter対象）かどうか */
const POLITICAL_TOPIC_CLASSES = new Set([
  "legal",
  "geopolitics",
  "scandal",
  "politics",
  "fact_scandal",
  "war_tech_foreign",
  "foreign_spectacle",
]);

export function isPoliticalTopicClass(topicClass: string): boolean {
  return POLITICAL_TOPIC_CLASSES.has(topicClass);
}

/**
 * トピック種別に基づく構造的対立軸テンプレート。
 */
export function structuralAxis(topic: string, _category?: string): AxisLockResult {
  const t = topic;
  const type = classifyTopic(t);

  if (type === "stock_crash") {
    return {
      axis: `${t}の影響をどう見るべきか：一時的な市場反応か、実体経済への波及か`,
      sideA: "市場の一時的な反応・個別要因の消化と捉える",
      sideB: "実体経済や投資家心理への波及を警戒すべき",
    };
  }

  if (type === "consumer_price") {
    return {
      axis: `${t}をどう受け止めるべきか：円安・コスト転嫁として理解するか、消費者負担として問題視するか`,
      sideA: "為替・コストを反映した調整として理解する",
      sideB: "消費者負担の増加として問題視する",
    };
  }

  if (type === "corporate") {
    if (/特許|賠償|訴訟/.test(t)) {
      return {
        axis: `${t}、この判決・判断の意味は何か：個別企業の問題か、業界全体への警鐘か`,
        sideA: "個別企業の知財リスクが顕在化した事案と見る",
        sideB: "業界全体の競争力や投資環境への警鐘と見る",
      };
    }
    if (/倒産|破綻/.test(t)) {
      return {
        axis: `${t}、この事態の本質は何か：経営責任か、規制・制度の隙間か`,
        sideA: "経営陣の責任が大きい・ガバナンス改善が必要",
        sideB: "制度や規制の隙間が主因・再発防止の制度改正が必要",
      };
    }
    return {
      axis: `${t}、この出来事をどう評価すべきか`,
      sideA: "企業・業界にとって前向きな材料と捉える",
      sideB: "リスクや課題が顕在化したと捉える",
    };
  }

  if (type === "fact_scandal") {
    return {
      axis: `${t}、説明責任とルール整備のどちらを優先すべきか`,
      sideA: "当事者の説明責任と透明性を最優先すべき",
      sideB: "再発防止のためのルール・開示義務の強化を優先すべき",
    };
  }

  if (type === "war_tech_foreign") {
    return {
      axis: `${t}、戦況・兵器動向としてどう整理すべきか`,
      sideA: "軍事・技術面の進展として注視すべき",
      sideB: "人道・停戦の観点から慎重に見るべき",
    };
  }

  if (type === "foreign_spectacle") {
    return {
      axis: `${t}、報道としてどう捉えるべきか`,
      sideA: "重大な安全保障・政治リスクとして注視すべき",
      sideB: "過剰報道・扇動と見る",
    };
  }

  if (type === "legal") {
    return {
      axis: `${t}、この制度変更に賛成か反対か`,
      sideA: "賛成・制度変更を支持する",
      sideB: "反対・制度変更に慎重であるべき",
    };
  }

  if (type === "geopolitics") {
    return {
      axis: `${t}、日本の立場としてどう対応すべきか`,
      sideA: "積極的に関与・対応すべき",
      sideB: "慎重に対応・巻き込まれるべきでない",
    };
  }

  if (type === "scandal") {
    return {
      axis: `${t}、この問題の責任はどこにあるのか：当事者か制度か`,
      sideA: "当事者の責任が重い・厳格な対応が必要",
      sideB: "制度や環境に問題がある・構造的な改善が必要",
    };
  }

  if (type === "politics") {
    // ★ 代表辞任・党運営: 「辞任の容認」ではなく党の将来を軸にする
    if (/辞任|更迭/.test(t) && /党|新選組|代表/.test(t)) {
      return {
        axis: `${t}の後、党は求心力を維持して存続できるのか、それとも縮小が避けられないのか`,
        sideA: "新体制で独自路線を維持し、党は再生・存続できる",
        sideB: "カリスマ依存が強く、求心力低下と党勢縮小が避けられない",
      };
    }
    if (/辞任|更迭/.test(t)) {
      return {
        axis: `${t}、この人事判断は組織の再生につながるか、混乱を招くか`,
        sideA: "再生につながる・責任の取り方として適切",
        sideB: "混乱を招く・交代だけでは根本解決にならない",
      };
    }
    return {
      axis: `${t}、この政治判断を支持するか不支持か`,
      sideA: "支持する・適切な判断だ",
      sideB: "不支持・問題のある判断だ",
    };
  }

  if (type === "tech_social") {
    return {
      axis: `${t}、この技術・社会変化をどう評価すべきか`,
      sideA: "積極的に評価・進歩として歓迎すべき",
      sideB: "慎重に評価・リスクや倫理的問題を重視すべき",
    };
  }

  return {
    axis: `${t}について、現状をどう評価すべきか`,
    sideA: "肯定的に評価する・前向きな展開と捉える",
    sideB: "批判的に評価する・問題点を重視すべき",
  };
}

/**
 * 証拠から論争の軸を抽出・ロックする。fail-open。
 */
export async function buildLockedAxis(input: AxisLockInput): Promise<AxisLockResult | null> {
  // Yahoo実測投票のみを最優先軸にする（AI仮設問は使わない）
  const yahooQuestion = input.yahooPollQuestion?.trim() || undefined;

  const hasData =
    !!yahooQuestion ||
    (input.claimDiffConflicts && input.claimDiffConflicts.length > 0) ||
    (input.commentSamples && input.commentSamples.length > 0) ||
    (input.newsTitles && input.newsTitles.length > 0);

  if (!hasData) {
    return structuralAxis(input.topic);
  }

  const parts: string[] = [];
  parts.push(`# トピック\n${input.topic}`);

  if (yahooQuestion) {
    const choices = input.pollChoices
      ? input.pollChoices.map((c) => `  - ${c.choice}（${c.percent}%）`).join("\n")
      : "";
    parts.push(`# Yahoo!投票（実測・最優先軸）\n設問: ${yahooQuestion}\n選択肢:\n${choices}`);
  }

  if (input.claimDiffConflicts && input.claimDiffConflicts.length > 0) {
    parts.push(
      `# 媒体間の食い違い（優先軸）\n${input.claimDiffConflicts.map((c) => `  - ${c}`).join("\n")}`,
    );
  }

  if (input.commentSamples && input.commentSamples.length > 0) {
    parts.push(
      `# 読者コメントの意見\n${input.commentSamples
        .map((c) => `  - 「${c.text.slice(0, 100)}」(共感:${c.empathyCount} 批判:${c.negativeCount})`)
        .join("\n")}`,
    );
  }

  if (input.newsTitles && input.newsTitles.length > 0) {
    parts.push(
      `# 報道の見出し\n${input.newsTitles.map((t) => `  - ${t}`).join("\n")}`,
    );
  }

  try {
    const openai = createOpenAIClient({ timeout: 30_000, maxRetries: 1 });
    const res = await openai.chat.completions.create({
      model: AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: AXIS_LOCK_SYSTEM },
        { role: "user", content: parts.join("\n\n") },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = AXIS_LOCK_SCHEMA.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return structuralAxis(input.topic);
    }
    return parsed.data;
  } catch {
    return structuralAxis(input.topic);
  }
}
