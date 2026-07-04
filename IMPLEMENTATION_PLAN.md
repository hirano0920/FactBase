# 根拠 — 7/7ローンチ 実装ブループリント

確定した意思決定を記録する。実装中はこのファイルを正として、迷ったら聞き返さずここに従う。

## 0. 確定スタック

- Hosting: Vercel (Hobby, $0)
- DB: Neon Postgres (Free tier) + pgvector extension
- Cache/Realtime: Upstash Redis (Free tier, REST-based)
- Auth: Auth.js v5, providers = Google + Twitter(X) のみ（LINEは不採用）
- Payment: Stripe Checkout（既存キー使用可、実装のみ残っている）
- AI: Anthropic `claude-sonnet-4-5-20250929`（記事生成）/ OpenAI `gpt-5-nano`（FC・通報・法令提案）/ `text-embedding-3-small`（embedding）

## 1. Schema変更（prisma/schema.prisma）

- `User.lineId` を削除 → `User.twitterId String? @unique` に置き換え
- `Account` / `Session` は Auth.js標準のままでOK（provider="google"|"twitter"がAccount.providerに入るので、User.twitterId等の冗長カラムは実は不要。Auth.js標準のAccountテーブルだけで十分 → **User.googleId / User.twitterId は削除してよい**。Accountテーブルのprovider+providerAccountIdで一意性は担保される）
- `Vote` モデルが現状スキーマに見当たらないので追加:
```prisma
model Vote {
  id      String     @id @default(cuid())
  userId  String
  issueId String
  choice  VoteChoice
  createdAt DateTime @default(now())

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  issue Issue @relation(fields: [issueId], references: [id], onDelete: Cascade)

  @@unique([userId, issueId])
}
```
- `Issue` に `voteForCount Int @default(0)` / `voteAgainstCount Int @default(0)` / `voteUndecidedCount Int @default(0)` の非正規化カウンタを追加（毎回集計しないため。Redisが真実のソース、DBは非同期で追従）

## 2. 環境変数（.env.example更新）

```
DATABASE_URL=          # Neon pooled connection string
DIRECT_URL=            # Neon direct (for prisma migrate)
AUTH_SECRET=
AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TWITTER_CLIENT_ID=     # X OAuth 2.0 (free tier, login-only scope: users.read tweet.read)
TWITTER_CLIENT_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_COMMENT=   # 500円 price id
STRIPE_PRICE_FACTCHECK= # 1000円 price id
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```
LINE関連の3行は削除。

## 3. 追加パッケージ

```
npm i @upstash/redis stripe openai @anthropic-ai/sdk
```
（next-authは既にv5 beta導入済み、Twitterプロバイダは`next-auth/providers/twitter`で追加パッケージ不要）

## 4. Auth.js設定（src/auth.ts 新規）

- Providers: `Google`, `Twitter`（`version: "2.0"`指定必須。X無料枠のOAuth2.0ログインで動作、tweet投稿権限は不要なのでscopeは`users.read`のみ）
- Adapter: `PrismaAdapter`
- Session strategy: `database`（Session/Accountテーブルを使うため）
- `callbacks.session`にuser.planを埋め込む（毎回DBクエリ発生するので許容、あるいはJWT戦略+plan変更時のみ再発行でもよいが今回はdatabase戦略で単純にいく）

## 5. API設計（契約を固定）

### POST /api/votes
Request: `{ issueId: string, choice: "for"|"against"|"undecided" }`
- 未ログイン → 401
- 処理: Upstash Redisで `HINCRBY vote:{issueId} {choice} 1`（既存投票があれば旧選択肢をデクリメントしてから）、Postgresの`Vote` upsertを非同期(await可、軽いので同期でOK)
- Response: `{ tally: VoteTally }`（Redisから最新値を返す＝レスポンス自体はリアルタイム反映不要、SSEが担当）

### GET /api/votes/stream?issueId=xxx (SSE)
- `ReadableStream`で1〜2秒間隔でRedis `HGETALL vote:{issueId}` をpollしてJSON tallyをevent送信
- Vercel Function `maxDuration=60`程度、クライアント側は切断時に自動再接続（EventSource標準機能）

