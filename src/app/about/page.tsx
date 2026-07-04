import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section, SectionTitle } from "@/components/layout/page-container";

export const metadata = {
  title: "About",
};

export default function AboutPage() {
  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-8">
            <h1 className="text-3xl font-extrabold tracking-tight text-ink">About</h1>
            <p className="mt-3 text-ink-muted">
              一次情報にもとづき、冷静に議論できる場所をつくっています。
            </p>
          </header>

          <div className="space-y-6">
            <Section>
              <SectionTitle>ミッション</SectionTitle>
              <p className="text-sm leading-relaxed text-ink-secondary">
                Xのような誹謗中傷と無根拠の拡散ではなく、法令・国会の一次情報を手がかりにした討論の場を提供します。
                アルゴリズムによるおすすめはなく、争点ごとに投票と議論が行われます。
              </p>
            </Section>

            <Section>
              <SectionTitle>運営</SectionTitle>
              <p className="text-sm leading-relaxed text-ink-secondary">
                慶應義塾大学の学生が開発・運営しています。政治家を志し、教育者を親に持つ環境の中で、
                根拠のある対話の重要性を学んできました。学内ビジネスコンテスト優勝。
              </p>
              <p className="mt-4 text-sm text-ink-muted">
                特定の政党・思想を支持するものではありません。
              </p>
            </Section>

            <Section>
              <SectionTitle>他サービスとの違い</SectionTitle>
              <ul className="space-y-2 text-sm text-ink-secondary">
                <li>· みんなの国会の「わかりやすさ」+ 投票・議論</li>
                <li>· 好き嫌い.comの「投票」− 誹謗中傷</li>
                <li>· Xの「拡散」− 算法・匿名荒らし</li>
              </ul>
            </Section>
          </div>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
