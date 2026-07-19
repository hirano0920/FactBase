import { prisma } from "@/lib/prisma";
import type { PoliticianStance } from "@prisma/client";

export interface DietVoteForTagging {
  parties: { party: string; memberCount: number; for: number; against: number }[];
  defectors: { name: string; party: string; vote: "for" | "against" | "abstain"; role: string | null }[];
}

const VOTE_TO_STANCE: Record<"for" | "against" | "abstain", PoliticianStance> = {
  for: "FOR",
  against: "AGAINST",
  abstain: "ABSTAIN",
};

/** 政党名・議員名をslugとして流用する（日本語名はローマ字化せずそのままURLに使える） */
async function upsertPolitician(name: string, party: string | null): Promise<string> {
  const politician = await prisma.politician.upsert({
    where: { slug: name },
    update: party ? { party } : {},
    create: { slug: name, name, party },
    select: { id: true },
  });
  return politician.id;
}

/**
 * 参議院本会議の記名投票結果(dietVote)から、政党単位(多数派の賛否)+離反者個人(実際の投票)を
 * IssuePoliticianとして自動タグ付けする。手動タグ付けを待たずに、法案系争点は公開と同時に
 * 政治家/政党の争点横断・説得力スコア(politician-persuasion.ts)の集計対象になる。
 * 離反者は党の多数派と別に自分自身の実際の投票(stance)で上書きされる。
 */
export async function tagPoliticiansFromDietVote(
  issueId: string,
  dietVote: DietVoteForTagging,
): Promise<void> {
  for (const party of dietVote.parties) {
    if (party.for === 0 && party.against === 0) continue;
    const majorityStance: PoliticianStance = party.for >= party.against ? "FOR" : "AGAINST";
    const politicianId = await upsertPolitician(party.party, party.party);
    await prisma.issuePolitician.upsert({
      where: { issueId_politicianId: { issueId, politicianId } },
      update: { stance: majorityStance, source: "dietVote:party" },
      create: { issueId, politicianId, stance: majorityStance, source: "dietVote:party" },
    });
  }

  for (const defector of dietVote.defectors) {
    const politicianId = await upsertPolitician(defector.name, defector.party);
    const stance = VOTE_TO_STANCE[defector.vote];
    await prisma.issuePolitician.upsert({
      where: { issueId_politicianId: { issueId, politicianId } },
      update: { stance, source: "dietVote:defector" },
      create: { issueId, politicianId, stance, source: "dietVote:defector" },
    });
  }
}
