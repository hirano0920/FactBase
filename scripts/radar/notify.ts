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

/**
 * エラーではないが「本来ピーク時間帯だったはずが許容幅を超えて自己スキップした」
 * near-miss を警告する。GitHub Actions の scheduled cron 遅延/欠落を早期発見する目的
 * （2026-07-12〜13に3ピーク連続で記事が公開されない障害が、失敗扱いにならず
 * 気づかれなかったことを受けて追加）。
 */
export async function notifyRadarSkip(context: string): Promise<void> {
  const url = process.env.RADAR_ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `:warning: FactBase Radar near-miss: ${context}`,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    console.warn(`[notify] webhook送信失敗: ${e}`);
  }
}
