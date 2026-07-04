/**
 * AIクライアント層。
 * - GPT-5 nano: FC判定・通報判定・法令チャンク提案
 * - GPT-5: SEO記事生成（scripts/から使用）
 * 透明性方針: プロンプトは/transparencyで公開する前提で書く。
 */
import OpenAI from "openai";
import { z } from "zod";
import { AI_MODELS } from "@/lib/constants";
import { createOpenAIClient } from "@/lib/openai-client";
import type { FcVerdict } from "@prisma/client";

/** AI応答は不正なJSON・スキーマ崩れがあり得る前提で、常に安全側のフォールバックに倒す */
function safeParseJson<T extends z.ZodType>(raw: string, schema: T): z.infer<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = {};
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : (schema.parse({}) as z.infer<T>);
}

const globalForAi = globalThis as unknown as { openai?: OpenAI };

function getOpenAI(): OpenAI {
  if (!globalForAi.openai) {
    globalForAi.openai = createOpenAIClient({ timeout: 60_000, maxRetries: 2 });
  }
  return globalForAi.openai;
}

/** Radar クラスタリング用（Azure 初回バッチは遅めになりやすい） */
function getOpenAIRadar(): OpenAI {
  return createOpenAIClient({ timeout: 180_000, maxRetries: 2 });
}

export interface FcChunk {
  id: string;
  lawName: string;
  articleRef: string | null;
  text: string;
  /** 出典URL（FC結果に必ず出典リンクを付ける要件） */
  sourceUrl?: string;
  /** 根拠の最終更新日（ISO）。古い根拠での誤判定を防ぐためプロンプトに渡す */
  updatedAt?: string;
}

export interface FcResult {
  verdict: FcVerdict;
  label: string;
  reason: string;
  sourceIds: string[];
}

const FC_RESPONSE_SCHEMA = z.object({
  v: z.string().optional(),
  l: z.string().optional(),
  r: z.string().optional(),
  s: z.array(z.string()).optional(),
});

const DEFAULT_LABELS: Record<FcVerdict, string> = {
  TRUE: "一次情報で確認",
  FALSE: "一次情報と矛盾",
  UNKNOWN: "一次情報では確認不可",
  OPINION: "意見・評価",
  REPORTED: "報道ベース・真偽未確認",
  DISPUTED: "当事者間で対立",
};

// このプロンプトは /transparency で全文公開する（運営方針）
const FC_SYSTEM_PROMPT = `あなたはFactBaseのファクトチェッカーです。日本の一次情報（法令・国会会議録・統計・公式発表・裁判資料）のみに基づき、コメント内の主張を「現時点で確認できる状態」に分類します。真偽を万能に断定するAIではありません。

# 大原則
「報道が存在する」ことと「報道内容が事実である」ことは別問題。前者は確認できても後者の根拠にはならない。

# 手順（この順で必ず実行）
1. コメントから「検証可能な事実主張」を1つ抽出する。複数あれば最も中心的なものを選ぶ
2. 各チャンクを読み、その主張を支持/否定/言及する記述を探す
3. 分類する。根拠は必ずチャンク内の記述に限る

# 判定カテゴリ（厳格に）
- "TRUE": チャンク内の一次情報が主張を直接確認できる場合のみ。「たぶん合ってる」はTRUEにしない
- "FALSE": チャンク内の一次情報と明確に矛盾する場合のみ。表現の違い・解釈の幅がある場合はFALSEにしない
- "REPORTED": 主張の内容が「報道・週刊誌記事の存在」に依拠しており、チャンクで報道の存在は確認できるが内容の真偽を確認できる一次情報がない
- "DISPUTED": 当事者間で主張が対立している、または条文・資料の解釈が分かれることがチャンクから読み取れる
- "UNKNOWN": チャンクに該当する記述がない。これを選ぶことを恐れない（無理な判定より誠実）
- 主張がチャンクの更新日より後の出来事に言及している場合、根拠が古い可能性があるため "UNKNOWN" を選ぶ
- "OPINION": 主張が価値判断・予測・感想（「〜すべき」「〜だろう」「ひどい」）で検証不可能

# labelの付け方（ユーザーに表示される短い分類名）
TRUE→「一次情報で確認」/ 法令根拠なら「条文上確認」/ FALSE→「一次情報と矛盾」/ REPORTED→「報道ベース・真偽未確認」/ DISPUTED→「当事者間で対立」または「解釈が分かれる」/ UNKNOWN→「一次情報では確認不可」/ OPINION→「意見・評価」

# 禁止事項（法的リスク回避・絶対厳守）
- あなたの一般知識・記憶で補完すること（チャンクに書かれていないことは存在しないものとして扱う）
- 「違法」「有罪」「汚職確定」「犯罪者」など、司法判断が確定していない断定表現を理由文に書くこと
- 個別事件への法律助言。法律系は真/誤の断定より「条文上確認」「解釈が分かれる」を優先する
- 政治的立場による判定の偏り（賛成派・反対派どちらのコメントにも同じ厳格さを適用）
- チャンクにない条文番号・数値・固有名詞を理由に書くこと

# 出力（JSONのみ・厳守）
{"v": "TRUE"|"FALSE"|"REPORTED"|"DISPUTED"|"UNKNOWN"|"OPINION", "l": "上記ルールに沿った短いlabel", "r": "判定理由。根拠となるチャンクの記述を簡潔に引用し120字以内（日本語）", "s": ["実際に根拠にしたチャンクIDのみ。根拠なしなら空配列"]}`;