### POST /api/comments
Request: `{ issueId, stance, body }`
- Planチェック: `FREE`は403（コメント不可）、`COMMENT`/`FACTCHECK`のみ許可
- `moderateOnSubmit(body)`通過必須
- 新規アカウント24h制限チェック（`user.createdAt`）
- 同文面協調投稿検知（直近同issueの同文面4件以上で自動非表示 `isHidden=true`）

### POST /api/comments/:id/factcheck
- Planが`FACTCHECK`でなければ403
- `FcCache`にcommentId一致があれば即返却
- なければ: RAG（`LawChunk`をissueId経由で3件取得、pgvector類似検索は今回のスコープでは"issueに紐づく全チャンク"で十分、embedding類似検索は後回し可）→ nano呼び出し→ `FcCache`保存

### POST /api/comments/:id/report
- nano判定 → `resolved`更新、閾値超えで`isHidden=true`

### POST /api/stripe/checkout
Request: `{ plan: "COMMENT"|"FACTCHECK" }` → Stripe Checkout Session作成、successUrl/cancelUrl固定

### POST /api/stripe/webhook
- `checkout.session.completed` → `User.plan`更新
- `customer.subscription.deleted` → `plan = FREE`

## 6. FCパイプライン（擬似コード固定）

```
POST /api/comments/:id/factcheck
  comment = getComment(id)
  cached = FcCache.findUnique({commentId})
  if cached: return cached

  chunks = LawChunk.findMany({ where: { issueLinks: { some: { issueId: comment.issueId } } }, take: 3 })
  prompt = buildFcPrompt(comment.body, chunks)  // 一次情報のみ、Web検索なし
  result = openai.chat({ model: "gpt-5-nano", response_format: json, messages: [prompt] })
  // result: { v: "true"|"false"|"unknown"|"opinion", r: string, s: string[] (sourceIds) }
  FcCache.create({ commentId, verdict, reason, sourceIds, resultJson })
  return result
```

## 7. 記事生成（手動トリガー、7/7では自動化しない）

- 管理用スクリプト `scripts/generate-article.ts`（CLIで手動実行、管理画面UIは作らない＝時間節約）
- 入力: 手動で用意した法令テキスト・国会会議録抜粋（scraping自動化はしない、コピペで十分）
- `nano`で関連法令チャンク化提案 → 承認 → `LawChunk`保存 → embedding生成 → `Sonnet`で記事生成 → `Issue.summaryJson`/`articleHtml`保存

## 8. NGワード・モデレーション

既存`src/lib/moderation.ts`をそのまま使用（実装済み・変更不要）。`BLOCK_WORDS`は将来拡張、7/7では現状のリストで進める。

## 9. スコープ外（7/7では作らない）

- LINEログイン
- 管理画面UI（スクリプト直叩きで代替）
- 称号(UserBadge)の自動付与ロジック（テーブルのみ用意、UI表示のみ）
- 知恵袋(/qa)
- 法令自動スクレイピング・embedding差分更新cron
- ランキングの高度なtrendScore計算（単純に投票数でソート）

## 10. 実装順序（依存関係順）

1. schema変更 + `prisma db push`（Neon接続）
2. Auth.js (`src/auth.ts` + `app/api/auth/[...nextauth]/route.ts` + middleware)
3. Upstash Redis client (`src/lib/redis.ts`)
4. `/api/votes` + `/api/votes/stream` + `VotePanel`をAPI接続に差し替え
5. `/api/comments` (投稿/取得) + `CommentCard`をAPI接続
6. Stripe: price作成確認 → `/api/stripe/checkout` + `/api/stripe/webhook` + `/pricing`ページ接続
7. FC: `/api/comments/:id/factcheck` + UIボタン接続
8. Report: `/api/comments/:id/report`
9. 争点1本の実データ投入（`scripts/generate-article.ts`）+ OGP
10. Vercelデプロイ + 本番環境変数設定 + 動作確認
