import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer } from "@/components/layout/page-container";
import { REGISTRATION_IP_WINDOW_DAYS } from "@/lib/registration-guard";
import { SITE } from "@/lib/constants";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ログイン",
  description: `${SITE.name}にログインして投票・議論に参加する`,
};

const LOGIN_ERRORS: Record<string, string> = {
  GeoBlocked:
    "新規登録には日本国内からの接続が必要です。接続元の国を判定できない場合も登録できません。VPNをオフにしてお試しください。",
  IpLimit: `このネットワーク（IPアドレス）では、過去${REGISTRATION_IP_WINDOW_DAYS}日以内にアカウントが登録されています。別の回線をお試しいただくか、時間をおいてから再度お試しください。`,
  AccessDenied: "ログインできませんでした。もう一度お試しください。",
  Configuration: "認証の設定に問題があります。しばらくしてからお試しください。",
  Default: "ログインに失敗しました。もう一度お試しください。",
};

/** オープンリダイレクト防止: サイト内の絶対パスのみ許可（"//evil.com"のようなプロトコル相対URLは弾く） */
function safeRedirectTarget(raw: string | undefined): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

const INTENT_MESSAGES: Record<string, { title: string; body: string }> = {
  checkout: {
    title: "プラン登録にはログインが必要です",
    body: "3日間の無料トライアルを始めるには、まずログインしてアカウントを作成してください。決済情報の入力はこのあとです。",
  },
  vote: {
    title: "投票にはログインが必要です",
    body: "誰が投票したか一覧で表示されることはありません。1人1アカウントで、意見の重複集計を防いでいます。",
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string; intent?: string }>;
}) {
  const session = await auth();
  const { error, redirect: redirectParam, intent } = await searchParams;
  const redirectTo = safeRedirectTarget(redirectParam);
  if (session?.user) redirect(redirectTo);

  const errorMessage = error ? (LOGIN_ERRORS[error] ?? LOGIN_ERRORS.Default) : null;
  const intentMessage = intent ? INTENT_MESSAGES[intent] : undefined;

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          <div className="mx-auto max-w-sm py-16 text-center">
            <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-ink">
              {intentMessage?.title ?? "ログイン"}
            </h1>
            <p className="mb-8 text-sm text-ink-secondary">
              {intentMessage?.body ?? (
                <>
                  投票・共感にはログインが必要です。
                  <br />
                  メールアドレスが公開されることはありません。
                </>
              )}
            </p>

            {errorMessage && (
              <p
                role="alert"
                className="mb-6 rounded-md border border-against/30 bg-against/5 px-4 py-3 text-left text-sm text-against"
              >
                {errorMessage}
              </p>
            )}

            <div className="space-y-3">
              <form
                action={async () => {
                  "use server";
                  await signIn("google", { redirectTo });
                }}
              >
                <button
                  type="submit"
                  className="w-full rounded-md border border-border bg-white px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
                >
                  Google でログイン
                </button>
              </form>

              <p className="text-xs text-ink-faint">Xログインは現在準備中です。</p>
            </div>

            <p className="mt-8 text-xs leading-relaxed text-ink-faint">
              ログインすることで、冷静な議論のためのコミュニティルールに同意したものとみなされます。
              <br />
              新規登録は日本国内からのみ。同一IPアドレスからは{REGISTRATION_IP_WINDOW_DAYS}
              日に1アカウントまでです。
            </p>
          </div>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
