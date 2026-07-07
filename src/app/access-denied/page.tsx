import { auth } from "@/auth";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer } from "@/components/layout/page-container";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "アクセス制限",
  robots: { index: false },
};

export default async function AccessDeniedPage() {
  const session = await auth();

  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="mx-auto max-w-md py-16 text-center">
          <h1 className="mb-3 text-2xl font-extrabold tracking-tight text-ink">
            日本国内からのみご利用いただけます
          </h1>
          <p className="mb-8 text-sm leading-relaxed text-ink-secondary">
            FactBaseは日本国内のユーザー向けに運営しています。
            海外からのアクセス、またはVPN等で国が判別できない場合はご利用いただけません。
          </p>
          {session?.user ? (
            <Link href="/" className="text-sm font-medium text-link">
              トップへ戻る
            </Link>
          ) : (
            <Link href="/login" className="text-sm font-medium text-link">
              ログインページへ
            </Link>
          )}
        </div>
        <AppSidebar />
      </div>
    </PageContainer>
  );
}
