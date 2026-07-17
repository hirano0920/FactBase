/**
 * 軸ロック（Axis Lock）— ⑤.5: 現実の対立軸を証拠から確定し、Writerの芯ズレを防ぐ。
 *
 * # なぜ必要か
 * 従来はassessDebateLegitimacyやassessEvidenceWriteabilityのような「ゲート」はあっても、
 * Writer（記事生成）に「この軸で書け」と明示的に拘束する仕組みが無かった。
 * その結果、LLMが自身の学習データから「それらしい対立」をでっち上げる芯ズレが発生していた。
 *
 * # 改善: 構造的軸生成（Structural Axis Generation）
 * 経済ショック・企業ニュースのように投票データや媒体の食い違いが存在しないトピックでも、
 * トピックの種類に応じた「構造的対立軸」をルールベースで生成する。
 * これにより「賛成/反対」が意味をなさないトピックでも自然な議論の軸を提供できる。
 *
 * # 軸の優先順位（信頼度順）
 * 1. Yahoo!投票の設問＋選択肢 — 編集部が作成した最も明確な軸
 * 2. 複数媒体間の主張の食い違い（claimDiff.conflicts）— 実際の報道の不一致
 * 3. 読者コメントの実際の対立 — SNSで実際に起きている議論
 * 4. 構造的テンプレート — トピック種別に応じたデフォルト軸（データ不足時のセーフティネット）
 */
import { z } from "zod";
import { createOpenAIClient } from "../../../src/lib/openai-client";
import { AI_MODELS } from "../../../src/lib/constants";
import type { ClaimDiffResult } from "./claim-diff";

export interface AxisLockInput {
  topic: string;
  /** Yahoo!投票の設問（最も信頼できる軸があれば） */
  voteQuestion?: string;
  /** Yahoo!投票の選択肢ラベル */
  pollChoices?: { choice: string; count: number; percent: number }[];
  /** 媒体間の主張の食い違い（claimDiff.conflicts） */
  claimDiffConflicts?: string[];
  /** 読者コメント本文（最大10件） */
  commentSamples?: { text: string; empathyCount: number; insightCount: number; negativeCount: number }[];
  /** 報道の見出し */
  newsTitles?: string[];
}

