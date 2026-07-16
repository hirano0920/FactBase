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

# question・choices（relevant=trueのみ・仮設問。promote段階で記事本文に合わせて作り直す）
当事者以外の一般ユーザーも自分の意見を持てる中立的な投票設問を作る（55字以内・必ず日本語）。
形式: 「[固有名詞翻訳済みの主題]は[choice1]？[choice2]？」の1文。前置き不要。
例:「高市政権の外交方針は支持？不支持？」「国旗毀損罪は必要？不要？」
**最重要: 選択肢を「支持？不支持？」にデフォルトするな。争点ごとに適切な対立軸を選べ**（必要/不要、妥当/不当、是認/拒否、賛成/反対、是/非 etc.）。
二重質問禁止。断定・煽り・一方に不利な言葉選びは禁止。
choicesは常にfor/against/undecidedの3キー。文言は対立軸に合わせ、各${VOTE_CHOICE_MAX_CHARS}字以内。
undecidedは「どちらとも言えない」「まだ判断できない」等。

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
        // discover段階の仮選択肢。空応答時は争点非依存の「支持する/支持しない」ではなく、
        // 争点タイプ別のデフォルト（defaultPolarChoices）にフォールバックする。
        // どのみちpromote段階のcomposeVoteQuestionで記事本文に合わせて作り直されるが、
        // 万一そこも失敗した場合にこのdiscover段階の値がそのまま公開されるため、
        // 最低限争点タイプに沿った文言にしておく。
        choices: (() => {
          const defaults =
            resolved?.debateType != null ? defaultPolarChoices(resolved.debateType) : null;
          return {
            for: (t.choices.for.trim() || defaults?.for || "支持する").slice(0, VOTE_CHOICE_MAX_CHARS),
            against: (t.choices.against.trim() || defaults?.against || "支持しない").slice(
              0,
              VOTE_CHOICE_MAX_CHARS,
            ),
            undecided: (t.choices.undecided.trim() || defaults?.undecided || "わからない").slice(
              0,
              VOTE_CHOICE_MAX_CHARS,
            ),
          };
        })(),
      };
    })
    .filter((t) => t.debateType !== null);
}

