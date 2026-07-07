import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

/**
 * Cloudflare Workersは「あるリクエストのI/O(コネクション等)を別リクエストの
 * ハンドラで使い回す」ことを許さない（"Cannot perform I/O on behalf of a
 * different request"）。そのため接続はリクエスト（= 実行コンテキスト）ごとに
 * 作り直す必要がある。`ctx`をキーにしたWeakMapでリクエスト内では使い回しつつ、
 * リクエストを跨いでは共有しない。
 */
const clientsByRequest = new WeakMap<object, PrismaClient>();
let devClient: PrismaClient | undefined;

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaNeon({ connectionString: url });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

function getScopedClient(): PrismaClient {
  try {
    const { ctx } = getCloudflareContext();
    if (ctx) {
      let client = clientsByRequest.get(ctx as object);
      if (!client) {
        client = createClient();
        clientsByRequest.set(ctx as object, client);
      }
      return client;
    }
  } catch {
    // Cloudflareのリクエストコンテキスト外（ローカルnext dev等）
  }
  if (!devClient) devClient = createClient();
  return devClient;
}

/**
 * 呼び出し側からは通常のPrismaClientと同じに見えるが、実体は
 * リクエストごとに作り直される（上記の理由）。
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getScopedClient();
    return Reflect.get(client as object, prop, client);
  },
});
