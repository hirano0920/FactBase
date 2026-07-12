/**
 * AIクライアント層。
 * - GPT-5 nano: FC判定・通報判定・法令チャンク提案
 * - GPT-5: SEO記事生成（scripts/から使用）
 * 透明性方針: プロンプトは/transparencyで公開する前提で書く。
 */
import OpenAI from "openai";
import { z } from "zod";
import { AI_MODELS, RADAR, SITE, VOTE_CHOICE_MAX_CHARS } from "@/lib/constants";
import { createOpenAIClient } from "@/lib/openai-client";
import { resolveDebateType, debateTypeChoiceHint, debateTypeTitleHint, type DebateType } from "@/lib/debate-type";
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
  sourceName: string;
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
const FC_SYSTEM_PROMPT = `あなたは${SITE.name}のファクトチェッカーです。日本の一次情報（法令・国会会議録・統計・公式発表・裁判資料）のみに基づき、コメント内の主張を「現時点で確認できる状態」に分類します。真偽を万能に断定するAIではありません。

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
      return `[${c.id}] ${c.sourceName}${c.articleRef ? ` ${c.articleRef}` : ""}${date}\n${c.text}`;
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

// このプロンプトは /transparency で公開する
const STEELMAN_PROMPT = `あなたは${SITE.name}の「論点提示AI」です。ある争点について、まだ誰も投稿していない側の
最も説得力のある主張を、与えられた記事の材料だけを根拠に代弁します。あなた自身の意見ではありません。

# 絶対ルール
- 与えられた記事の要点・本文に書かれている事実・論点のみを根拠にする。憶測・独自の断定は禁止
- 「その立場に立つとすれば最も筋が通った主張は何か」を中立に代弁する。攻撃的・煽り的な表現は使わない
- 個人・団体への人格攻撃、名誉毀損になりうる断定はしない
- 100〜180字程度、1〜3文。コメント欄の投稿として自然な文体（です・ます調）

# 出力（JSONのみ）
{"argument": "..."}`;

const STEELMAN_SCHEMA = z.object({ argument: z.string().optional().default("") });

export interface SteelmanInput {
  issueTitle: string;
  lead: string;
  bullets: string[];
  /** 代弁する立場（"for"=賛成側の主張を書く、"against"=反対側） */
  stance: "for" | "against";
}

/**
 * スプリットスレッドの片側が空のとき、記事の材料だけを根拠に「その立場の最も筋が通った主張」を
 * 生成する（コールドスタート対策）。人間の投稿と明確に区別できるよう、呼び出し側で
 * isAiSteelman=true のラベルを付けて表示すること。DBには保存しない（人間投稿が来たら自然に降格させるため）。
 */
export async function generateSteelman(input: SteelmanInput): Promise<string> {
  const stanceLabel = input.stance === "for" ? "賛成" : "反対";
  const res = await getOpenAI().chat.completions.create({
    model: AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: STEELMAN_PROMPT },
      {
        role: "user",
        content: `争点: ${input.issueTitle}\n要点: ${input.lead}\n論点:\n${input.bullets.map((b) => `- ${b}`).join("\n")}\n\n代弁する立場: ${stanceLabel}`,
      },
    ],
  });
  const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", STEELMAN_SCHEMA);
  return parsed.argument.trim().slice(0, 300);
}

const REBUTTAL_PROMPT = `あなたは${SITE.name}のレスバ支援AIです。争点記事の素材だけを根拠に、相手側の主張に対する反論候補を提示します。

# 鉄則
- 人格攻撃・侮辱・煽りは禁止
- 争点素材に書かれていない事実を捏造しない
- 論理の弱点・事実のズレ・出典との矛盾に限定
- 各候補は80字以内、です・ます調

