import Link from "next/link";
import { SITE } from "@/lib/constants";

const FOOTER_LINKS = [
  { href: "/about", label: `${SITE.name}を知る` },
  { href: "/transparency", label: "透明性" },
  { href: "/security", label: "セキュリティ" },
  { href: "/pricing", label: "料金" },
  { href: "/terms", label: "利用規約" },
  { href: "/privacy", label: "プライバシー" },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-surface-muted">
      <div className="mx-auto max-w-wide px-page py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="max-w-sm">
            <p className="font-serif text-base font-semibold text-ink">
              {SITE.name}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {SITE.tagline}
              <br />
              サーバーは日本国内。使用AIの詳細は
              <Link href="/transparency" className="text-ink-secondary hover:text-ink">
                透明性ページ
              </Link>
              へ。
            </p>
          </div>

          <nav
            className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3"
            aria-label="フッター"
          >
            {FOOTER_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-ink-muted no-underline hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-10 border-t border-border pt-6">
          <p className="text-xs text-ink-faint">
            © {new Date().getFullYear()} {SITE.name}. 特定の政党・思想を支持するものではありません。
          </p>
        </div>
      </div>
    </footer>
  );
}