const ISSUE_TITLE_PROMPT = `あなたは${SITE.name}の編集デスクです。争点一覧に載るタイトル（55字以内・日本語）を3案作ります。

# 読者
政治に詳しくない一般ユーザー（90%）。スクロール中に「自分に関係あるか」で止まるか決める。
**「お母さんでも一発で何の話か分かるか？」がすべての判断基準。**

# ★ 最も重要なテクニック: 固有名詞を「翻訳」する
難しい固有名詞をそのまま使うな。以下のルールで**普通名詞に変換**してから書け:

| 分野 | NG（固有名詞そのまま） | OK（翻訳） |
|------|------------------------|-----------|
| 組織 | GPIF | 年金運用の巨大基金 |
| 人物（無名） | 宮崎麗果 | 約1億5700万円脱税のインフルエンサー |
| 人物（有名OK） | トランプ、岸田首相 | そのまま使ってよい |
| 災害 | 被災対応 | 能登半島地震の復興対応 |
| 制度 | 学位剥奪 | 論文盗用で博士号はく奪 |
| 法律 | 国旗損壊罪 | 外国旗を燃やしたら罰則の法案 |
| 政策 | GPIF国内投資拡大 | 巨額の年金基金が国内投資へシフト |
| 企業 | 詐欺疑惑企業CM | 「商品を買わないで」CM中止騒動 |

**55字に収まらない場合**: 固有名詞を削って一般語だけでもOK。
- 「被災対応は適切？」→ ✗
- 「能登の地震、復興の遅れと国の対応は適切？」→ ○

# タイトルの黄金比: 「数字・規模」> 「意外性・対立」> 「個別具体フック」
どのトピックにも当てはまるわけではないが、以下の3要素のうち使えるものを**優先順に**拾え:

## 1. 数字・金額・規模（最強のフック。あれば必ず使う）
人間は数字に反射的に反応する。金額・人数・年数・割合・順位など、具体的な数字をタイトルに出せ。
- 「約1億5700万円脱税のインフルエンサーに有罪判決」
- 「250兆円超の年金基金、国内投資を拡大へ」

## 2. 意外性・二転三転・対立（数字が無ければこれ）
予想と違う展開、立場の対立、賛否の割れ。
- 「絶賛から一転、批判殺到——大学の説明が二転三転」
- 「"やっていない"から"やった"へ——知事の答弁が変遷」

## 3. 個別具体フック ★汎用フック禁止
「これが自分に関係ある」と思わせる。**ただし以下のNGに注意:**

### NG: どの記事にも使い回せる汎用フック（禁止）
- 「家計に影響は？」→ どの経済記事でも使える。具体性ゼロ。何にいくら影響するか書け
- 「仕事や購買に影響は？」→ 同上。どの企業提携記事でも使える。
- 「私たちの生活への影響は？」→ 同上
- 「あなたの〇〇は？」→ 仮定ではなく事実を書け

### OK: 個別具体的なフック
- ✗ 「家計に影響は？」 → ○ 「月2000円の負担増、JTが40円値上げ」
- ✗ 「自分の仕事に影響は？」 → ○ 「NVIDIA提携、半導体業界の人材争奪加速」
- ✗ 「年金への影響は？」 → ○ 「年金運用の大転換、250兆円が国内投資へ」

# 絶対ルール: 句読点の有無
読点（、）は「文の構造を明確にするためだけ」に使え。冗長な読点はむしろ読みにくい。

読点が必要なケース:
- 主語と述語が離れている → 「NVIDIA来日、日系企業と提携発表」
- 複数の情報を並列する → 「値上げ賛成6割、反対3割」

読点が不要なケース:
- 修飾語＋被修飾語の間 → ✗「加熱式たばこ、40円値上げ」 ○「加熱式たばこ40円値上げ」
- 「AのB」の間 → ✗「年金運用のGPIF、国内投資へ」 ○「年金運用のGPIF国内投資へ」
- 短い一文に複数の読点 → ✗「JT、加熱式たばこ、40円、値上げへ」

**ルール: 読点を入れる前に、外しても意味が通じるか確認せよ。外しても通じるなら外せ。**

句点（。）で区切る: タイトル内で文が2つに分かれる場合のみ使ってよい。
- 1文で済むなら「。」で切らない。「日銀利上げ、住宅ローン負担は増える？」は1文で十分

# 種明かし感を出すな
「家計に影響は？」のような「これから説明します感」を出して疑問で逃げるな。
**事実を先に出せ。疑問形は「その事実に対する読者の価値判断を問う」ときだけ。**
- ✗ 「JT値上げ、家計に影響は？」→ 説明する気が無い疑問形
- ○ 「JT40円値上げ、月2000円負担増の試算」→ 事実を出している
- ○ 「JT40円値上げ、家計への打撃はどのくらい？」→ 事実＋具体的な問い
- ○ 「NVIDIA提携、半導体業界の人材争奪は加速する？」→ 事実＋具体的な問い

# 誇張のルール（OK/NGを明確に区別）
「AIが書いたテンプレ感」を消すには適度な勢いが必要。ただし以下の線を厳守:

### OK（事実の規模・速度・落差を強調する語。嘘にならない）
- 「巨額の」「大規模な」「過去最大」「異例の」「緊急」
- 「一転」「急転」「まさかの」「一夜にして」

### NG（嘘・断定・安っぽい誇張）
- 集団感情の捏造:「国民激怒」「衝撃走る」「日本中が震撼」
- 事実の規模を超える誇張:「全財産失う」「人生が終わる」
- どちらが正しいかを示唆する言葉選び:「ようやく〜」「〜という暴挙」
- 中身の無い誇張語でごまかす:「衝撃の事実」「驚愕」「やばい」
- **「安っぽい」＝数字や固有名詞を出さずに誇張語だけで盛っている状態**

# 読みやすさ
- こなれた圧縮語より、素直で読みやすい日本語を優先する
- 記事が実際に答えを示している場合のみ、「なぜ」「〜の理由」「真相」等の好奇心ワードを使ってよい

# ★ 不自然な冗長修飾を禁止 — 「米軍」を「米国の軍隊」と書くな
固有名詞・組織名には**一般的な略称・通称を使え**。
- ✗ 「米国の軍隊による対イラン空爆」→ ○ 「米軍の対イラン空爆」
- ✗ 「日本たばこ産業が加熱式たばこ40円値上げ」→ ○ 「JTが加熱式たばこ40円値上げ」
- ✗ 「欧州連合が中国製ドローン部品調達停止検討」→ ○ 「EUが中国製ドローン部品調達停止検討」
**「短く・強く・早く」を徹底せよ。不必要に堅い正式名称を使うな。**

# ★ 待望感・実現のニュアンスを正しく使え
長期間待たれた政策・判決・決定には「ついに」「いよいよ」を使ってよい。
- ✗ 「食料品1%減税、2年間限定で実施へ」→ 淡々としすぎ。政治的に長年議論されてきた政策なら
- ○ 「ついに食料品1%減税実現、2年限定で実施へ」
ただし嘘の誇張にならない範囲で使うこと（「ついに」が事実と合わなければ使うな）。

# ★ ふわっとした表現を禁止 — 「何の格差？」が一発で分かるように書け
「格差」「問題」「影響」「対応」などの抽象語だけで終わらせるな。
- ✗ 「家計直撃、公務員と民間の格差は過去最大」← 何の格差？金額？率？
- ○ 「公務員ボーナス、民間より3年連続低い。賞与格差が過去最大に」
- ✗ 「被災対応は適切だと思いますか？」← どの災害？何の対応？
- ○ 「中国南部豪雨ダム決壊、避難対応の遅れと責任の所在」
**「つまり何が問題？」と聞かれて一発で答えられるタイトルにしろ。**

# テンプレ感を消す
毎回「——」区切り＋末尾「？」の同じリズムにしないこと。「。」区切りの2文構成・体言止め・「〜へ」「〜に」も混ぜる。

# 見出しの型（8つ。このうち3つを使い、同じ型を繰り返さない）
旧来の「生活フック疑問形」は撤廃。以下の8型で「事実→問いかけ」「事実→帰結」の流れを作る:

1. **数字インパクト型（最強）**: 数字を先頭に出し、その事実だけで目を引く。
   「約1.5億円脱税のインフルエンサーに有罪判決」
   「月2000円負担増、JTが加熱式たばこ40円値上げ」

2. **事実＋なぜ型**: 事実を先に述べ、その意外性に「なぜ」で続ける。
   「JTの値上げ表明。なぜ40円なのか？」
   「学位はく奪が一夜で決定。なぜ説明が二転三転するのか」

3. **対比・分裂型**: 賛否の割れ・立場の違いを見せる。
   「賛成6割でもSNSは反対優勢、なぜ乖離？」
   「値上げ賛成と反対、JT株主と消費者の溝」

4. **ギャップ・どんでん返し型**: 「絶賛→批判」「容認→禁止」の落差。
   「絶賛から一転、批判殺到——何があった？」
   「"やっていない"から"やった"へ、知事の答弁変遷」

5. **結論先出し型**: 判決・決定・発表の結論を最初に。後ろに問いか影響。
   「有罪判決、インフルエンサーのSNS発信に線引き」
   「日銀が利上げ決定。住宅ローンはどうなる」

6. **変化・移行型**: 「〜へ」「〜に」「転換」「シフト」で流れを見せる。
   「年金運用の大転換。250兆円が国内投資へシフト」
   「能登の復興、国主導から現地主体へ」

7. **当事者対決型**: 国際対立・声明対立。どちらかの言い分を具体的に。
   「イラン「封鎖も辞さず」vs米「抑制する」、ホルムズ海峡の緊張」
   「デンマーク首相、グリーンランド売却拒否——米国との関係冷却」

8. **リスク・警告型**: 災害・安全・経済リスク。数字や時期を具体的に。
   「堤防決壊のおそれ、いつ逃げる？避難情報の見方」
   「熱波で死者100人超、電力需要の限界」

争点タイプ別のフックヒントと組み合わせて型を選ぶこと。
どれにも当てはまらなければ①をデフォルトにしてよい。

# 3案の作り方
- **同じ型を繰り返さない**。8つの型から異なる3つを選ぶ
- 資料に数字があれば1案は必ず①（数字インパクト型）にする
- どの案も「汎用フック禁止ルール」に違反していないか確認する
- 末尾の「？」は型に合わせて選び、無理に付けない

JSONのみ: {"titles": ["タイトル1", "タイトル2", "タイトル3"]}`;