export async function factCheck(commentBody: string, chunks: FcChunk[]): Promise<FcResult> {
  const context = chunks
    .map((c) => {
      const date = c.updatedAt ? `（${c.updatedAt.slice(0, 10)}時点）` : "";
      return `[${c.id}] ${c.lawName}${c.articleRef ? ` ${c.articleRef}` : ""}${date}\n${c.text}`;
    })
    .join("\n---\n");

  const today = new Date().toISOString().slice(0, 10);

  const res = await getOpenAI().chat.completions.create({
    model: AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: FC_SYSTEM_PROMPT },
      {
        role: "user",
        content: `今日の日付: ${today}\n\n# 一次情報チャンク\n${context || "（なし）"}\n\n# 判定対象コメント\n${commentBody}`,
      },
    ],
  });

  const raw = res.choices[0]?.message?.content ?? "{}";
  const parsed = safeParseJson(raw, FC_RESPONSE_SCHEMA);

  const verdictMap: Record<string, FcVerdict> = {
    TRUE: "TRUE",
    FALSE: "FALSE",
    UNKNOWN: "UNKNOWN",
    OPINION: "OPINION",
    REPORTED: "REPORTED",
    DISPUTED: "DISPUTED",
  };
  const verdict = verdictMap[parsed.v ?? ""] ?? "UNKNOWN";
  const validIds = new Set(chunks.map((c) => c.id));

  // ハルシネーション対策の最終ライン: 理由文に断定禁止語が混入したらUNKNOWNに落とす
  const reason = (parsed.r ?? "判定理由を取得できませんでした").slice(0, 200);
  const bannedAssertions = /有罪|犯罪者だ|汚職確定|違法だと断定/;
  const safeReason = bannedAssertions.test(reason)
    ? "一次情報からは断定できないため、確認不可と判定しました"
    : reason;

  return {
    verdict: bannedAssertions.test(reason) ? "UNKNOWN" : verdict,
    label: (parsed.l ?? DEFAULT_LABELS[verdict]).slice(0, 20),
    reason: safeReason,
    sourceIds: (parsed.s ?? []).filter((id) => validIds.has(id)),
  };
}

/**
 * モデレーションAIチェックリスト（/transparencyで公開）。
 * 「9割を自動処理、迷ったら人間へ」の設計: confidenceが低い判定は人間キューに送られる。
 */
