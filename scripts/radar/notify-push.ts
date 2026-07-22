/**
 * Webプッシュの朝ダイジェスト送信。
 * 「おはようございます。昨晩から動いている争点」= アクティブDebateのうち直近12時間で
 * 投票・コメントが多い順の上位1件をタイトルにして全購読者へ送る。
 * 無効になった購読（404/410）はその場で削除する。
 *
 * 必要な環境変数: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT（mailto:）
 * 実行: npx tsx scripts/radar/notify-push.ts [--dry-run]
 */
import webpush from "web-push";
import { prisma } from "../../src/lib/prisma";
import { listSurgingIssues } from "../../src/lib/moderation-actions";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:info@twosides.jp";
  if (!publicKey || !privateKey) {
    console.warn("⚠️ VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 未設定のためスキップ");
    return;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  // 直近12時間で最も動いた争点（朝ダイジェストなので夜間の動きを拾う）
  const surging = await listSurgingIssues(12, 3);
  if (surging.length === 0) {
    console.log("動いている争点が無いため送信しない（無内容の通知は購読解除の最大要因）");
    return;
  }
  const top = surging[0];
  const others = surging.length - 1;
  const payload = JSON.stringify({
    title: "今朝の動いている争点",
    body: `「${top.title}」に${top.recentVotes}票・${top.recentComments}件の意見${others > 0 ? ` ほか${others}件` : ""}`,
    url: `/issues/${top.slug}`,
    tag: "morning-digest", // 同日の重複送信をOS側で1つにまとめる
  });

  const subs = await prisma.pushSubscription.findMany();
  console.log(`購読 ${subs.length}件へ送信${DRY_RUN ? "（dry-run: 送信しない）" : ""}`);
  if (DRY_RUN) {
    console.log(`  payload: ${payload}`);
    return;
  }

  let sent = 0;
  let removed = 0;
  for (const sub of subs) {
    const keys = sub.keysJson as { p256dh: string; auth: string };
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys }, payload);
      sent++;
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        removed++;
      } else {
        console.warn(`  ⚠️ 送信失敗 (${statusCode ?? e})`);
      }
    }
  }
  console.log(`送信 ${sent}件 / 無効購読の削除 ${removed}件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