# 出力（JSONのみ）
{"cards": ["反論候補1", "反論候補2", "反論候補3"]}`;

const REBUTTAL_SCHEMA = z.object({
  cards: z.array(z.string()).optional().default([]),
});

export interface RebuttalInput {
  issueTitle: string;
  lead: string;
  bullets: string[];
  /**
   * 記事本文の対立軸セクション（賛成側/反対側等、articleHtmlから抽出済みのプレーンテキスト）。
   * summaryJson.bulletsは1行要約止まりだが、こちらは3〜4項目・具体点付きの本来の両論材料。
   * 未提供（旧データ・articleHtml無し）ならbulletsだけで従来通り生成する。
   */
  articleDetail?: string;
  /** 反論対象のコメント本文 */
  opponentComment: string;
  /** 自分の立場 */
  myStance: "for" | "against";
}

/** Plus向けレスバ支援 — 争点素材から反論候補を3つ生成 */
export async function generateRebuttalCards(input: RebuttalInput): Promise<string[]> {
  const myLabel = input.myStance === "for" ? "賛成" : "反対";
  const detailBlock = input.articleDetail
    ? `\n記事本文の両論詳細:\n${input.articleDetail.slice(0, 2000)}`
    : "";
  const res = await getOpenAI().chat.completions.create({
    model: AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: REBUTTAL_PROMPT },
      {
        role: "user",
        content: `争点: ${input.issueTitle}\n要点: ${input.lead}\n論点:\n${input.bullets.map((b) => `- ${b}`).join("\n")}${detailBlock}\n\n自分の立場: ${myLabel}\n相手の主張:\n${input.opponentComment.slice(0, 500)}`,
      },
    ],
  });
  const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", REBUTTAL_SCHEMA);
  return parsed.cards.map((c) => c.trim().slice(0, 120)).filter(Boolean).slice(0, 3);
}

/**
 * モデレーションAIチェックリスト（/transparencyで公開）。
 * 「9割を自動処理、迷ったら人間へ」の設計: confidenceが低い判定は人間キューに送られる。
 */
const MODERATION_CHECKLIST_PROMPT = `あなたは${SITE.name}のモデレーターです。通報が閾値に達したコメントを以下のチェックリストで分類してください。

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
const ISSUE_QUALITY_PROMPT = `あなたは${SITE.name}の品質管理担当です。自動生成された争点ページについて、利用者から「この要約はおかしい」という報告が複数寄せられています。報告内容が正当（実際に要約が不正確・的外れ・無関係な内容）かどうかを判定してください。

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
- disaster: 大規模災害（震度6弱以上の地震・津波・噴火・特別警報級の台風豪雨・大規模火災/山火事等。震度5以下や日常の天気は対象外）
- health_medical: 医療・健康

# question（争点タイトル＝一覧で最初に見える見出し）
55字以内・必ず日本語。
1) **何が起きたか**（数値・法案名・決定内容）を入れる
2) **一般の人の「自分ごと」**が伝わるフックを入れる（生活・お金・安全・仕事・税金・子ども等への影響）
 wire見出しだけで終わらない。「だから何？」とならないこと。
- 悪:「EU、2030年再エネ50%目標を表明——支持？」→ 専門家向け、一般人はスルー
- 良:「欧州の再エネ半分宣言——日本の電気代に波及？」
- 良:「日銀利上げ、住宅ローンはどうなる？」
- 良:「入管法改正可決——在日外国人増で生活変わる？」
抽象語だけ（「EU公式発表」「声明をどう見る」）は禁止。

choicesは常にfor/against/undecidedの3キーで返すが、文言は実際の対立軸に合わせてAIが自由に作ってよい
（「賛成/反対」に無理にはめ込まない）。
- 単純な賛成/反対が成立する話題（法案・政策等）: 「賛成」「反対」「わからない」に近い言葉でよい
- 複数の対応・立場が並立し賛成/反対が不自然な話題: forとagainstに実際に対立する2つの立場・対応を当て、
  undecidedは「どちらとも言えない」「判断に必要な情報がまだ足りない」等にする
  （例: for="対応Aを支持", against="対応Bを支持", undecided="どちらとも言えない"）
- 疑惑・スキャンダル系: 「説明すべき」「問題ない」「報道だけでは判断できない」のように中立に
断定・煽り・一方の立場に不利な言葉選びは禁止。どちらの立場のユーザーも押しやすい言葉にする。

# 続報判定（match_issue_id）
「既に公開中の争点一覧」が渡された場合、クラスタが一覧のいずれかの続報（同一の出来事の新しい展開）だと判断できれば、
match_issue_id にその争点の id を設定すること。新しい別の出来事であれば match_issue_id は null のままにする。
迷う場合や一覧に該当がなければ必ず null にする（誤って別の出来事に紐付けない）。

# 未公開候補との同一性判定（match_candidate_id）
「まだ公開されていない候補一覧」が渡された場合、クラスタがそのいずれかと同じ出来事（審議中の同じ法案の新しい報道、
まだ閾値未達の同じ事案の追加報道など）だと判断できれば、match_candidate_id にその候補の id を設定すること。
これは「毎回タイトルの言い回しが変わっても同じ出来事だと認識して証拠を積み上げる」ための仕組みなので、
表現が違っても指している出来事が同じなら積極的に一致させてよい。新しい別の出来事なら null のままにする。

必ずJSONのみ:
{"clusters": [{"title": "クラスタの中立的な題", "member_indices": [0,2,5], "classification": "...", "category": "...", "risk_flags": [...], "question": "投票設問", "choices": {"for": "...", "against": "...", "undecided": "..."}, "match_issue_id": null, "match_candidate_id": null}]}`;

