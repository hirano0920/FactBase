import { describe, expect, it } from "vitest";
import { getLikeTitle, getUserReputation, reputationProgress } from "@/lib/reputation";

describe("getUserReputation", () => {
  it("無料は常に Newbie", () => {
    expect(getUserReputation("FREE", 0).label).toBe("Newbie");
    expect(getUserReputation("FREE", 999).emoji).toBe("🔰");
  });

  it("Plus は指定コメント数で tier が上がる", () => {
    expect(getUserReputation("COMMENT", 0).label).toBe("Tier3");
    expect(getUserReputation("COMMENT", 10).label).toBe("Tier2");
    expect(getUserReputation("COMMENT", 100).label).toBe("Tier1");
    expect(getUserReputation("COMMENT", 500).label).toBe("Professional");
    expect(getUserReputation("COMMENT", 500).emoji).toBe("🎓");
  });

  it("Pro は Amateur から Master へ", () => {
    expect(getUserReputation("FACTCHECK", 0).label).toBe("Amateur");
    expect(getUserReputation("FACTCHECK", 10).label).toBe("Proficient");
    expect(getUserReputation("FACTCHECK", 150).label).toBe("Professional");
    expect(getUserReputation("FACTCHECK", 500).label).toBe("Master");
    expect(getUserReputation("FACTCHECK", 500).emoji).toBe("👑");
  });
});

describe("getLikeTitle", () => {
  it("累計 like で称号が決まる", () => {
    expect(getLikeTitle(99)).toBeNull();
    expect(getLikeTitle(100)?.label).toBe("Scholar学者");
    expect(getLikeTitle(500)?.label).toBe("Philosopher哲学者");
    expect(getLikeTitle(5000)?.label).toBe("Great Sage大賢者");
  });
});

describe("reputationProgress", () => {
  it("次の tier までの残りコメント数を返す", () => {
    const p = reputationProgress("COMMENT", 5);
    expect(p.current.label).toBe("Tier3");
    expect(p.next?.label).toBe("Tier2");
    expect(p.commentsToNext).toBe(5);
  });
});