export interface AxisLockResult {
  /** 論争の軸を一文で（例: 「SNSでの発言を理由にした解職請求は表現の自由の範囲内か」） */
  axis: string;
  /** 片方の立場のラベル（例: 「処分は表現の自由の侵害」） */
  sideA: string;
  /** もう片方の立場のラベル（例: 「公務員としての品位保持義務違反」） */
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
- 軸の根拠は「現実のデータ（投票設問・報道の食い違い・コメント）」でなければならない。

# トピックの種類に応じた軸のフレーミング
法律/政策/制度改正 → 「賛成か反対か」「支持するか不支持か」（最もシンプル）
政治スキャンダル/倫理問題 → 「擁護すべきか批判すべきか」「説明責任を果たしたか」
外交/地政学リスク → 「評価するか批判するか」「リスク認識の差は何か」
経済ショック/株価暴落/企業危機 → **「どのように捉えるべきか」**（例: 一時的調整か構造変化か、妥当な判断か過剰反応か、日本経済への影響は限定的か深刻か）
社会現象/技術革新 → 「どう評価すべきか」「メリットがデメリットかを上回るか」

# 経済ショック/企業イベントの軸の考え方（重要）
キオクシアのような「特許賠償→株価暴落」のトピックでは「賛成/反対」は意味をなさない。
代わりに以下のような軸が適切:
- 「今回の出来事の本質は何か: バブル崩壊/一時的な調整/個別企業の問題」
- 「特許訴訟の判決は妥当か/厳しすぎるか」（妥当性軸）
- 「日本経済への影響は限定的か/深刻か」（影響軸）
- 「この出来事から何を学ぶべきか」（教訓軸）

# 情報源の優先順位（上位が最も信頼できる）
1. 投票設問・選択肢: 編集部が作成した公式な軸。これが最も明確な根拠。
2. 媒体間の食い違い（claimDiff.conflicts）: 複数媒体間で実際に主張が食い違っている点。これが現実の論点。
3. 読者コメント: 実際の読者が議論しているテーマ。
4. 報道の見出し: 最も弱いが補助的な手がかり。

# 出力（JSONのみ）
- axis: 現実の対立を反映した問い（30〜80字）。文末は「〜か」「〜かどうか」「〜なのか」のいずれか。
  ※ 経済ショックの場合は「どのように捉えるべきか」や「〜なのか、〜なのか」の形式も許容。
- sideA: axisに対する一方の立場（10〜40字）。「賛成」「反対」の単純ラベルではなく、具体的な立場を書く。
- sideB: axisに対するもう一方の立場（10〜40字）。同上。

必ずJSONのみで回答してください。`;

/**
 * トピックの種別をキーワードから判定する。
 * 構造的テンプレート選択のための分類。
 */
export function classifyTopic(topic: string): string {
  const t = topic;
  // 株価/経済ショック
  if (/暴落|急落|下落|時価総額|株価|バブル|景気|不況|GDP|失業率|インフレ|デフレ/.test(t)) return "stock_crash";
  // 企業ニュース
  if (/特許|賠償|訴訟|提携|買収|投資|倒産|破綻|上場|新規公開|決算|増収|減収/.test(t)) return "corporate";
  // 法律/制度
  if (/法案|改正|可決|成立|制定|制度|法$|罰則|規制|義務化/.test(t)) return "legal";
  // 外交/地政学
  if (/イラン|ウクライナ|ロシア|中国|北朝鮮|安保|防衛|制裁|軍事|NATO|ミサイル/.test(t)) return "geopolitics";
  // スキャンダル
  if (/疑惑|問題|批判|謝罪|不祥事|隠蔽|不正|告発|逮捕|捜査/.test(t)) return "scandal";
  // 政治/人事
  if (/選挙|内閣|総理|大臣|知事|市長|辞任|更迭|政局/.test(t)) return "politics";
  // 社会/技術
  if (/AI|人工知能|技術|研究|開発|宇宙|気候|環境|温暖化/.test(t)) return "tech_social";
  return "other";
}

/**
 * トピック種別に基づく構造的対立軸テンプレート。
 * データ（投票・claimDiff・コメント）が不足していても、
 * トピックの性質から自然な議論の軸を提供する。
 */
export function structuralAxis(
  topic: string,
  category?: string,
): AxisLockResult {
  const t = topic;
  const type = classifyTopic(t);

  // 株価暴落/経済ショック
  if (type === "stock_crash") {
    return {
      axis: `${t}、この経済変動をどう捉えるべきか：一時的な調整か、構造的な転換点か`,
      sideA: "一時的な調整・買い増しの好機と捉えるべき",
      sideB: "構造的な下落・警戒してリスク回避すべき",
    };
  }

  // 企業ニュース（特許訴訟/賠償命令/買収/倒産）
  if (type === "corporate") {
    // 特許訴訟/賠償命令系
    if (/特許|賠償|訴訟/.test(t)) {
      return {
        axis: `${t}、この判決・判断は妥当か：企業にとっての教訓と今後の影響は`,
        sideA: "妥当な判断・これを機に企業統治や知的財産戦略が見直される",
        sideB: "過剰な判断・競争力や業界全体への悪影響が懸念される",
      };
    }
    // 買収/提携系
    if (/買収|提携|M&A/.test(t)) {
      return {
        axis: `${t}、この経営判断は正しかったのか：成長戦略として評価すべきか`,
        sideA: "成長戦略として評価・長期的な企業価値向上につながる",
        sideB: "リスクが大きい・経営資源の分散や過大評価の懸念がある",
      };
    }
    // 倒産/破綻系
    if (/倒産|破綻/.test(t)) {
      return {
        axis: `${t}、この事態はなぜ起きたのか：経営責任と再発防止策は十分か`,
        sideA: "経営陣の責任が大きい・ガバナンス改善が必要",
        sideB: "外部環境の変化が主因・制度や規制の見直しが必要",
      };
    }
    // 汎用企業ニュース
    return {
      axis: `${t}、この出来事をどう評価すべきか：ポジティブな材料かネガティブな材料か`,
      sideA: "ポジティブに評価・企業や業界にとって前向きな展開",
      sideB: "ネガティブに評価・リスクや課題が顕在化した",
    };
  }

  // 法律/制度
  if (type === "legal") {
    return {
      axis: `${t}、この制度変更に賛成か反対か`,
      sideA: "賛成・制度変更を支持する",
      sideB: "反対・制度変更に慎重であるべき",
    };
  }

  // 外交/地政学
  if (type === "geopolitics") {
    return {
      axis: `${t}、日本の立場としてどう対応すべきか`,
      sideA: "積極的に関与・対応すべき",
      sideB: "慎重に対応・巻き込まれるべきでない",
    };
  }

  // スキャンダル
  if (type === "scandal") {
    return {
      axis: `${t}、この問題の責任はどこにあるのか：当事者か制度か`,
      sideA: "当事者の責任が重い・厳格な対応が必要",
      sideB: "制度や環境に問題がある・構造的な改善が必要",
    };
  }

  // 政治/人事
  if (type === "politics") {
    if (/辞任|更迭/.test(t)) {
      return {
        axis: `${t}、この人事判断は妥当か`,
        sideA: "妥当な判断・組織としての責任の取り方として適切",
        sideB: "問題がある・交代では根本解決にならない",
      };
    }
    return {
      axis: `${t}、この政治判断を支持するか不支持か`,
      sideA: "支持する・適切な判断だ",
      sideB: "不支持・問題のある判断だ",
    };
  }

  // 技術/社会
  if (type === "tech_social") {
    return {
      axis: `${t}、この技術・社会変化をどう評価すべきか：メリットとリスクは`,
      sideA: "積極的に評価・進歩として歓迎すべき",
      sideB: "慎重に評価・リスクや倫理的問題を重視すべき",
    };
  }

  // 汎用フォールバック
  return {
    axis: `${t}について、現状をどう評価すべきか：肯定的に見るか批判的に見るか`,
    sideA: "肯定的に評価する・前向きな展開と捉える",
    sideB: "批判的に評価する・問題点を重視すべき",
  };
}

/**
 * 証拠から論争の軸を抽出・ロックする。
 *
 * fail-open: データ（投票・claimDiff・コメント）が不足していても、
 * トピックの種別に基づく構造的軸を生成する。
 * これにより経済ショックのような「賛成/反対」が意味をなさないトピックでも
 * 自然な議論の軸を提供できる。
 */
export async function buildLockedAxis(input: AxisLockInput): Promise<AxisLockResult | null> {
  // 情報源が少なすぎる → LLM軸ロック不能。
  // ただし構造的軸（structuralAxis）があればそれを使う（fail-open）。
  const hasData =
    !!input.voteQuestion ||
    (input.claimDiffConflicts && input.claimDiffConflicts.length > 0) ||
    (input.commentSamples && input.commentSamples.length > 0) ||
    (input.newsTitles && input.newsTitles.length > 0);

  if (!hasData) {
    // データ不足でも諦めない: 構造的軸を生成
    return structuralAxis(input.topic);
  }

  const parts: string[] = [];
  parts.push(`# トピック\n${input.topic}`);

  if (input.voteQuestion) {
    const choices = input.pollChoices
      ? input.pollChoices.map((c) => `  - ${c.choice}（${c.percent}%）`).join("\n")
      : "";
    parts.push(`# Yahoo!投票（最優先軸）\n設問: ${input.voteQuestion}\n選択肢:\n${choices}`);
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
      // LLM軸ロックに失敗しても構造的軸でフォールバック
      return structuralAxis(input.topic);
    }
    return parsed.data;
  } catch {
    // LLM呼び出し失敗でも構造的軸でフォールバック
    return structuralAxis(input.topic);
  }
}
