/**
 * Radarスクリプト（tsx単体プロセス）から Next.js の revalidatePath / Redis無効化を
 * 叩くためのベストエフォート通知。失敗してもジョブは継続する（1時間ISRがフォールバック）。
 */
export async function notifyRevalidate(slug: string, issueId: string): Promise<void> {
  const base = process.env.AUTH_URL;
  const secret = process.env.RADAR_INTERNAL_SECRET;
  if (!base || !secret) return;

  try {
    await fetch(`${base.replace(/\/$/, "")}/api/internal/radar-revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ slug, issueId }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.warn(`  ⚠️ revalidate通知失敗（1時間ISRにフォールバック）: ${e}`);
  }
}
