/**
 * .env.local の入力漏れチェック。
 * 使い方: npx tsx scripts/check-env.ts
 */
import { existsSync, readFileSync } from "node:fs";

const REQUIRED = [
  { key: "DATABASE_URL", group: "Neon" },
  { key: "DIRECT_URL", group: "Neon" },
  { key: "AUTH_SECRET", group: "Auth.js" },
  { key: "AUTH_URL", group: "Auth.js" },
  { key: "AUTH_GOOGLE_ID", group: "Auth.js" },
  { key: "AUTH_GOOGLE_SECRET", group: "Auth.js" },
  { key: "AUTH_TWITTER_ID", group: "Auth.js" },
  { key: "AUTH_TWITTER_SECRET", group: "Auth.js" },
  { key: "STRIPE_SECRET_KEY", group: "Stripe" },
  { key: "STRIPE_WEBHOOK_SECRET", group: "Stripe" },
  { key: "STRIPE_PRICE_COMMENT", group: "Stripe" },
  { key: "STRIPE_PRICE_FACTCHECK", group: "Stripe" },
  { key: "OPENAI_API_KEY", group: "AI" },
  { key: "OPENAI_BASE_URL", group: "AI" },
  { key: "UPSTASH_REDIS_REST_URL", group: "Upstash (無くても起動はする)" },
  { key: "UPSTASH_REDIS_REST_TOKEN", group: "Upstash (無くても起動はする)" },
] as const;

const OPTIONAL = [
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", // 現状コードは未使用（Checkoutのみ）
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_BASE_URL",
  "YOUTUBE_DATA_API_KEY", // 未設定でもRadarは動く（YouTubeソースのみスキップ）
  "TAVILY_API_KEY", // 未設定でもRadarは動く（Tavily検索による収集拡張のみスキップ）
  "RADAR_INTERNAL_SECRET", // 未設定でもRadarは動くがrevalidate通知がスキップされる
];

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...parseEnvFile(".env.local"), ...process.env };

let missing = 0;
let lastGroup = "";
for (const { key, group } of REQUIRED) {
  if (group !== lastGroup) {
    console.log(`\n[${group}]`);
    lastGroup = group;
  }
  const value = env[key];
  const ok = Boolean(value && value.trim());
  console.log(`  ${ok ? "✅" : "❌"} ${key}`);
  if (!ok) missing++;
}

console.log("\n[未使用・任意]");
for (const key of OPTIONAL) {
  console.log(`  ⚪ ${key}（現状コードから未参照。今すぐ入れなくてよい）`);
}

console.log(
  missing === 0
    ? "\n✅ 必須項目はすべて入力済みです。次は npm run db:push へ。"
    : `\n❌ ${missing}件未入力です。上のリストで❌のものを.env.localに追記してください。`,
);
process.exit(missing === 0 ? 0 : 1);
