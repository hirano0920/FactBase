import { RankingView } from "@/components/ranking/ranking-view";

export const metadata = {
  title: "ランキング",
};

// searchParams を使わない＝ISR/R2キャッシュが効く（以前 ?sort= で毎回フルSSRしていた）
export const revalidate = 3600;

export default function RankingPage() {
  return <RankingView sortBy="comments" />;
}