export interface RadarCluster {
  title: string;
  member_indices: number[];
  classification: string;
  category: string;
  risk_flags: string[];
  question: string;
  choices: { for: string; against: string; undecided: string };
  match_issue_id: string | null;
  match_candidate_id: string | null;
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
  match_issue_id: z.string().nullable().optional().default(null),
  match_candidate_id: z.string().nullable().optional().default(null),
});
const RADAR_CLASSIFY_RESPONSE_SCHEMA = z.object({
  clusters: z.array(RADAR_CLUSTER_SCHEMA).optional().default([]),
});

export interface ActiveIssueForMatch {
  id: string;
  title: string;
  keywords: string[];
}

/** まだ公開されていないHELD/REJECTED候補（累積判定の同一性マッチ対象） */
export interface PendingCandidateForMatch {
  id: string;
  title: string;
}

export async function classifyHeadlines(
  headlines: { index: number; feed: string; title: string }[],
  activeIssues: ActiveIssueForMatch[] = [],
  pendingCandidates: PendingCandidateForMatch[] = [],
): Promise<RadarCluster[]> {
  const capped = headlines.slice(0, 50);
  const list = capped.map((h) => `${h.index}: [${h.feed}] ${h.title}`).join("\n");
  const activeIssuesBlock =
    activeIssues.length > 0
      ? `\n\n# 既に公開中の争点一覧（続報ならmatch_issue_idにidを設定）\n${activeIssues
          .map((i) => `${i.id}: ${i.title}${i.keywords.length ? ` (${i.keywords.join("/")})` : ""}`)
          .join("\n")}`
      : "";
  const pendingCandidatesBlock =
    pendingCandidates.length > 0
      ? `\n\n# まだ公開されていない候補一覧（同じ出来事ならmatch_candidate_idにidを設定）\n${pendingCandidates
          .map((c) => `${c.id}: ${c.title}`)
          .join("\n")}`
      : "";
  const res = await getOpenAIRadar().chat.completions.create({
    model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: RADAR_CLASSIFY_PROMPT },
      { role: "user", content: `${list}${activeIssuesBlock}${pendingCandidatesBlock}` },
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

/**
 * Radar 能動調査の関連性判定（②）。
 * バズ語から TwoSides 向けの「賛否を取れる火種」だけを通す。
 * ゴシップ・試合結果・広告は捨てる。一次情報の有無は通過条件にしない。
 */
const TOPIC_FILTER_PROMPT = `あなたはTwoSidesの編集デスクです。ネットで急上昇・話題になっている検索ワード群から、
「一般の読者が賛成/反対（または評価の立場）を取れる議論の火種」だけを選び、
検索に使いやすい正規トピック語に整えてください。
一次情報（国会・法令・政府発表）があるかは必須ではない。あれば後工程で加点する。

# 通す（relevant=true）
賛否・評価が分かれる社会的な話題。例:
- 政治・選挙・政策・国会・法律（従来どおり通す）
- 経済・物価・税金・労働・企業の対応
- 社会炎上で公共性があるもの（ハラスメント、解雇、学校・医療・消費者問題、差別、表現規制など）
- テック・AI・課金・プライバシーなど生活に効く争点
- 外交・国際・人権
- 災害/事故で「公的対応は十分か」が問われるもの
→ SNSバズでも報道でも、立場を取れるなら積極的に拾う。政治専用メディアではない。

# 例外的に通す: 声明対立型の芸能・エンタメ（relevant=true, debatable=true）
「事務所 vs 本人」「企業 vs 個人」のように双方が声明・反論・謝罪を出し合い、
複数媒体が報じているもの。category は entertainment。
ただの熱愛・結婚・離婚報告（対立する声明がない色恋・慶事）は捨てる。

# 捨てる（relevant=false）
- スポーツの試合結果・スコア・勝敗速報
- 熱愛・結婚・離婚など声明対立のない個人の色恋・慶事
- 天気・セール・広告・アニメ/ゲーム/グッズ感想
- 公共性のない個人炎上（当事者以外が意見を持つ意味が薄いもの）
判断に迷う弱い話題も false。

# 正規トピック語（topic）
- 表記ゆれ・ハッシュタグ・略称を、検索でヒットしやすい簡潔な名詞句に直す（例:「#国旗損壊」→「国旗損壊罪」）。
- 同じ出来事を指す複数ワードは1つのtopicに統合してよい。
- 固有名詞のみで文脈が不明なものは、分かる範囲で争点名にする。不明なら relevant=false。

# category（relevant=trueのみ。いずれか1つ）
politics / economy / law / finance / rights / education / international / society / entertainment
（society=社会炎上・生活争点。entertainment=声明対立型エンタメ専用）

# debatable（relevant=trueのみ、true/false）※最重要
「一般読者が for / against（またはそれに近い2立場）を自分の意見として選べるか」で判定する。
- true: 賛否・評価の軸がはっきりしている（政策是非、企業対応の是非、声明のどちらを支持するか、等）
- false: 話題にはなっているが、立場を取る意味が薄い（単なる速報事実の共有、結果報告のみ）
一次情報の有無は debatable の条件にしない。
debatable=false のときは debateType を付けず、relevant=false 扱いに近い（後工程で記事化しない）。

# debateType（relevant=true かつ debatable=true のみ。いずれか1つ）※記事テンプレとpromote本線
軸が立つ型だけ付ける。速報直後・事実未確定で軸が無いものは relevant=false か debatable=false。
- declaration: 双方声明・反論・謝罪の対立（芸能含む）
- policy: 政策・法案・制度の賛否（減税・別姓・防衛費等）。再燃バズもこれ
- org_response: 企業・組織の対応是非（謝罪・処分・値上げ・改悪等）
- norm_flare: 社会炎上・規範対立（声明なし。表現の自由vs配慮など軸を1本に固定できるもの）
- indicator: 金利・物価・為替・GDP・世論調査など数値の解釈対立
- geopolitics: 戦争・外交・制裁・関税など国際・陣営対立
迷ったら policy / org_response / norm_flare のどれか。上記に当てはまらない薄い速報は捨てる。

# reignite（debateType=policy のときのみ、任意）
同じ制度論が再びトレンド入りした再燃なら true（きっかけ先頭＋定番両論の再提示）。

# question・choices（relevant=trueのみ）
当事者以外の一般ユーザーも自分の意見を持てる中立的な投票設問を作る（40字以内・必ず日本語）。
「あなたはどう見る？」だけに偏らず、争点に合わせて言い回しを変える（例:「〜、賛成ですか？」「〜、妥当だと思いますか？」「〜への対応、十分ですか？」）。
choicesは常にfor/against/undecidedの3キーで返すが、文言は実際の対立軸に合わせて自由に作ってよい
（賛成/反対が不自然な話題は、実際に対立する2つの立場をfor/againstに当て、undecidedは
「どちらとも言えない」「まだ判断できない」等にする）。
choicesの各文言は投票ボタンに収まる短さ（各12字以内）が必須。長い説明文にしない。
断定・煽り・一方の立場に不利な言葉選びは禁止。

必ずJSONのみ:
{"topics": [{"topic": "正規トピック語", "relevant": true, "category": "society", "debatable": true,
  "debateType": "norm_flare", "reignite": false, "reason": "判断理由(40字以内)",
  "question": "投票設問", "choices": {"for": "...", "against": "...", "undecided": "..."}}]}`;

const TOPIC_FILTER_SCHEMA = z.object({
  topics: z
    .array(
      z.object({
        topic: z.string(),
        relevant: z.boolean(),
        category: z.string().optional().default(""),
        debatable: z.boolean().optional().default(true),
        debateType: z.string().optional().default(""),
        reignite: z.boolean().optional().default(false),
        reason: z.string().optional().default(""),
        question: z.string().optional().default(""),
        choices: z
          .object({ for: z.string(), against: z.string(), undecided: z.string() })
          .optional()
          .default({ for: "", against: "", undecided: "" }),
      }),
    )
    .optional()
    .default([]),
});

export interface RelevantTopic {
  topic: string;
  relevant: boolean;
  category: string;
  /** 一般読者が for/against を選べるか。falseは「話題だが立場を取る意味が薄い」の意 */
  debatable: boolean;
  /** 争点タイプ。debatable=false や不正値は null（promote 対象外） */
  debateType: DebateType | null;
  /** policy のスローバーン再燃 */
  reignite: boolean;
  reason: string;
  question: string;
  choices: { for: string; against: string; undecided: string };
}

/**
 * 急上昇ワード群 → 賛否を取れる火種トピックだけを返す（discover 時間帯のみ・1実行1回）。
 * sustained（継続的に話題）フラグはプロンプトのヒントとして併記する。
 * モデルは gpt-5-mini（RADAR_TOPIC_FILTER_MODEL）。
 */
export async function filterRelevantTopics(
  terms: { term: string; sustained?: boolean; discussed?: boolean }[],
): Promise<RelevantTopic[]> {
  const capped = terms.slice(0, RADAR.topicFilterMaxTerms);
  if (capped.length === 0) return [];
  const list = capped
    .map(
      (t) =>
        `- ${t.term}${t.sustained ? "（継続的に話題）" : ""}${t.discussed ? "（Yahoo!コメント欄で議論・賛否が多数=賛否分裂の実測あり）" : ""}`,
    )
    .join("\n");
  const res = await getOpenAIRadar().chat.completions.create({
    model: process.env.RADAR_TOPIC_FILTER_MODEL || AI_MODELS.topicFilter,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: TOPIC_FILTER_PROMPT },
      { role: "user", content: `# 急上昇・話題の検索ワード\n${list}` },
    ],
  });
  const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", TOPIC_FILTER_SCHEMA);
  return parsed.topics
    .filter((t) => t.relevant && t.topic.trim().length >= 2 && t.debatable !== false)
    .map((t) => {
      const topic = t.topic.trim();
      const category = t.category.trim();
      const resolved = resolveDebateType({
        topic,
        category,
        debateType: t.debateType,
        reignite: t.reignite,
        sustained: terms.find((x) => x.term.includes(topic) || topic.includes(x.term))?.sustained,
      });
      return {
        topic,
        relevant: true as const,
        category,
        debatable: true as const,
        debateType: resolved?.debateType ?? null,
        reignite: resolved?.reignite ?? false,
        reason: t.reason.trim(),
        question: (t.question.trim() || `${topic}、賛成ですか？`).slice(0, 40),
        choices: {
          for: (t.choices.for.trim() || "支持する").slice(0, VOTE_CHOICE_MAX_CHARS),
          against: (t.choices.against.trim() || "支持しない").slice(0, VOTE_CHOICE_MAX_CHARS),
          undecided: (t.choices.undecided.trim() || "わからない").slice(0, VOTE_CHOICE_MAX_CHARS),
        },
      };
    })
    .filter((t) => t.debateType !== null);
}

