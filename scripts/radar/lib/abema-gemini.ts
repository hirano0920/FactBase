/**
 * ABEMA Prime動画をGemini APIの動画理解機能で直接解析する。
 * YouTube URLをそのままGeminiに渡せるため、yt-dlp・Cookie・IPレピュテーション対策が
 * すべて不要になる（Google自身の公式APIであり、スクレイピングではないため）。
 * 全文文字起こしも不要 — 賛否の立場・論点・要約を直接抽出させる。
 * 無料枠: 1日8時間分のYouTube動画まで無料（実行頻度に対して十分な余裕がある）。
 */
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";

const SCHEMA = z.object({
  track: z.enum(["debate", "news", "exclude"]),
  lead: z.string(),
  axis: z.string().nullable(),
  forLabel: z.string().nullable(),
  forBullets: z.array(z.string()),
  againstLabel: z.string().nullable(),
  againstBullets: z.array(z.string()),
  keyPoints: z.array(z.string()),
});

export type AbemaVideoAnalysis = z.infer<typeof SCHEMA>;

/**
 * GeminiのresponseSchemaでJSON形状を強制する（Zodと同じ形を手動で二重定義）。
 * responseMimeType指定だけだとGeminiがnull値のフィールドを丸ごと省略することがあり
 * （実際にforLabel/againstLabelが欠落する事故が起きた）、Zod側のnullable()だけでは
 * "フィールド自体が無い"ケースを弾いてしまう。responseSchemaで必須フィールドを明示し、
 * 生成時点で確実に埋めさせる方を優先する。
 */
const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    track: { type: Type.STRING, enum: ["debate", "news", "exclude"] },
    lead: { type: Type.STRING },
    axis: { type: Type.STRING, nullable: true },
    forLabel: { type: Type.STRING, nullable: true },
    forBullets: { type: Type.ARRAY, items: { type: Type.STRING } },
    againstLabel: { type: Type.STRING, nullable: true },
    againstBullets: { type: Type.ARRAY, items: { type: Type.STRING } },
    keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    "track",
    "lead",
    "axis",
    "forLabel",
    "forBullets",
    "againstLabel",
    "againstBullets",
    "keyPoints",
  ],
};

const buildSystemPrompt = (channelName: string) => `あなたは${channelName}の討論動画を見て、TwoSides（中立な争点まとめサイト）向けの
素材を抽出する編集者です。動画を実際に視聴し、以下を抽出してください。

# 分類（trackフィールド）
- debate: 賛成/反対が分かれる討論回。**ただし「社会的に意味のある争点」であることが必須**
  （政治・経済・法制度・社会問題・国際情勢など、視聴者が自分の立場を持つ意味がある公共的なテーマ）。
  forBullets/againstBulletsを埋める
- news: 賛否の対立構造は無いが情報価値のある専門家解説。keyPointsを埋める（forBullets/againstBulletsは空配列）
- exclude: 個人の人生ストーリー・生き方・芸能人生活・単独対談・ドキュメンタリー企画中心で、討論でも解説でもない回。
  また、当事者のセンシティブな体験を消費的に扱う回（犯罪被害の詳細な語り直し、自殺・自傷の手口に踏み込む回など）や、
  差別・誹謗中傷を助長しかねない内容など倫理的にリスクがある回もexcludeにする。
  **恋愛・容姿・性癖・結婚観・人間関係の悩みなど、出演者同士で意見が割れていても
  「個人のライフスタイル・価値観」の域を出ないテーマはexcludeにする**（例:「年上女性に甘えたいのはアリか」
  「痩せすぎは病的か」等。討論の構造（賛成派/反対派が対立する形式）を取っていても、
  公共的な争点（政策・制度・社会問題）でなければdebateにしない）

# 抽出のルール
- lead: 何が論点かの中立な要約（2〜3文）
- axis: debateの場合のみ、対立の核心を問いの形で（例:「〇〇は妥当か、慎重にすべきか」）。debate以外はnull
- forBullets/againstBullets: 各項目は「〇〇さん（役職・肩書）は〜と主張」のように、実際に動画で発言した人物名を付けて具体的に。一般論で埋めない。2〜4項目
- keyPoints: newsの場合のみ、動画で説明された具体的な事実・データを2〜4項目。debateの場合は空配列
- 全て動画で実際に語られた内容だけを使い、一般論やありがちな推測で埋めない

JSONのみで回答してください。`;

export async function analyzeAbemaVideo(
  videoId: string,
  title: string,
  channelName = "ABEMA Prime",
): Promise<AbemaVideoAnalysis | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("  ⚠️ abema-gemini: GEMINI_API_KEY 未設定のためスキップ");
    return null;
  }
  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_ABEMA_MODEL || "gemini-3.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}`, mimeType: "video/mp4" } },
            { text: `タイトル: ${title}` },
          ],
        },
      ],
      config: {
        systemInstruction: buildSystemPrompt(channelName),
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const raw = res.text ?? "{}";
    const parsed = SCHEMA.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.warn(`  ⚠️ abema-gemini: レスポンスがスキーマ不一致 videoId=${videoId} (${parsed.error.message})`);
      return null;
    }
    return parsed.data;
  } catch (e) {
    console.warn(`  ⚠️ abema-gemini: 解析失敗 videoId=${videoId} (${e})`);
    return null;
  }
}