const ISSUE_TITLE_SCHEMA = z.object({
  titles: z.array(z.string()).optional().default([]),
  /** 旧プロンプト互換（1案だけの {"title":"..."} 応答） */
  title: z.string().optional().default(""),
});

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
  /**
   * 差し戻し再試行専用。前回案が却下された理由を渡し、同じ失敗を繰り返させない
   * （promote.tsのshareTitle生成が1回目に低品質判定されたときの再試行で使う）。
   */
  avoidHint?: string;
  /** 軸ロックで確定した現実の対立軸。これに沿った見出しにする */
  lockedAxis?: { axis: string; sideA: string; sideB: string };
}

/**
 * 見出し・一次資料から、具体的な日本語争点タイトルを3案生成する（nano・1争点1回）。
 * 1本だけ生成すると単発生成のブレをそのまま公開してしまうため、同じ呼び出しの中で3案作らせ、
 * 呼び出し側がpickBestIssueTitle（judgeIssueTitleQuality）で最良の1つを選ぶ設計にしている。
 */
export async function composeIssueTitle(input: ComposeIssueTitleInput): Promise<string[]> {
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
  const axisBlock = input.lockedAxis
    ? `\n\n確定した対立軸:\n論点: ${input.lockedAxis.axis}\n側A: ${input.lockedAxis.sideA}\n側B: ${input.lockedAxis.sideB}`
    : "";
  const avoidHintBlock = input.avoidHint ? `\n\n${input.avoidHint}` : "";
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
${sources}${excerptBlock}${axisBlock}${avoidHintBlock}`,
      },
    ],
  });
  const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", ISSUE_TITLE_SCHEMA);
  const fromArray = parsed.titles.map((t) => t.trim()).filter(Boolean);
  if (fromArray.length > 0) return fromArray;
  const legacy = parsed.title.trim();
  return legacy ? [legacy] : [];
}

const ISSUE_TITLE_JUDGE_PROMPT = `あなたは${SITE.name}の見出し審査担当です。同じ争点について書かれた
見出し候補を複数渡すので、最も「政治に詳しくない一般ユーザーがクリックしたくなる」1つを選んでください。

# 選ぶ基準（優先順）
1. ★ **専門用語を説明なしで使っていないか**（「GPIF」「学位剥奪」「被災対応」等、一発で意味が通じない用語をそのまま使っている候補は大幅減点）
2. **「自分に関係ある」と思わせる生活フックがあるか**（年金・税金・給料・物価・安全・権利等）
3. **具体的な事実(数値・固有名詞・決定内容)が入っているか**（ただし専門用語翻訳ルールを満たした上で）
4. 「AI がテンプレで作った」感が無いか（不自然な語順、意味のない誇張、どの記事にも使い回せる曖昧な言い回しは減点）
5. 誇張しすぎて煽り・釣りになっていないか

複数の候補が同程度に良ければ、どれでもよいので1つを選ぶこと（迷って選ばない、は不可）。

JSONのみ: {"best": "候補の中の1つをそのまま転記", "reason": "40字以内で選定理由"}`;

const ISSUE_TITLE_JUDGE_SCHEMA = z.object({
  best: z.string().optional().default(""),
  reason: z.string().optional().default(""),
});

export interface IssueTitleJudgeResult {
  best: string;
  reason: string;
}

/**
 * composeIssueTitleが生成した複数案から最良の1つを選ぶ（nano・1回）。
 * 単なる合否判定でなく比較選抜にすることで、単発生成のブレを吸収し
 * 「プロのライターが書いたような」見出しに近づける（2026-07-15、regex語彙リストの
 * 繰り返しの誤検知を受けて、意味理解が要る判定はnanoに寄せる方針に変更）。
 * 判定失敗時は先頭候補を安全側で採用する（記事公開を止めない）。
 */
export async function judgeIssueTitleQuality(candidates: string[]): Promise<IssueTitleJudgeResult> {
  if (candidates.length === 0) return { best: "", reason: "" };
  if (candidates.length === 1) return { best: candidates[0], reason: "" };
  try {
    const res = await getOpenAIRadar().chat.completions.create({
      model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ISSUE_TITLE_JUDGE_PROMPT },
        {
          role: "user",
          content: candidates.map((t, i) => `【候補${i + 1}】${t}`).join("\n"),
        },
      ],
    });
    const parsed = safeParseJson(
      res.choices[0]?.message?.content ?? "{}",
      ISSUE_TITLE_JUDGE_SCHEMA,
    );
    const best = candidates.includes(parsed.best) ? parsed.best : candidates[0];
    return { best, reason: parsed.reason.trim() };
  } catch {
    return { best: candidates[0], reason: "" };
  }
}

const VOTE_QUESTION_PROMPT = `あなたは${SITE.name}の編集デスクです。書き終えた記事の内容から、**投票設問と選択肢**を作ります。

# 絶対原則
1. **読者は「ああ、あの話ね」と一発で理解する**
2. **選択肢は直感的で、状況に合っていること**（軍事攻撃なのに「停戦優先？圧力継続？」はおかしい）
3. **「支持？不支持？」にデフォルトするな** — 必ず争点固有の対立軸を選べ

# よくある失敗パターンと正解（これを暗記しろ）
以下の表は「お前がやってはいけないこと」と「どう直すか」を示す：

| 状況 | ❌ ダメな選択肢の例 | なぜダメ？ | ✅ 正しい選択肢の例 |
|------|-------------------|-----------|-------------------|
| 米軍のイラン空爆 | 停戦優先？圧力継続？ | 攻撃してる側に「停戦優先？」は不自然。争点は空爆そのものの是非 | **正当？不当？** / **是認？拒否？** |
| 食料品減税（誰も反対しない政策） | 支持？不支持？ / 賛成？反対？ | 反対する人がほぼいない政策に賛否を聞くのはおかしい。争点は条件設計 | **2年で十分？不十分？** / **食料品だけ？他も減税すべき？** |
| 値上げの是非 | 支持？不支持？ | 値上げに「支持」は不自然。評価軸で聞く | **妥当？不当？** / **賛成？反対？** |
| 公務員と民間の差 | 是正を支持？不支持？ | 選択肢が長すぎて設問崩壊。対義語も不自然 | **是正は必要？不要？** / **引き上げ？抑制？** |
| 「日本たばこ産業」の話 | 「日本たばこ産業の〜は賛成？反対？」 | 「日本たばこ産業」が長すぎ。「JT」でよい。選択肢も「支持？不支持？」が安易 | **「JT加熱式たばこ値上げは妥当？不当？」** |
| **lockedAxisあり** | 無視して「支持？不支持？」 | 現実の対立軸が確定しているのに使わないのはもったいない | **sideA→for、sideB→againstに圧縮** |

# question（55字以内・必ず日本語・中立）
基本形: **「[主題]は[choice1]？[choice2]？」** の1文。前置き不要。

choice1とchoice2は**必ず短い対義語ペア**（各2〜4字推奨）。主題に翻訳済み固有名詞を使う。

- 良い例:「国旗毀損罪は必要？不要？」「加熱式たばこ40円値上げは妥当？不当？」
- 当事者比較なら:「責任を取るべきはトランプ？バイデン？」
- **lockedAxisがある場合**: sideA/sideBの対立を2〜4字の対義語ペアに圧縮してchoice1/choice2に使うことを最優先で検討せよ
- **禁止: 選択肢が各5字を超えること**（「食料品の消費税1%減税を支持」は16字で長すぎ。設問に埋め込めない）

# choices（for/against/undecided）
- **forとagainstはquestionの末尾に埋め込んだ言葉と完全一致させよ**
- 各2〜4字推奨（最大でも5字）
- 短い対義語ペアの例: 妥当/不当、必要/不要、是認/拒否、正当/不当、是/非、賛成/反対、支持/不支持、容認/拒否、肯定/否定、推進/慎重、拡大/縮小、優先/後回し
- **lockedAxis.sideA/sideBが与えられた場合**: sideAをfor(肯定側)に、sideBをagainst(否定側)に圧縮した形を最優先で検討する
- undecided: 「どちらとも言えない」「まだ判断できない」「判断保留」

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
  /**
   * 差し戻し再試行専用。verifyVoteChoicesReflectSidesで選択肢が両側の主張内容と
   * 噛み合っていないと判定された場合に理由を渡し、同じ失敗を繰り返させない。
   */
  avoidHint?: string;
  /** 軸ロックで確定した対立軸。選択肢を実際の両側の立場に合わせる */
  lockedAxis?: { axis: string; sideA: string; sideB: string };
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
    const avoidHintBlock = input.avoidHint ? `\n\n${input.avoidHint}` : "";
    const axisBlock = input.lockedAxis
      ? `\n\n対立軸（この軸に沿った設問と選択肢にすること）:\n論点: ${input.lockedAxis.axis}\n側A: ${input.lockedAxis.sideA}\n側B: ${input.lockedAxis.sideB}`
      : "";
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
${input.bullets.map((b) => `- ${b}`).join("\n")}${axisBlock}${avoidHintBlock}`,
        },
      ],
    });
    const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", VOTE_QUESTION_SCHEMA);
    const llmQuestion = parsed.question.trim();
    const llmFor = parsed.choices.for.trim();
    const llmAgainst = parsed.choices.against.trim();
    const llmUndecided = parsed.choices.undecided.trim();
    // 完全空応答は discover 段階の値をそのまま使う（syncで改変しない）
    if (!llmQuestion && !llmFor && !llmAgainst) return fallback;

    const rawQuestion = llmQuestion || input.fallbackQuestion;
    const choicesRaw = {
      for: (llmFor || input.fallbackChoices.for).slice(0, VOTE_CHOICE_MAX_CHARS),
      against: (llmAgainst || input.fallbackChoices.against).slice(0, VOTE_CHOICE_MAX_CHARS),
      undecided: (llmUndecided || input.fallbackChoices.undecided).slice(0, VOTE_CHOICE_MAX_CHARS),
    };
    if (!rawQuestion || !choicesRaw.for || !choicesRaw.against) return fallback;
    // sanitize/legitimacy矯正はchoicesだけを書き換えるため、questionも必ず同期する
    // （設問が「自民支持？共産党懸念？」のままボタンだけ「対応を支持/問題視」になる事故を防ぐ）
    const choices = fixLegitimacyQuestionChoiceMismatch(
      rawQuestion,
      input.debateType,
      sanitizePolarVoteChoices(input.debateType, choicesRaw, input.fallbackChoices),
    );
    return {
      question: syncVoteQuestionWithChoices(rawQuestion, choices),
      choices,
    };
  } catch {
    return fallback;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 投票設問の末尾を最終choices（for？against？）に揃える。
 * sanitizePolarVoteChoices / fixLegitimacy がchoicesだけ書き換えたあとに呼び、
 * 設問文とボタン文言の不一致を防ぐ。40字超過時は前置きだけ短縮し、A？B？は切らない。
 */
export function syncVoteQuestionWithChoices(
  question: string,
  choices: { for: string; against: string },
  maxLen = 55,
): string {
  const forC = choices.for.trim();
  const againstC = choices.against.trim();
  if (!forC || !againstC) return question.slice(0, maxLen);

  const tail = `${forC}？${againstC}？`;
  // 最終choicesが末尾に既にある場合はその前までを前置きにする（部分一致の indexOf は使わない）。
  // 「百地章氏賛成」の中の「賛成」に誤マッチして前置きが壊れる事故を防ぐ。
  const exactTail = new RegExp(`${escapeRegExp(forC)}[？?]${escapeRegExp(againstC)}[？?]?$`);
  let preamble: string;
  if (exactTail.test(question)) {
    preamble = question.replace(exactTail, "").replace(/[、，\s]+$/g, "").trim();
  } else {
    preamble = question
      .replace(/([^、。\s？?]{1,20})[？?]([^、。\s？?]{1,20})[？?]?$/, "")
      .replace(/[、，]?[^、。？?\s]{0,24}ですか[？?]?$/, "")
      .replace(/[？?\s]+$/g, "")
      .replace(/[、，\s]+$/g, "")
      .trim();
  }

  let out = preamble ? `${preamble}、${tail}` : tail;
  out = out.replace(/、+/g, "、").replace(/は、/g, "は");
  if (out.length <= maxLen) return out;

  const joinerLen = preamble ? 1 : 0;
  const budget = maxLen - tail.length - joinerLen;
  if (budget < 2) return tail.slice(0, maxLen);
  preamble = preamble.slice(0, budget).replace(/[、，\s]+$/g, "");
  return preamble ? `${preamble}、${tail}` : tail.slice(0, maxLen);
}

/**
 * 是非（legitimacy）を問う設問なのに、declaration/geopolitics型の「陣営名ラベル」ルールが
 * 誤って適用され、選択肢が国名・陣営名のままになるケースの保険。
 * 例: 設問「ホルムズ海峡封鎖は容認できますか？」に choices=「イラン側」「米軍側」は、
 * 設問に答える形になっておらず、国家間紛争で「どちらの味方か」を選ばせる構図になってしまう
 * （実際に本番でこの組み合わせが公開された）。
 * プロンプト側にも整合ルールを追加済みだが、LLMが従わない場合に機械的に是正する。
 */
const LEGITIMACY_QUESTION = /容認|正当化|許され|適切|妥当|正しい|間違って/;
// 「どちらの主張が/言い分が」等は当事者比較型なので、legitimacy語を含んでいても対象外にする
const COMPARATIVE_QUESTION = /どちら/;
// 「正しい/間違ってる」はユーザー指定の是非型パターンなので語彙に含める
// （含めないと容認できる/できないへ勝手に置換され、設問とボタンがズレる）
const LEGITIMACY_CHOICE_VOCAB = /容認|正当|妥当|適切|賛成|反対|支持|批判|問題視|正しい|間違/;

function fixLegitimacyQuestionChoiceMismatch(
  question: string,
  debateType: DebateType,
  choices: { for: string; against: string; undecided: string },
): { for: string; against: string; undecided: string } {
  if (debateType !== "declaration" && debateType !== "geopolitics") return choices;
  if (!LEGITIMACY_QUESTION.test(question) || COMPARATIVE_QUESTION.test(question)) return choices;
  if (LEGITIMACY_CHOICE_VOCAB.test(choices.for) || LEGITIMACY_CHOICE_VOCAB.test(choices.against)) {
    return choices;
  }
  return { for: "容認できる", against: "容認できない", undecided: choices.undecided };
}

/** policy系で人物名・団体名ボタンになった場合は賛否ラベルへ戻す */
/**
 * 政策・指標・組織対応・規範炎上型で、選択肢が人物・団体・政党名になっている（賛否ラベルであるべきなのに
 * 「自民支持」「共産党懸念」のように誰の味方かを選ばせる構図になっている）ことの検出。
 * 元は氏/さん等の個人名パターンのみだったが、政党名（自民/共産党等）が漏れていたため追加
 * （本番で「選挙SNS対策法案」の選択肢が「自民支持」「共産党懸念」になっていたのを2026-07-15に確認）。
 */
const ACTORISH_VOTE_LABEL =
  /氏|さん|弁護士会|事務所|有志|議員|自民|立憲|維新|公明|参政|国民民主|共産党|れいわ|保守党|野党|与党|政権/;

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

const SIDES_AXIS_PROMPT = `あなたは記事の構造チェッカーです。設問と、記事の両側（賛成側/反対側、当事者A/Bなど）の
論点リストを渡すので、両側が本当に「同じ問い」について賛否・評価を述べているか判定してください。

# よくある悪い例（この見落としが本番で実際に起きた）
設問「対応は適切か」に対し、
擁護側=「救助は全力でやっている」（＝事後の対応についての話）
批判側=「事前のダム管理に問題があった」（＝発生前の準備体制についての話）
これは同じ問いに答えていない。「対応の是非」と「事前管理の是非」という別々の2つの問いが
混ざっているだけで、読者は両側を比較しても何も判断できない。

# 判定基準
- aligned=true: 両側とも同じ対象・同じ時間軸の同じ論点に対して、賛成/反対または評価の高低を述べている
- aligned=false: 片方が設問とは別の観点・別の対象・別の時間軸について論じている（すり替わっている）
- 迷ったらaligned=trueにする（過検出で記事を止めない）

JSONのみ: {"aligned": true, "reason": "falseの場合のみ、何がすり替わっているか40字以内で"}`;

const SIDES_AXIS_SCHEMA = z.object({
  aligned: z.boolean().optional().default(true),
  reason: z.string().optional().default(""),
});

export interface SidesAxisCheckInput {
  question: string;
  sideA: { heading: string; items: string[] };
  sideB: { heading: string; items: string[] };
}

export interface SidesAxisCheckResult {
  aligned: boolean;
  reason: string;
}

/**
 * 両側（賛成/反対等）の論点が、設問と同じ軸について述べているかをnanoで判定する（バッチ不要・1回）。
 * radar-article.tsのSYSTEM prompt内には「軸をすり替えない」という注意書きがあるが、
 * これはWriterへの指示だけで機械検証が無かった（本番で軸ズレ記事が実際に公開された）ため、
 * generateVerifiedArticleの検証ループに機械チェックとして追加する。
 * 判定失敗時は誤検知で記事を止めないよう安全側でaligned=trueにする。
 */
export async function verifySidesAxisAlignment(
  input: SidesAxisCheckInput,
): Promise<SidesAxisCheckResult> {
  try {
    const res = await getOpenAIRadar().chat.completions.create({
      model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SIDES_AXIS_PROMPT },
        {
          role: "user",
          content: `設問: ${input.question}

【${input.sideA.heading}】
${input.sideA.items.map((i) => `- ${i}`).join("\n")}

【${input.sideB.heading}】
${input.sideB.items.map((i) => `- ${i}`).join("\n")}`,
        },
      ],
    });
    const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", SIDES_AXIS_SCHEMA);
    return { aligned: parsed.aligned, reason: parsed.reason.trim() };
  } catch {
    return { aligned: true, reason: "" };
  }
}

const VOTE_CHOICES_CONTENT_PROMPT = `あなたは投票設問の審査担当です。記事の両側セクション(賛成側/反対側等が実際に主張している内容)と、
投票の選択肢(for/against)を渡すので、選択肢が両側の主張の「中身（理由・立場そのもの）」を
実際に反映しているかを判定してください。

# 最優先ルール（他の判断より先にこれだけで不合格にする）
選択肢が政党名・団体名・個人名（例:「自民支持」「共産党懸念」「○○氏に賛成」）になっている場合、
たとえその政党/団体/個人が両側セクションのどちらかに実在して対応が付いていても、必ず aligned=false
にする。理由: 読者は「その政党の味方をするか」を投票させられているのであって、記事の対立軸(法案の
是非・対応の是非等)そのものに投票できていない。「対応するかどうか」ではなく「選択肢が固有名詞に
なっているかどうか」だけで機械的に判定すること。

# その次に見ること
- aligned=true: 上のルールに引っかからず、for/against選択肢が両側セクションの実際の理由・立場
  （固有名詞ではなく、賛否・評価・是非等の抽象化された立場語）を指している
- aligned=false: 選択肢が両側の主張内容と無関係な一般論になっている
- 迷ったらaligned=trueにする（過検出で記事を止めない。ただし政党名・団体名・個人名ルールは例外なく適用）

JSONのみ: {"aligned": true, "reason": "falseの場合のみ、何がズレているか40字以内で"}`;

const VOTE_CHOICES_CONTENT_SCHEMA = z.object({
  aligned: z.boolean().optional().default(true),
  reason: z.string().optional().default(""),
});

export interface VoteChoicesContentCheckInput {
  choices: { for: string; against: string };
  sideA: { heading: string; items: string[] };
  sideB: { heading: string; items: string[] };
}

/**
 * 投票の選択肢(for/against)が、記事の両側セクションで実際に主張されている内容を反映しているかを
 * nanoで判定する。sanitizePolarVoteChoices/fixLegitimacyQuestionChoiceMismatchは選択肢が
 * 「極性として正しい形か」だけを見ており、選択肢の中身が対立の芯と噛み合っているかは
 * 見ていなかった（2026-07-15、本番で「自民支持」「共産党懸念」のような政党名選択肢を確認）。
 * 判定失敗時は誤検知で記事を止めないよう安全側でaligned=trueにする。
 */
export async function verifyVoteChoicesReflectSides(
  input: VoteChoicesContentCheckInput,
): Promise<{ aligned: boolean; reason: string }> {
  try {
    const res = await getOpenAIRadar().chat.completions.create({
      model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: VOTE_CHOICES_CONTENT_PROMPT },
        {
          role: "user",
          content: `選択肢: for=${input.choices.for} / against=${input.choices.against}

【${input.sideA.heading}】
${input.sideA.items.map((i) => `- ${i}`).join("\n")}

【${input.sideB.heading}】
${input.sideB.items.map((i) => `- ${i}`).join("\n")}`,
        },
      ],
    });
    const parsed = safeParseJson(
      res.choices[0]?.message?.content ?? "{}",
      VOTE_CHOICES_CONTENT_SCHEMA,
    );
    return { aligned: parsed.aligned, reason: parsed.reason.trim() };
  } catch {
    return { aligned: true, reason: "" };
  }
}

const COMMENT_STANCE_SPREAD_PROMPT = `あなたは世論分析の担当者です。あるニュース記事に実際に付いた読者コメント(上位表示分)を渡すので、
意見が実質的に二極化しているか、大勢が一致しているかを判定してください。

# 判定基準
- split=true: コメント群が賛成/反対、擁護/批判のような対立する2つの立場に実質的に分かれている
  （少数意見が1〜2件混じっているだけでは split にしない。両陣営にそれぞれ一定の支持があること）
- split=false: ほぼ全員が同じ方向（賛成のみ、批判のみ等）で、対立と呼べる規模の反対意見がない
- Yahoo!投票のような正式な集計ではなくコメント文面からの推定なので、迷ったら保守的にfalseにする

JSONのみ: {"split": true, "confidence": 0.7}`;

const COMMENT_STANCE_SPREAD_SCHEMA = z.object({
  split: z.boolean().optional().default(false),
  confidence: z.number().min(0).max(1).optional().default(0),
});

export interface CommentStanceSpreadResult {
  split: boolean;
  confidence: number;
}

/**
 * 読者コメントの文面から「意見が実質的に二極化しているか」をnanoで判定する。
 * Yahoo!「みんなの意見」(投票)は編集部が設問を作ってから読者が投票するまでタイムラグがあり、
 * 投稿直後の速報には向かない。コメントは記事公開直後から付くため、速報向けの
 * 分断シグナルとしてこちらを使う（researchTopicでexternalPollがデータ不足の場合のフォールバック）。
 * 判定失敗時は誤って「分断あり」と過大評価しないよう安全側でsplit=falseにする。
 */
export async function assessCommentStanceSpread(
  comments: string[],
): Promise<CommentStanceSpreadResult> {
  if (comments.length === 0) return { split: false, confidence: 0 };
  try {
    const res = await getOpenAIRadar().chat.completions.create({
      model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: COMMENT_STANCE_SPREAD_PROMPT },
        {
          role: "user",
          content: comments
            .slice(0, 20)
            .map((c, i) => `【${i + 1}】${c.slice(0, 300)}`)
            .join("\n---\n"),
        },
      ],
    });
    const parsed = safeParseJson(
      res.choices[0]?.message?.content ?? "{}",
      COMMENT_STANCE_SPREAD_SCHEMA,
    );
    return { split: parsed.split, confidence: parsed.confidence };
  } catch {
    return { split: false, confidence: 0 };
  }
}

const ASSESS_WRITEABILITY_PROMPT = `あなたは${SITE.name}の編集デスクです。記事の材料（報道抜粋・一次情報の束）を渡します。
この材料で、賛成／反対の立場に分かれた具体的な記事が書けるかどうかを評価してください。

# 「書ける」の基準
以下のすべてを満たす場合のみ writable=true:
1. 具体的な事実・発言・数字が複数（3件以上）含まれている
2. 2つ以上の立場に分かれる話題である（賛成側の主張・反対側の主張がどちらも書ける材料がある）
3. 各主張の根拠を本文から引用できる（「〜と報じられている」の形で出典を明示できる）

# 「書けない」の基準（writable=falseにするもの）
- 見出しだけで本文が無い（具体的事実が1つも無い）
- すべて同じ立場・同じ角度の報道ばかりで両論が書けない
- 感情的なコメントやSNS投稿の引用だけで、事実報道が無い

判断に迷ったら writable=true（記事公開を止めるより、Writerに任せた方が実害が少ない）。

JSONのみ: {"writable": true, "reason": "falseの場合のみ、何が足りないか40字以内"}`;

const WRITEABILITY_SCHEMA = z.object({
  writable: z.boolean().optional().default(true),
  reason: z.string().optional().default(""),
});

/**
 * 報道抜粋の束を見て「この材料でTwoSidesの記事が書けるか」をnanoで事前判定する。
 * falseを返した場合、呼び出し側は高コストなWriter（generateVerifiedArticle）を呼ばずに
 * HELDする（無駄なWriter呼び出しを減らすための安価な事前フィルタ）。
 * 判定失敗時は安全側でwritable=true（Writer呼び出しを止めない）。
 */
export async function assessEvidenceWriteability(
  excerpts: { text: string; feed?: string }[],
): Promise<{ writable: boolean; reason: string }> {
  try {
    const blob = excerpts
      .map((e) => `【${e.feed || "不明"}】${(e.text ?? "").slice(0, 500)}`)
      .join("\n---\n");
    const res = await getOpenAIRadar().chat.completions.create({
      model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ASSESS_WRITEABILITY_PROMPT },
        { role: "user", content: `材料:\n${blob.slice(0, 4000)}` },
      ],
    });
    const parsed = safeParseJson(res.choices[0]?.message?.content ?? "{}", WRITEABILITY_SCHEMA);
    return { writable: parsed.writable, reason: parsed.reason };
  } catch {
    return { writable: true, reason: "" };
  }
}

// ─── 争点正当性フィルタ ───────────────────────────

/**
 * 「本当にこの話題は賛成/反対の両論記事として成立するか」を判定するプロンプト。
 * 判定ツリー（3ステップ）に沿って機械的に分類させる:
 *
 * Step 1: 設問が両方の立場に「答えられる形」か
 * Step 2: 報道抜粋の中に両方の立場の主張が実際に存在するか
 * Step 3: 片方の立場が「社会通念上まとも」か（犯罪擁護・自明な問いを弾く）
 */
const DEBATE_LEGITIMACY_PROMPT = `あなたは${SITE.name}編集部の審査員です。あるニューストピックを「賛成/反対の両論記事として扱うべきか」を判定します。

判定は**以下3ステップの判定ツリー**に沿って機械的に行ってください。感覚ではなくルールで判断します。

# 判定ツリー

## Step 1: 設問が両方の立場にとって「答えられる形」か
与えられた「候補設問」を見て、以下のNGパターンにチェック:

### NGパターンA: 犯罪・不正の擁護を強要する設問
設問の目的語が「犯罪行為」「明らかな不正」で、それを「擁護/支持/容認」させる形。
- 悪い例:「宮崎麗果の判決を擁護しますか？」→ 脱税を擁護する人はいない
- 悪い例:「詐欺を許しますか？」→ YESと言う人はいない
- 良い代案:「量刑は適切ですか？」（軽重の議論になる）
→ 該当する場合: problemType="bad_frame", suggestedFramesに代案

### NGパターンB: 自明な問い
99%の人が同じ答えになる設問。
- 悪い例:「地震は悪いですか？」
- 悪い例:「脱税は悪いですか？」
→ 該当する場合: problemType="obvious_truth"（トピックそのものが不適切）

### NGパターンC: 事実確認のみ
価値判断でなく事実の有無を問う設問。
- 悪い例:「この発言はありましたか？」
- 悪い例:「地震は発生しましたか？」
→ 該当する場合: problemType="fact_only"

どれにも該当しない → Step 2 へ

## Step 2: 報道抜粋の中に、両方の立場の主張が存在するか
渡された抜粋の内容を確認。

### 「両論あり」のシグナル（1つでOK）:
- 記事に「A氏寄りの主張」「B氏寄りの主張」が両方含まれている
- 異なる立場の記事が複数存在する
- 報道の題材そのものが「A案vsB案」の対立構造
- 「賛成/支持/評価」と「反対/批判/問題視」の両方の語が登場

### 「両論なし」のシグナル（1つでNG）:
- 全記事が事実経過のみ（「逮捕」「発表」「声明」だけ）
- 全記事が同じ角度の批判/非難一色
- スキャンダル報道のみで政策論争が無い
→ 該当する場合: problemType="no_opposing_side"

どちらにも当てはまらない → Step 3 へ

## Step 3: 片方の立場が「社会通念上まとも」か

### 「まともでない立場」（これに該当すれば不適切）:
- 犯罪行為そのものを「擁護/容認/肯定」する立場
- 加害行為を「正当化」する立場
- 差別・人権侵害を「許容」する立場

### 「まともな立場」（該当すれば適切）:
- 政策の優先順位や予算配分の違い
- 規制の強弱の違い（強くすべきvs弱くすべき）
- 価値観のトレードオフ（表現の自由vs公共の安全）
- データの解釈の違い（好調を示すvs懸念を示す）
- 処分の轻重の違い（重すぎるvs妥当だ）

→ 「まともでない立場」が片側にある場合: problemType="unacceptable_side"
→ 両側ともまとも: Step 4 へ

## Step 4: 実際の読者の意見はどれくらい割れそうか（predictedMajorityPct）
Step1〜3は「論理的に両論framingが成立するか」だけを見ており、実際の世論分布は見ていない。
論理上は両論を組めても、実際には読者のほぼ全員が同じ側に付く話題がある
（例:「加害行為への処分は妥当か」→ほとんどの人が「妥当」or「もっと重く」で、処分不要派はほぼいない）。
そのようなトピックは記事化しても議論が盛り上がらない。

抜粋の内容と、この種の話題に対する日本の一般読者の典型的な意見分布を踏まえ、
「読者100人が投票したら、多い方の側は何%くらいになりそうか」を推定せよ。
- 50〜65%程度: 拮抗〜ある程度割れる（良い）
- 66〜84%: やや偏るが議論は成立する
- 85%以上: ほぼ一方的（少数派はほぼ存在しない）
判断材料が薄い場合は無理に極端な値を出さず、60台に倒す。

legitimate=true, problemType="ok" とし、predictedMajorityPct にこの推定値(50〜100の整数)を入れる。

# 出力
JSONのみ:
{
  "legitimate": true/false,
  "problemType": "bad_frame" | "obvious_truth" | "fact_only" | "no_opposing_side" | "unacceptable_side" | "ok",
  "reason": "15〜40字の日本語で判定理由を具体的に",
  "suggestedFrames": ["代案の設問1", "代案の設問2"],
  "predictedMajorityPct": 60
}

JSONの改行・インデントは自由。コメントや余計な文章は一切出力禁止。`;

const DEBATE_LEGITIMACY_SCHEMA = z.object({
  legitimate: z.boolean().optional().default(false),
  problemType: z
    .enum(["bad_frame", "obvious_truth", "fact_only", "no_opposing_side", "unacceptable_side", "ok"])
    .optional().default("no_opposing_side"),
  reason: z.string().optional().default(""),
  suggestedFrames: z.array(z.string()).optional().default([]),
  predictedMajorityPct: z.number().min(50).max(100).optional().default(60),
});

export interface DebateLegitimacyResult {
  legitimate: boolean;
  /** 不適切な場合の原因タイプ */
  problemType: "bad_frame" | "obvious_truth" | "fact_only" | "no_opposing_side" | "unacceptable_side" | "ok";
  /** 判定理由（40字以内） */
  reason: string;
  /** bad_frameの場合の代替設問案（最大2つ） */
  suggestedFrames: string[];
  /**
   * 実測投票（Yahoo!投票等）が無い場合の代替：Step4のLLM予測を
   * 0（一方的）〜1（拮抗）の divisionScore と同じスケールに変換した値。
   * 判定失敗・legitimate=false の場合は undefined（呼び出し側は実測ゲートのみに従う＝fail-open）。
   */
  predictedDivisionScore: number | undefined;
}

/**
 * あるトピックを「両論記事として扱うのが適切か」をnanoで事前判定する。
 * falseを返した場合、呼び出し側はWriter（generateVerifiedArticle）を呼ばずにHELDする。
 *
 * Selection V2: 判定失敗・抜粋なしは fail-closed（legitimate=false）。
 * 「通す方が安全」だと両論のないゴミが熱量だけで上位に残るため。
 */
export async function assessDebateLegitimacy(params: {
  /** トピックタイトル */
  topic: string;
  /** 候補設問（discover段階で仮生成したもの）。無い場合はトピックをそのまま使う */
  voteQuestion: string;
  /** 報道抜粋・一次資料抜粋 */
  excerpts: { text: string; feed?: string }[];
  /** 記事の分類（候補） */
  classification?: string;
  /** カテゴリ */
  category?: string;
}): Promise<DebateLegitimacyResult> {
  const reject = (
    problemType: DebateLegitimacyResult["problemType"],
    reason: string,
  ): DebateLegitimacyResult => ({
    legitimate: false,
    problemType,
    reason,
    suggestedFrames: [],
    predictedDivisionScore: undefined,
  });

  const usableExcerpts = params.excerpts.filter((e) => (e.text ?? "").trim().length >= 40);
  if (usableExcerpts.length === 0) {
    return reject("no_opposing_side", "抜粋不足のため両論を確認できない");
  }

  try {
    const excerptBlob = usableExcerpts
      .slice(0, 6)
      .map((e) => `【${e.feed || "不明"}】${(e.text ?? "").slice(0, 300)}`)
      .join("\n---\n");

    const userContent = [
      `【トピック】${params.topic}`,
      `【分類】${params.classification ?? "未分類"} / ${params.category ?? ""}`,
      `【候補設問】${params.voteQuestion || "（なし）"}`,
      `【抜粋】\n${excerptBlob.slice(0, 3000)}`,
    ].join("\n");

    const res = await getOpenAIRadar().chat.completions.create({
      model: process.env.RADAR_CLASSIFY_MODEL || AI_MODELS.utility,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: DEBATE_LEGITIMACY_PROMPT },
        { role: "user", content: userContent },
      ],
    });
    const parsed = safeParseJson(
      res.choices[0]?.message?.content ?? "{}",
      DEBATE_LEGITIMACY_SCHEMA,
    );
    const legitimate = parsed.legitimate === true;
    // predictedMajorityPct(50〜100) → divisionScore(0〜1) は Yahoo!投票の
    // computeDivisionScore と同じ「上位差(margin) = 1 - margin/100」の式に揃える。
    // margin = majorityPct - (100 - majorityPct) = 2*majorityPct - 100
    const margin = 2 * parsed.predictedMajorityPct - 100;
    return {
      // fail-closed: true 明示以外は落とす（schema default も false）
      legitimate,
      problemType: legitimate ? (parsed.problemType ?? "ok") : (parsed.problemType ?? "no_opposing_side"),
      reason: parsed.reason ?? "",
      suggestedFrames: parsed.suggestedFrames ?? [],
      predictedDivisionScore: legitimate ? Math.max(0, Math.min(1, 1 - margin / 100)) : undefined,
    };
  } catch {
    return reject("no_opposing_side", "両論判定に失敗したため見送り");
  }
}