const ISSUE_TITLE_PROMPT = `あなたは${SITE.name}の編集デスクです。争点一覧に載るタイトル（55字以内・日本語）を1つ作ります。

# 読者
政治に詳しくない一般ユーザー（90%）。スクロール中に「自分に関係あるか」で止まるか決める。

# 最重要
1. **何が起きたか**を具体的に（数値・政策名・決定・固有名詞）
2. **だから何？＝フック**を1フレーズで（争点タイプ別のフックヒントに従う。無ければ生活・電気代・物価・税金・ローン・給料・医療・子ども・安全・仕事・貿易・円など）
3. 事実以外の憶測・デマ・煽りは禁止。一次資料・見出しにある内容だけ

# 読みやすさ（Yahoo!ニュース見出し編集部の知見）
- こなれた圧縮語より、素直で読みやすい日本語を優先する（例:「ダルビッシュ わずか12球降板」は「ダル腕に張り」より2倍以上クリックされた実例あり）
- 記事が実際に答えを示している場合のみ、「なぜ」「〜の理由」「真相」等の好奇心ワードを使ってよい（答えが無いのに使うと釣り見出しになるため禁止）
- 記事の内容にふさわしい場合のみ、感情語（「一転」「一斉に」等）を使ってよい。誇張・扇動語（「激怒」「衝撃」等の他人の感情の決めつけ）は禁止

# 例
- 悪:「EU、2030年までに再エネ50%目標を表明——支持？」→ 正確だが「自分に関係ない」
- 良:「欧州の再エネ半分宣言——日本の電気代に波及？」
- 良:「日銀利上げ、住宅ローン負担は増える？」
- 良:「入管法改正可決——地域の生活・治安は変わる？」
- 悪:「EUのエネルギー政策声明、妥当？」→ 中身不明

# 形式
- 「出来事＋フック」の1行。末尾の？で問いかけてよい
- 「声明」「発表」「公式」だけで終わらない
- JSONのみ: {"title": "..."}`;

