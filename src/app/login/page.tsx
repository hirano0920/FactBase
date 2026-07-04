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

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { error } = await searchParams;
  const errorMessage = error ? (LOGIN_ERRORS[error] ?? LOGIN_ERRORS.Default) : null;

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          <div className="mx-auto max-w-sm py-16 text-center">
            <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-ink">ログイン</h1>
            <p className="mb-8 text-sm text-ink-secondary">
              投票・共感にはログインが必要です。
              <br />
              メールアドレスが公開されることはありません。
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
                  await signIn("google", { redirectTo: "/" });
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
