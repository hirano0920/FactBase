import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { SITE } from "@/lib/constants";
import { Suspense } from "react";
import "./globals.css";

const notoSans = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.fullName,
    template: `%s | ${SITE.name}`,
  },
  description: SITE.description,
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: SITE.fullName,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={notoSans.variable}
      suppressHydrationWarning
    >
      <body className="min-h-screen flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <Suspense
            fallback={
              <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur-md">
                <div className="mx-auto flex h-12 max-w-wide items-center px-3 lg:h-14 lg:px-page">
                  <span className="text-base font-extrabold tracking-tighter text-ink lg:text-lg">
                    {SITE.displayName}
                  </span>
                </div>
              </header>
            }
          >
            <SiteHeader />
          </Suspense>
          <main className="flex-1 pb-16 lg:pb-0">{children}</main>
          <SiteFooter />
          <Suspense fallback={null}>
            <BottomNav />
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