const ISSUE_TITLE_SCHEMA = z.object({ title: z.string().optional().default("") });

export interface PrimaryExcerptForTitle {
  title: string;
  text: string;
}

export interface ComposeIssueTitleInput {
  clusterTitle: string;
  question: string;
  sourceTitles: string[];
  classification: string;
  category: string;
  /** OFFICIAL争点では一次資料本文を渡す（タイトルの具体性に必須） */
  primaryExcerpts?: PrimaryExcerptForTitle[];
  /**
   * 確定済みなら渡す。フックの種類（家計影響 / 好奇心・展開 / 安全保障等）を
   * debateTypeに合わせて切り替える。未確定（detect.tsの記事生成前段階等）は省略可、
   * その場合は生活・家計フックのデフォルト例文のみで判断する。
   */
  debateType?: DebateType | null;
}

/** 見出し・一次資料から、具体的な日本語争点タイトルを生成（nano・1争点1回） */
export async function composeIssueTitle(input: ComposeIssueTitleInput): Promise<string> {
  const sources = input.sourceTitles.slice(0, 5).join("\n");
  const excerptBlock =
    input.primaryExcerpts && input.primaryExcerpts.length > 0
      ? `\n\n一次資料抜粋（タイトル作成の主材料）:\n${input.primaryExcerpts
          .slice(0, 3)
          .map((e, i) => `【${i + 1}】${e.title}\n${e.text.slice(0, 600)}`)
          .join("\n---\n")}`
      : "";
  const debateTypeHintBlock = input.debateType
    ? `\n争点タイプ別フックヒント: ${debateTypeTitleHint(input.debateType)}`
    : "";
  const res = await getOpenAIRadar().chat.completions.create({
    model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: ISSUE_TITLE_PROMPT },
      {
        role: "user",
        content: `分類: ${input.classification} / ${input.category}
クラスタ題: ${input.clusterTitle}
既存の設問: ${input.question || "（なし）"}${debateTypeHintBlock}
参考見出し:
${sources}${excerptBlock}`,
      },
    ],
  });
  const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", ISSUE_TITLE_SCHEMA);
  return parsed.title.trim();
}