const MODERATION_CHECKLIST_PROMPT = `あなたはFactBaseのモデレーターです。通報が閾値に達したコメントを以下のチェックリストで分類してください。

# 違反チェックリスト（1つでも該当すればviolation）
1. abuse: 特定個人への侮辱・人格攻撃（「馬鹿」「クズ」等を人に向ける）
2. threat: 暴力の示唆・脅迫（「殺す」「痛い目に遭わせる」等）
3. discrimination: 属性（国籍・民族・性別・障害・信条等）に基づく差別・煽動
4. defamation_risk: 真偽不明の犯罪断定（「○○は犯罪者」「賄賂を受け取った」を事実として断定）
5. privacy: 一般人の個人名・住所・勤務先等の特定情報
6. spam: 宣伝・無関係な内容の連投
7. sexual: 性的な内容・性犯罪に関する憶測

# 違反ではないもの（重要・こちらに倒す）
- 政策・法案への強い批判（「この法案は最悪だ」「政府の説明は不誠実だ」）
- 政治家の公的行動への批判（「説明責任を果たしていない」）
- 報道の存在への言及（「文春が報じた」）
- 感情的だが誰も攻撃していない表現

# confidence
- 0.9-1.0: チェックリストに明確に該当 or 明確に非該当
- 0.8-0.9: ほぼ確実
- 0.8未満: 文脈依存・風刺かもしれない・判断に迷う → 人間が確認するので正直に低くつける

必ずJSONのみ: {"violation": true/false, "category": "abuse"|"threat"|"discrimination"|"defamation_risk"|"privacy"|"spam"|"sexual"|"none", "confidence": 0.0-1.0, "reason": "80字以内（日本語）"}`;

export interface ModerationJudgement {
  violation: boolean;
  category: string;
  confidence: number;
  reason: string;
}

const MODERATION_RESPONSE_SCHEMA = z.object({
  violation: z.boolean().optional(),
  category: z.string().optional(),
  confidence: z.number().optional(),
  reason: z.string().optional(),
});

export async function judgeModeration(
  commentBody: string,
  reportReasons: string[],
): Promise<ModerationJudgement> {
  const res = await getOpenAI().chat.completions.create({
    model: AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: MODERATION_CHECKLIST_PROMPT },
      {
        role: "user",
        content: `# 通報されたコメント\n${commentBody}\n\n# 通報理由（複数ユーザー）\n${reportReasons.filter(Boolean).join("\n") || "（未記入）"}`,
      },
    ],
  });

  const raw = res.choices[0]?.message?.content ?? "{}";
  const parsed = safeParseJson(raw, MODERATION_RESPONSE_SCHEMA);
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
  return {
    violation: Boolean(parsed.violation),
    category: parsed.category ?? "none",
    confidence,
    reason: (parsed.reason ?? "").slice(0, 120),
  };
}

// このプロンプトは/transparencyで公開する
const ISSUE_QUALITY_PROMPT = `あなたはFactBaseの品質管理担当です。自動生成された争点ページについて、利用者から「この要約はおかしい」という報告が複数寄せられています。報告内容が正当（実際に要約が不正確・的外れ・無関係な内容）かどうかを判定してください。

# 正当とみなすケース
- 要約の内容が見出しと明らかに矛盾している
- 全く無関係な複数の出来事が1つの争点として混ぜられている
- 報告理由が具体的で一貫している（複数人が同じ問題点を指摘）

# 正当とみなさない（＝組織的な妨害の疑いがある）ケース
- 報告理由が空欄または「気に入らない」等の内容を伴わない
- 争点の内容自体は要約として妥当だが、政治的立場が気に入らないだけと読める
- 短時間に不自然に集中している（判断材料がなければconfidenceを下げて正直に答える）

必ずJSONのみ: {"credible": true/false, "confidence": 0.0-1.0, "reason": "80字以内（日本語）"}`;

export interface IssueQualityJudgement {
  credible: boolean;
  confidence: number;
  reason: string;
}

const ISSUE_QUALITY_RESPONSE_SCHEMA = z.object({
  credible: z.boolean().optional(),
  confidence: z.number().optional(),
  reason: z.string().optional(),
});

export async function judgeIssueQuality(
  summaryLead: string,
  reportReasons: string[],
): Promise<IssueQualityJudgement> {
  const res = await getOpenAI().chat.completions.create({
    model: AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ISSUE_QUALITY_PROMPT },
      {
        role: "user",
        content: `# 争点の要約\n${summaryLead}\n\n# 品質報告の理由（複数ユーザー）\n${reportReasons.filter(Boolean).join("\n") || "（理由の記入なし）"}`,
      },
    ],
  });
  const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", ISSUE_QUALITY_RESPONSE_SCHEMA);
  return {
    credible: Boolean(parsed.credible),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
    reason: (parsed.reason ?? "").slice(0, 120),
  };
}

/**
 * Radar: 見出し群のクラスタリング + 分類 + 危険シグナル検出（1回のnano呼び出し）。
 * scripts/radar/detect.ts から使用。
 */
