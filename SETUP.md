# 根拠 — キー投入後のセットアップ手順（7/7ローンチ用）

コードは全機能実装済み・テスト/ビルド通過済み。残りは外部サービスのキー投入と本番反映のみ。

## 1. `.env.local` を作る

```bash
cp .env.example .env.local
# AUTH_SECRETを生成
openssl rand -hex 32
```

各キーの取得先:

| 変数 | 取得先 |
|---|---|
| DATABASE_URL / DIRECT_URL | neon.tech → プロジェクト作成 → Connection string（pooled / direct） |
| UPSTASH_REDIS_REST_URL / TOKEN | upstash.com → Redis作成 → REST API タブ |
| AUTH_GOOGLE_ID / SECRET | Google Cloud Console → OAuth client（redirect: `{origin}/api/auth/callback/google`） |
| AUTH_TWITTER_ID / SECRET | developer.twitter.com → OAuth 2.0 Web App（callback: `{origin}/api/auth/callback/twitter`） |
| STRIPE_* | 取得済み。Price ID 2つ（¥500/¥1000 月額サブスク）を確認 |
| OPENAI_API_KEY | platform.openai.com |
| ANTHROPIC_API_KEY | console.anthropic.com |

※ Upstash未設定でも起動する（in-memoryフォールバック）が、本番では必須。

## 2. DBスキーマ反映（Neon）

```bash
# Neonコンソールで一度だけ: CREATE EXTENSION IF NOT EXISTS vector;
npm run db:push
```

## 3. ローカル動作確認

```bash
npm run dev
# http://localhost:3000/login → Google/Xログイン
# 争点はまだDBに無いので次のステップで投入
```

## 4. 争点1本目の投入

一次情報（e-Gov法令・国会会議録）を手動コピペで `sources/` に保存してから:

```bash
npm run article -- \
  --slug consumption-tax-reduction \
  --title "消費税減税法案について" \
  --category POLITICS \
  --source ./sources/tax-law.txt \
  --law-name "消費税法" \
  --law-url "https://elaws.e-gov.go.jp/document?lawid=363AC0000000108"
```

nanoのチャンク提案を `y` で承認 → Sonnetが記事生成 → DB保存。

## 5. Stripe webhook（ローカル検証）

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# 表示されるwhsec_...を.env.localのSTRIPE_WEBHOOK_SECRETに
stripe trigger checkout.session.completed
```

## 6. Vercelデプロイ

```bash
# GitHubにpush → vercel.comでimport
# 環境変数を全部設定（AUTH_URLは本番URLに変更）
# Google/X OAuthのredirect URIに本番URLを追加
# Stripeダッシュボードでwebhookエンドポイント追加: {本番URL}/api/stripe/webhook
```

## 検証チェックリスト（デプロイ後）

- [ ] Google / X ログイン → ログアウト → 再ログイン
- [ ] 投票 → 別ブラウザで割合バーがSSEで自動更新される
- [ ] 無料アカウントでコメント欄が「500円プラン誘導」になっている
- [ ] Stripeテストカード(4242...)で500円プラン → コメント投稿できる
- [ ] NGワード入りコメントが拒否される
- [ ] 1000円プランでコメントのFCボタン → 判定表示 → 再タップで即返却(cached)
- [ ] 通報 → nano判定 → 違反コメントが非表示になる
- [ ] `/issues/{slug}/opengraph-image` で日本語入りOGP画像が出る

## テスト / 品質

```bash
npm run test        # unit tests (18件)
npm run typecheck   # TypeScript strict
npm run lint        # ESLint
npm run build       # production build
```