const VOTE_QUESTION_PROMPT = `あなたは${SITE.name}の編集デスクです。書き終えた記事の内容から、投票設問と選択肢を作ります。
discoverの段階（記事本文がまだ無い時点）で仮に作った設問を、実際の記事内容に合わせて確定させます。

# question（40字以内・必ず日本語・中立）
- 記事のlead・bulletsを踏まえ、当事者以外の一般読者が自分の意見を持てる中立的な問いにする
- 「あなたはどう見る？」だけに偏らず、争点に合わせて言い回しを変える
  （例:「〜、賛成ですか？」「〜、妥当だと思いますか？」「〜への対応、十分ですか？」）
- 断定・煽り・一方の立場に不利な言葉選びは禁止

# choices（for/against/undecided、各12字以内）
- 争点タイプのヒントに従う
- policy / indicator / org_response / norm_flare:
  賛否・評価の短い立場語のみ（例:「法案に賛成」「法案に反対」「対応を支持」「問題視」）
  人物名・団体名・「○○氏賛成」「○○会反対」は禁止。読者が法案・対応そのものに投票できるようにする
  bulletsに「支持・慎重派」など賛否混在ラベルがあっても無視し、極性だけのラベルにする
- declaration / geopolitics:
  記事本文の両側見出しと同じ主体を指す短いラベル。個別人物名への言い換えは避け、陣営名・当事者呼称で揃える
- undecidedは「どちらとも言えない」「まだ判断できない」等
- 短い立場ラベルにする。説明文・長文にしない

JSONのみ: {"question": "...", "choices": {"for": "...", "against": "...", "undecided": "..."}}`;