const RADAR_CLASSIFY_PROMPT = `あなたは日本の政治・経済・法律・金融・人権・教育に特化したニュース編集デスクです。
与えられた見出しリストを「同じ出来事」ごとにクラスタリングし、各クラスタを分類してください。

# 最重要: 対象外（クラスタを作らない／作っても必ず risk_flags を付与）
- スポーツ試合結果・順位・得点・W杯・CL・野球・NBA 等の「純粋なスポーツ報道」
- 芸能・ゴシップ・天気予報のみ
- 宇宙探査・科学速報のみ（はやぶさ、小惑星接近等）→ pure_science
- 上記でも「国会・予算・外交・法案・政策・宇宙基本法」と明確に結びつく場合のみ対象

# classification
- official: 政府・省庁・日銀・裁判所・国際機関の公式発表、法案、判決、経済指標
- report: 報道機関による報道（公式確認はまだ）
- scandal: 政治家・団体への疑惑・スキャンダル報道
- incident: 事件・事故・災害・紛争の報道
- indicator: 統計・市場・経済指標

# category（いずれか1つ。スポーツ単体は作らない）
politics / economy / law / finance / rights / education / international
※ international は外交・安保・国際政治のみ。スポーツ大会は不可

# risk_flags（該当するものすべて）
- sports_entertainment: スポーツ・エンタメ・芸能ゴシップが中心（→自動却下）
- pure_science: 科学・宇宙探査の話題が中心で政策議論に結びつかない（→自動却下）
- private_individual: 政治家・著名人でない一般人の個人名が含まれる
- sexual_crime: 性犯罪に関する内容
- minor: 未成年が関係する
- suicide_or_victim: 自殺・被害者の情報
- discrimination: 差別・ヘイトを扱う（報道自体が、ではなく扇動の恐れ）
- unverified_crime_assertion: 真偽不明の犯罪を事実として断定する見出し
- named_politician_allegation: 政治家個人への疑惑（公開可・ただし報道ベースラベル必須）
- crime_related: 犯罪に関連する
- foreign_conflict: 戦争・国際紛争
- health_medical: 医療・健康

# question
クラスタごとに、中立的な投票設問タイトル（「〜をどう見る？」「〜に賛成？反対？」形式、40字以内）と、
投票選択肢3つ（for/against/undecidedの順。疑惑系なら「説明すべき」「問題ない」「報道だけでは判断できない」のように中立に）を作る。
断定・煽り・予断を含めないこと。

必ずJSONのみ:
{"clusters": [{"title": "クラスタの中立的な題", "member_indices": [0,2,5], "classification": "...", "category": "...", "risk_flags": [...], "question": "投票設問", "choices": {"for": "...", "against": "...", "undecided": "..."}}]}`;

export interface RadarCluster {
  title: string;
  member_indices: number[];
  classification: string;
  category: string;
  risk_flags: string[];
  question: string;
  choices: { for: string; against: string; undecided: string };
}

const RADAR_CLUSTER_SCHEMA = z.object({
  title: z.string(),
  member_indices: z.array(z.number()),
  classification: z.string(),
  category: z.string(),
  risk_flags: z.array(z.string()).optional().default([]),
  question: z.string().optional().default(""),
  choices: z
    .object({ for: z.string(), against: z.string(), undecided: z.string() })
    .optional()
    .default({ for: "", against: "", undecided: "" }),
});
const RADAR_CLASSIFY_RESPONSE_SCHEMA = z.object({
  clusters: z.array(RADAR_CLUSTER_SCHEMA).optional().default([]),
});

export async function classifyHeadlines(
  headlines: { index: number; feed: string; title: string }[],
): Promise<RadarCluster[]> {
  const capped = headlines.slice(0, 50);
  const list = capped.map((h) => `${h.index}: [${h.feed}] ${h.title}`).join("\n");
  const res = await getOpenAIRadar().chat.completions.create({
    model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: RADAR_CLASSIFY_PROMPT },
      { role: "user", content: list },
    ],
  });
  const parsed = safeParseJson(
    res.choices[0]?.message?.content ?? "{}",
    RADAR_CLASSIFY_RESPONSE_SCHEMA,
  );
  return parsed.clusters.filter(
    (c) => c.title && Array.isArray(c.member_indices) && c.member_indices.length > 0,
  );
}
