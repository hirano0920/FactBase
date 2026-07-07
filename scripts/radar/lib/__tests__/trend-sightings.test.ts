import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { recordSightings, getSustainedTerms, pruneStaleSightings } from "../trend-sightings";

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return { trendSighting: { upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(), ...overrides } } as unknown as PrismaClient;
}

describe("recordSightings", () => {
  it("重複を除いた各termをupsertする", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = fakePrisma({ upsert });
    await recordSightings(prisma, "google_trends", ["A", "B", "A"]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0].where).toEqual({ term_source: { term: "A", source: "google_trends" } });
  });
});

describe("getSustainedTerms", () => {
  it("sightingCountと出現期間の両方が閾値を超えた語だけを返す", async () => {
    const now = Date.now();
    const findMany = vi.fn().mockResolvedValue([
      { term: "継続話題", firstSeenAt: new Date(now - 4 * 60 * 60_000), lastSeenAt: new Date(now) }, // 4h span
      { term: "瞬間バズ", firstSeenAt: new Date(now - 30 * 60_000), lastSeenAt: new Date(now) }, // 30min span
    ]);
    const prisma = fakePrisma({ findMany });
    const terms = await getSustainedTerms(prisma, "google_trends");
    expect(terms).toEqual(["継続話題"]);
    expect(findMany.mock.calls[0][0].where.sightingCount).toEqual({ gte: 6 });
  });
});

describe("pruneStaleSightings", () => {
  it("72時間分のカットオフでdeleteManyを呼ぶ", async () => {
    const deleteMany = vi.fn().mockResolvedValue({});
    const prisma = fakePrisma({ deleteMany });
    await pruneStaleSightings(prisma);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const cutoff = deleteMany.mock.calls[0][0].where.lastSeenAt.lt as Date;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(71 * 60 * 60_000);
  });
});
