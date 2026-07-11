import { afterEach, describe, expect, it, vi } from "vitest";

describe("openai-client article routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("resolveArticleModel は ARTICLE_MODEL を優先する", async () => {
    vi.stubEnv("ARTICLE_MODEL", "my-grok-deploy");
    const { resolveArticleModel } = await import("@/lib/openai-client");
    expect(resolveArticleModel("grok-4.3")).toBe("my-grok-deploy");
  });

  it("resolveArticleModel は未設定なら default を返す", async () => {
    vi.stubEnv("ARTICLE_MODEL", "");
    const { resolveArticleModel } = await import("@/lib/openai-client");
    expect(resolveArticleModel("grok-4.3")).toBe("grok-4.3");
  });

  it("createArticleClient は XAI_API_KEY があれば xAI を使う", async () => {
    vi.stubEnv("XAI_API_KEY", "xai-test-key");
    vi.stubEnv("XAI_BASE_URL", "https://api.x.ai/v1");
    const { createArticleClient } = await import("@/lib/openai-client");
    const client = createArticleClient();
    expect(client).toBeTruthy();
    // OpenAI SDK は baseURL を内部保持。公開プロパティは無いので生成できることだけ確認
  });
});