const VOTE_QUESTION_SCHEMA = z.object({
  question: z.string().optional().default(""),
  choices: z
    .object({
      for: z.string().optional().default(""),
      against: z.string().optional().default(""),
      undecided: z.string().optional().default(""),
    })
    .optional()
    .default({ for: "", against: "", undecided: "" }),
});

export interface ComposeVoteQuestionInput {
  issueTitle: string;
  lead: string;
  bullets: string[];
  debateType: DebateType;
  /** discover段階の仮設問・選択肢。生成失敗・空応答時のフォールバック */
  fallbackQuestion: string;
  fallbackChoices: { for: string; against: string; undecided: string };
}

export interface VoteQuestionResult {
  question: string;
  choices: { for: string; against: string; undecided: string };
}

/**
 * 記事生成後（debateType確定・本文あり）に投票設問・選択肢を作り直す（nano・1争点1回）。
 * discover段階のvoteQuestion/choicesは見出しだけを見た仮のものなので、
 * 実際の記事内容とdebateType別の両側見出し表現に合わせて上書きする。
 * 失敗・空応答時はdiscover段階の値にフォールバックする（記事公開は止めない）。
 */
export async function composeVoteQuestion(input: ComposeVoteQuestionInput): Promise<VoteQuestionResult> {
  const fallback: VoteQuestionResult = {
    question: input.fallbackQuestion,
    choices: input.fallbackChoices,
  };
  try {
    const res = await getOpenAIRadar().chat.completions.create({
      model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: VOTE_QUESTION_PROMPT },
        {
          role: "user",
          content: `争点: ${input.issueTitle}
争点タイプ: ${input.debateType}（${debateTypeChoiceHint(input.debateType)}）
仮の設問: ${input.fallbackQuestion || "（なし）"}
記事の要点: ${input.lead}
論点:
${input.bullets.map((b) => `- ${b}`).join("\n")}`,
        },
      ],
    });
    const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", VOTE_QUESTION_SCHEMA);
    const question = (parsed.question.trim() || input.fallbackQuestion).slice(0, 40);
    const choices = {
      for: (parsed.choices.for.trim() || input.fallbackChoices.for).slice(0, VOTE_CHOICE_MAX_CHARS),
      against: (parsed.choices.against.trim() || input.fallbackChoices.against).slice(0, VOTE_CHOICE_MAX_CHARS),
      undecided: (parsed.choices.undecided.trim() || input.fallbackChoices.undecided).slice(
        0,
        VOTE_CHOICE_MAX_CHARS,
      ),
    };
    if (!question || !choices.for || !choices.against) return fallback;
    return {
      question,
      choices: sanitizePolarVoteChoices(input.debateType, choices, input.fallbackChoices),
    };
  } catch {
    return fallback;
  }
}

