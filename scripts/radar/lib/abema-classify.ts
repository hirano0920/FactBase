/**
 * ABEMA Prime動画をdebate/news/excludeの3種に分類する。
 * 再生数・コメント数のしきい値だけでは、賛否が分かれる討論回と、
 * 賛否構造の無い単独ゲストの人生ストーリー・対談を区別できない
 * （実データで再生数8万・コメント300超の人生ストーリー回もあった）。
 * オーナーが実例で承認した基準をfew-shotとして埋め込み、nanoで判定する。
 */
import { z } from "zod";
import { createOpenAIClient } from "../../../src/lib/openai-client";
import { AI_MODELS } from "../../../src/lib/constants";

export type AbemaTrack = "debate" | "news" | "exclude";

const SCHEMA = z.object({
  track: z.enum(["debate", "news", "exclude"]),
  reason: z.string(),
});

const SYSTEM_PROMPT = `あなたはABEMA Primeの動画タイトル・概要から、TwoSidesでどう扱うべきか判定する編集者です。

# 3分類
- debate: 賛成/反対が分かれる論点がある討論回。複数の立場が対立している。
- news: 賛否の対立構造は無いが、社会的に情報価値のある専門家解説・分析。単独ゲストでもよい。
- exclude: 賛否も情報解説も無い、個人の人生ストーリー・生き方・芸能人生活・単独対談中心の回。

# debateの実例（承認済み）
- グリーンウォッシュ批判はコワいか、企業は「エコ」と言うべきか
- 個人情報の取り扱いはAI開発のために同意不要にしていいか
- 保健体育の「異性」表記をLGBTQ明記に変えるべきか
- れいわ新選組は代表辞任後も存続できるか
- 皇室典範改正で旧皇族から養子を迎えるべきか
- クールジャパン税金投入は妥当か

# newsの実例（承認済み。debateではない）
- うるう秒が60年ぶりに変わることの科学的な意味
- AI「ミュトス級」が3日で停止した件と安全保障への影響

# excludeの実例（承認済み。再生数が高くても除外）
- プリンセス研究家の半生（貧困からの立ち直り）
- 障害者の自立生活ストーリー
- スピリチュアルにハマる人たちのライフスタイル
- 聴覚障害のあるアイドルの前向きな生き方
- 著名人との対談（AIの未来をテーマにした対話でも、賛否の討論形式でなければexclude寄り。ただし専門的な分析・解説要素が強ければnews）
- 100日チャレンジのような個人の挑戦記

判断に迷ったら、タイトルに「べき？」「ダメ？」のような賛否を問う疑問形があるかを最優先の手がかりにする。

JSONのみで回答: {"track": "debate"|"news"|"exclude", "reason": "40字以内の判定理由"}`;

export async function classifyAbemaVideo(title: string, description: string): Promise<AbemaTrack> {
  try {
    const openai = createOpenAIClient({ timeout: 20_000, maxRetries: 1 });
    const res = await openai.chat.completions.create({
      // 実データ検証(2026-07-19): nano(utility)は6件中1件誤判定（明確なdebate例をnewsと誤判定）。
      // miniに上げたら6件全問正解だったため、判定精度を優先してminiを使う
      // （discover候補数に比例しないので呼び出し頻度は低く、コスト影響は小さい）。
      model: process.env.RADAR_ABEMA_CLASSIFY_MODEL || AI_MODELS.topicFilter,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `タイトル: ${title}\n概要: ${description.slice(0, 400)}`,
        },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    const parsed = SCHEMA.safeParse(JSON.parse(raw));
    if (!parsed.success) return "exclude";
    return parsed.data.track;
  } catch (e) {
    console.warn(`  ⚠️ abema-classify: 判定失敗、excludeにフォールバック (${e})`);
    return "exclude";
  }
}
