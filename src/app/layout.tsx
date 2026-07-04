import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { BottomNav } from "@/components/layout/bottom-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const notoSans = Noto_Sans_JP({
  subsets: ["latin"],
  variable: "--font-noto-sans",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://factbase.tokyo"),
  title: {
    default: "FactBase — 一次情報で、日本の議論をクリーンに",
    template: "%s | FactBase",
  },
  description:
    "時事・政治・経済・金融・法律などの一次情報にもとづき、冷静に投票・議論できるプラットフォーム。誹謗中傷のない、透明な議論の場。",
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "FactBase",
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
          <SiteHeader />
          <main className="flex-1 pb-16 sm:pb-0">{children}</main>
          <SiteFooter />
          <BottomNav />
        </ThemeProvider>
      </body>
    </html>
  );
}
