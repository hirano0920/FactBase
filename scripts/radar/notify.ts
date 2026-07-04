/**
 * Radar パイプライン障害の軽量アラート。
 * RADAR_ALERT_WEBHOOK_URL（Slack incoming webhook等）が未設定なら何もしない
 * — 必須インフラにはしない。
 */
export async function notifyRadarFailure(context: string, error: unknown): Promise<void> {
  const url = process.env.RADAR_ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:rotating_light: FactBase Radar 障害: ${context}\n${String(error)}`,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.warn(`[notify] webhook送信失敗: ${e}`);
  }
}
