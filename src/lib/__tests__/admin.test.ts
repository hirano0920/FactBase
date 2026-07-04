import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdminEmails, isAdminEmail } from "@/lib/admin-emails";

describe("admin access", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ADMIN_EMAILS 未設定時は誰も管理者にならない", () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(getAdminEmails()).toEqual([]);
    expect(isAdminEmail("admin@factbase.tokyo")).toBe(false);
  });

  it("カンマ区切りメールを正規化して照合", () => {
    vi.stubEnv("ADMIN_EMAILS", " Admin@Example.com , mod@factbase.tokyo ");
    expect(isAdminEmail("admin@example.com")).toBe(true);
    expect(isAdminEmail("mod@factbase.tokyo")).toBe(true);
    expect(isAdminEmail("other@gmail.com")).toBe(false);
  });
});