/** policy系で人物名・団体名ボタンになった場合は賛否ラベルへ戻す */
const ACTORISH_VOTE_LABEL = /氏|さん|弁護士会|事務所|有志|議員/;

function defaultPolarChoices(debateType: DebateType): { for: string; against: string; undecided: string } {
  switch (debateType) {
    case "org_response":
      return { for: "対応を支持", against: "問題視", undecided: "まだ判断できない" };
    case "norm_flare":
      return { for: "擁護する", against: "批判する", undecided: "まだ判断できない" };
    case "indicator":
      return { for: "妥当だ", against: "不適切だ", undecided: "まだ判断できない" };
    case "policy":
    default:
      return { for: "法案に賛成", against: "法案に反対", undecided: "まだ判断できない" };
  }
}

export function sanitizePolarVoteChoices(
  debateType: DebateType,
  choices: { for: string; against: string; undecided: string },
  fallback: { for: string; against: string; undecided: string },
): { for: string; against: string; undecided: string } {
  if (debateType === "declaration" || debateType === "geopolitics") return choices;
  if (!ACTORISH_VOTE_LABEL.test(choices.for) && !ACTORISH_VOTE_LABEL.test(choices.against)) {
    return choices;
  }
  const defaults = defaultPolarChoices(debateType);
  const pick = (key: "for" | "against" | "undecided") => {
    const fb = fallback[key]?.trim();
    if (fb && !ACTORISH_VOTE_LABEL.test(fb)) return fb.slice(0, VOTE_CHOICE_MAX_CHARS);
    return defaults[key];
  };
  return { for: pick("for"), against: pick("against"), undecided: pick("undecided") };
}

const CLAIM_VERIFY_PROMPT = `あなたは記事の事実確認の照合係です。記事が主張ごとに「根拠にした資料抜粋」とペアで渡されます。
各主張について、対応する資料抜粋に本当にその内容が書かれているかだけを機械的に判定してください。

# 判定基準
- 言い換え・要約による表現の違いは許容する（同じ事実を指していればsupported=true）
- 資料抜粋に無い固有名詞・数値・日付・断定的な結論が主張に含まれていればsupported=false
- 資料抜粋が主張と無関係、または主張の方が資料より強い/踏み込んだ内容ならsupported=false
- 文章の巧拙・重要性・書き方の良し悪しは判定に含めない。「書かれているか否か」だけを見る

必ずJSONのみ:
{"results": [{"id": "...", "supported": true}]}`;

const CLAIM_VERIFY_SCHEMA = z.object({
  results: z
    .array(z.object({ id: z.string(), supported: z.boolean().optional().default(false) }))
    .optional()
    .default([]),
});

export interface ClaimToVerify {
  id: string;
  claim: string;
  sourceExcerpt: string;
}

export interface ClaimVerifyResult {
  id: string;
  supported: boolean;
}

/**
 * 記事内の主張が、根拠として提示した資料抜粋に実際に書かれているかを機械的に照合する（nano・バッチ1回）。
 * 執筆(GPT-5)とは別プロセスで、閉じたyes/no判定だけを行う「検証エージェント」。
 * 同じモデルに書かせて同じモデルに自己採点させる循環を避けるため、判定は常にnanoの独立呼び出しにする。
 */
export async function verifyClaimsAgainstSources(items: ClaimToVerify[]): Promise<ClaimVerifyResult[]> {
  if (items.length === 0) return [];
  const list = items
    .map((c) => `【${c.id}】\n主張: ${c.claim}\n資料抜粋: ${c.sourceExcerpt.slice(0, 800)}`)
    .join("\n---\n");
  const res = await getOpenAIRadar().chat.completions.create({
    model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: CLAIM_VERIFY_PROMPT },
      { role: "user", content: list },
    ],
  });
  const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", CLAIM_VERIFY_SCHEMA);
  const byId = new Map(parsed.results.map((r) => [r.id, r.supported]));
  // 応答に含まれないid（パース崩れ等）は安全側でsupported=falseにする
  return items.map((c) => ({ id: c.id, supported: byId.get(c.id) ?? false }));
}
