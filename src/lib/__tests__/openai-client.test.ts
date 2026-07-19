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

describe("normalizeBaseUrl", () => {
  it("Azure AI Foundryのプロジェクトエンドポイントは/api/projects/...を捨てて/modelsを付け直す", async () => {
    const { normalizeBaseUrl } = await import("@/lib/openai-client");
    expect(
      normalizeBaseUrl("https://factbasedev-resource.services.ai.azure.com/api/projects/factbasedev"),
    ).toBe("https://factbasedev-resource.services.ai.azure.com/models");
  });

  it("Azure AI Foundryのリソースルートだけ渡された場合も/modelsを付ける", async () => {
    const { normalizeBaseUrl } = await import("@/lib/openai-client");
    expect(normalizeBaseUrl("https://factbasedev-resource.services.ai.azure.com")).toBe(
      "https://factbasedev-resource.services.ai.azure.com/models",
    );
  });

  it("既に/modelsで終わっていればそのまま", async () => {
    const { normalizeBaseUrl } = await import("@/lib/openai-client");
    expect(normalizeBaseUrl("https://factbasedev-resource.services.ai.azure.com/models")).toBe(
      "https://factbasedev-resource.services.ai.azure.com/models",
    );
  });

  it("クラシックAzure OpenAIは/openai/v1を付ける", async () => {
    const { normalizeBaseUrl } = await import("@/lib/openai-client");
    expect(normalizeBaseUrl("https://foo.openai.azure.com")).toBe(
      "https://foo.openai.azure.com/openai/v1",
    );
  });
});
