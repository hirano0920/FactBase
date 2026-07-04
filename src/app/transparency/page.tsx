import { AppSidebar } from "@/components/layout/app-sidebar";
import { PageContainer, Section, SectionTitle } from "@/components/layout/page-container";
import { AI_MODELS } from "@/lib/constants";

export const metadata = {
  title: "透明性",
};

export default function TransparencyPage() {
  return (
    <PageContainer>
      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <div className="min-w-0 max-w-content">
          <header className="mb-8">
            <h1 className="text-3xl font-extrabold tracking-tight text-ink">透明性</h1>
            <p className="mt-3 text-ink-muted">
              使用するAI、モデレーション基準、データの扱いを公開します。
            </p>
          </header>

          <div className="space-y-6">
            <Section>
              <SectionTitle>使用AI</SectionTitle>
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="font-medium text-ink">記事・要約</dt>
                  <dd className="mt-1 text-ink-muted">{AI_MODELS.article}</dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">FC・通報判定</dt>
                  <dd className="mt-1 text-ink-muted">{AI_MODELS.utility}</dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">ベクトル検索</dt>
                  <dd className="mt-1 text-ink-muted">{AI_MODELS.embedding}</dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">中国製AI</dt>
                  <dd className="mt-1 text-ink-muted">一切使用しません</dd>
                </div>
              </dl>
            </Section>

            <Section>
              <SectionTitle>ファクトチェックの原則</SectionTitle>
              <ul className="space-y-2 text-sm text-ink-secondary">
                <li>· 根拠は e-Gov・国会会議録・政治資金などの一次情報のみ</li>
                <li>· Web検索は使用しません</li>
                <li>· 一次情報にない主張は「不明」と表示します</li>
                <li>· 同一コメントへのFC結果は全ユーザーで共有します</li>
              </ul>
            </Section>

            <Section>
              <SectionTitle>インフラ</SectionTitle>
              <ul className="space-y-2 text-sm text-ink-secondary">
                <li>· サーバー: 日本国内リージョン</li>
                <li>· 特定政党・政治団体からの資金提供なし</li>
                <li>· 月次透明性レポートを公開予定</li>
              </ul>
            </Section>
          </div>
        </div>

        <AppSidebar />
      </div>
    </PageContainer>
  );
}
