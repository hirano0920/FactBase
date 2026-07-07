import { RankingView } from "@/components/ranking/ranking-view";

export const metadata = {
  title: "Hotな投票",
};

export const revalidate = 3600;

export default function RankingVotesPage() {
  return <RankingView sortBy="votes" />;
}
