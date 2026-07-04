import OpenAI from "openai";

function normalizeBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.replace(/\/$/, "");
  if (trimmed.endsWith("/openai/v1")) return trimmed;
  if (trimmed.includes(".openai.azure.com")) return `${trimmed}/openai/v1`;
  return trimmed;
}

export function createOpenAIClient(options?: {
  timeout?: number;
  maxRetries?: number;
}): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY or AZURE_OPENAI_API_KEY is not set");

  return new OpenAI({
    apiKey,
    baseURL: normalizeBaseUrl(
      process.env.OPENAI_BASE_URL ??
        process.env.AZURE_OPENAI_BASE_URL ??
        process.env.AZURE_OPENAI_ENDPOINT,
    ),
    timeout: options?.timeout,
    maxRetries: options?.maxRetries,
  });
}
