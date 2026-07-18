import OpenAI from "openai";
import { AI_MODELS } from "@/lib/constants";

function normalizeBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.replace(/\/$/, "");
  // 既にパス付きならそのまま（/v1, /openai/v1, /models 等）
  if (
    trimmed.endsWith("/v1") ||
    trimmed.endsWith("/openai/v1") ||
    trimmed.endsWith("/models")
  ) {
    return trimmed;
  }
  // Azure OpenAI（クラシック）
  if (trimmed.includes(".openai.azure.com")) return `${trimmed}/openai/v1`;
  // Azure AI Foundry Models（Grok 等）— OpenAI SDK 互換は /models
  if (trimmed.includes("services.ai.azure.com")) return `${trimmed}/models`;
  if (trimmed.includes("api.x.ai")) return `${trimmed}/v1`;
  return trimmed;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    const t = v?.trim();
    if (t) return t;
  }
  return undefined;
}

/** FC・選別・検証など（Azure gpt-5-nano / mini 想定） */
export function createOpenAIClient(options?: {
  timeout?: number;
  maxRetries?: number;
}): OpenAI {
  const apiKey = firstNonEmpty(process.env.OPENAI_API_KEY, process.env.AZURE_OPENAI_API_KEY);
  if (!apiKey) throw new Error("OPENAI_API_KEY or AZURE_OPENAI_API_KEY is not set");

  return new OpenAI({
    apiKey,
    baseURL: normalizeBaseUrl(
      firstNonEmpty(
        process.env.OPENAI_BASE_URL,
        process.env.AZURE_OPENAI_BASE_URL,
        process.env.AZURE_OPENAI_ENDPOINT,
      ),
    ),
    timeout: options?.timeout,
    maxRetries: options?.maxRetries,
  });
}

/**
 * 記事生成専用クライアント。
 * 優先順: ARTICLE_*（Azure Foundry Grok）→ xAI直 → 既存 Azure/OpenAI
 */
export function createArticleClient(options?: {
  timeout?: number;
  maxRetries?: number;
}): OpenAI {
  const articleKey = firstNonEmpty(
    process.env.ARTICLE_API_KEY,
    process.env.OPENAI_API_KEY,
    process.env.AZURE_OPENAI_API_KEY,
  );
  const articleBase = firstNonEmpty(
    process.env.ARTICLE_BASE_URL,
    process.env.OPENAI_BASE_URL,
    process.env.AZURE_OPENAI_BASE_URL,
    process.env.AZURE_OPENAI_ENDPOINT,
  );

  // Foundry 用に ARTICLE_BASE_URL がある、または XAI が無い場合は Azure 系を使う
  if (articleKey && (process.env.ARTICLE_BASE_URL?.trim() || !process.env.XAI_API_KEY?.trim())) {
    const rawBase = articleBase?.replace(/\/$/, "");
    // ★★★ Azure OpenAI（.openai.azure.com）の場合、デプロイメントパスを自動構築。
    // 正しい形式: https://{resouce}.openai.azure.com/openai/deployments/{deployment}
    // normalizeBaseUrl は /openai/v1 を付けてしまうので使わない。
    const isAzureOpenAI = rawBase?.includes(".openai.azure.com");
    const model = resolveArticleModel(AI_MODELS.article);
    const azureBaseUrl = isAzureOpenAI
      ? `${rawBase}/openai/deployments/${model}`
      : normalizeBaseUrl(rawBase);
    return new OpenAI({
      apiKey: articleKey,
      baseURL: azureBaseUrl,
      defaultQuery: isAzureOpenAI ? { "api-version": "2025-01-01-preview" } : undefined,
      defaultHeaders: isAzureOpenAI ? { "api-key": articleKey } : undefined,
      timeout: options?.timeout,
      maxRetries: options?.maxRetries,
    });
  }

  const xaiKey = firstNonEmpty(process.env.XAI_API_KEY);
  if (xaiKey) {
    return new OpenAI({
      apiKey: xaiKey,
      baseURL: normalizeBaseUrl(
        firstNonEmpty(process.env.XAI_BASE_URL, "https://api.x.ai/v1"),
      ),
      timeout: options?.timeout,
      maxRetries: options?.maxRetries,
    });
  }

  if (!articleKey) {
    throw new Error(
      "Article client: set ARTICLE_API_KEY / OPENAI_API_KEY / AZURE_OPENAI_API_KEY, or XAI_API_KEY",
    );
  }

  return new OpenAI({
    apiKey: articleKey,
    baseURL: normalizeBaseUrl(articleBase),
    timeout: options?.timeout,
    maxRetries: options?.maxRetries,
  });
}

/** 記事生成モデル名。Azure Foundry ではデプロイ名を ARTICLE_MODEL で上書き */
export function resolveArticleModel(defaultModel: string): string {
  return firstNonEmpty(process.env.ARTICLE_MODEL, defaultModel) ?? defaultModel;
}
