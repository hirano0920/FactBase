import { describe, expect, it } from "vitest";
import { qualifiesVerifiedBadge } from "@/lib/fc-display";

describe("qualifiesVerifiedBadge", () => {
  it("TRUE + Plus/Pro で true", () => {
    expect(qualifiesVerifiedBadge("TRUE", "COMMENT")).toBe(true);
    expect(qualifiesVerifiedBadge("TRUE", "FACTCHECK")).toBe(true);
  });

  it("TRUE + Free は false", () => {
    expect(qualifiesVerifiedBadge("TRUE", "FREE")).toBe(false);
  });

  it("FALSE は false", () => {
    expect(qualifiesVerifiedBadge("FALSE", "FACTCHECK")).toBe(false);
  });
});
