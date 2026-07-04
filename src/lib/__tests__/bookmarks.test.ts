import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bookmark: { findMany: mocks.findMany, findUnique: mocks.findUnique },
  },
}));

import { getBookmarkedIssues, isBookmarked } from "@/lib/data";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getBookmarkedIssues", () => {
  it("DB未接続時は空配列（mock-dataフォールバック）", async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(await getBookmarkedIssues("u1")).toEqual([]);
    if (original) process.env.DATABASE_URL = original;
  });
});

describe("isBookmarked", () => {
  it("DB未接続時はfalse", async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(await isBookmarked("u1", "i1")).toBe(false);
    if (original) process.env.DATABASE_URL = original;
  });
});
