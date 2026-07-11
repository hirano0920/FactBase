/**
 * KVストア抽象化。
 * UPSTASH_REDIS_REST_URL/TOKEN があれば Upstash、なければ in-memory フォールバック。
 * フォールバックは開発・テスト専用（サーバーレス本番ではインスタンス間で共有されない）。
 */
import { Redis } from "@upstash/redis";

export interface KvStore {
  hincrby(key: string, field: string, by: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, number>>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
  /** キーが無いときだけ set（IP登録ロック等） */
  setnx(key: string, value: string, opts?: { ex?: number }): Promise<boolean>;
}

class UpstashKv implements KvStore {
  constructor(private redis: Redis) {}

  async hincrby(key: string, field: string, by: number) {
    return this.redis.hincrby(key, field, by);
  }

  async hgetall(key: string) {
    const raw = await this.redis.hgetall<Record<string, string>>(key);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw ?? {})) out[k] = Number(v) || 0;
    return out;
  }

  async incr(key: string) {
    return this.redis.incr(key);
  }

  async decr(key: string) {
    return this.redis.decr(key);
  }

  async expire(key: string, seconds: number) {
    await this.redis.expire(key, seconds);
  }

  async get(key: string) {
    const raw = await this.redis.get<unknown>(key);
    if (raw == null) return null;
    // Upstash は JSON 値をオブジェクトで返すことがある。JSON.parse 二重適用で落ちるのを防ぐ
    if (typeof raw === "string") return raw;
    return JSON.stringify(raw);
  }

  async set(key: string, value: string, opts?: { ex?: number }) {
    if (opts?.ex) await this.redis.set(key, value, { ex: opts.ex });
    else await this.redis.set(key, value);
  }

  async del(key: string) {
    await this.redis.del(key);
  }

  async setnx(key: string, value: string, opts?: { ex?: number }) {
    const result = opts?.ex
      ? await this.redis.set(key, value, { nx: true, ex: opts.ex })
      : await this.redis.set(key, value, { nx: true });
    return result === "OK";
  }
}

interface MemoryEntry {
  value: string | Map<string, number> | number;
  expiresAt: number | null;
}

class MemoryKv implements KvStore {
  private store = new Map<string, MemoryEntry>();

  private live(key: string): MemoryEntry | undefined {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async hincrby(key: string, field: string, by: number) {
    let entry = this.live(key);
    if (!entry || !(entry.value instanceof Map)) {
      entry = { value: new Map<string, number>(), expiresAt: null };
      this.store.set(key, entry);
    }
    const map = entry.value as Map<string, number>;
    const next = (map.get(field) ?? 0) + by;
    map.set(field, next);
    return next;
  }

  async hgetall(key: string) {
    const entry = this.live(key);
    if (!entry || !(entry.value instanceof Map)) return {};
    return Object.fromEntries(entry.value as Map<string, number>);
  }

  async incr(key: string) {
    const entry = this.live(key);
    const current = entry && typeof entry.value === "number" ? entry.value : 0;
    const next = current + 1;
    this.store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  async decr(key: string) {
    const entry = this.live(key);
    const current = entry && typeof entry.value === "number" ? entry.value : 0;
    const next = Math.max(0, current - 1);
    this.store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, seconds: number) {
    const entry = this.live(key);
    if (entry) entry.expiresAt = Date.now() + seconds * 1000;
  }

  async get(key: string) {
    const entry = this.live(key);
    return entry && typeof entry.value === "string" ? entry.value : null;
  }

  async set(key: string, value: string, opts?: { ex?: number }) {
    this.store.set(key, {
      value,
      expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : null,
    });
  }

  async del(key: string) {
    this.store.delete(key);
  }

  async setnx(key: string, value: string, opts?: { ex?: number }) {
    if (this.live(key)) return false;
    await this.set(key, value, opts);
    return true;
  }
}

const globalForKv = globalThis as unknown as { kv?: KvStore };

function createKv(): KvStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return new UpstashKv(new Redis({ url, token }));
  if (process.env.NODE_ENV === "production") {
    console.warn("[kv] UPSTASH env missing in production — using in-memory fallback");
  }
  return new MemoryKv();
}

export const kv: KvStore = globalForKv.kv ?? createKv();
if (process.env.NODE_ENV !== "production") globalForKv.kv = kv;

// 投票tallyのキー設計
export const voteKey = (issueId: string) => `vote:${issueId}`;
/** SSE用: 直近tallyのJSONキャッシュ（hgetallより1 GETで済ませる） */
export const voteJsonKey = (issueId: string) => `vote:json:${issueId}`;
export const voteSeedLockKey = (issueId: string) => `vote:seed:${issueId}`;
export const issueSlugKey = (slug: string) => `issue:slug:${slug}`;
export const rankingCacheKey = () => "cache:ranking:hot";
export const rankingWeeklyCacheKey = () => "cache:ranking:weekly";
/** /ranking ページ専用: 「Hotなスレ」(コメント数基準) / 「Hotな投票」(投票数基準) */
export const rankingBySortCacheKey = (sortBy: "comments" | "votes") => `cache:ranking:by:${sortBy}`;
export const issuesListCacheKey = () => "cache:issues:list";
export const commentsVerKey = (issueId: string) => `cache:comments:ver:${issueId}`;
export const commentsCacheKey = (
  issueId: string,
  ver: number,
  cursor: string,
  limit: number,
  sort: string = "new",
) => `cache:comments:${issueId}:${ver}:${sort}:${cursor}:${limit}`;
export const debateHighlightsCacheKey = (issueId: string, ver: number) =>
  `cache:comments:highlights:${issueId}:${ver}`;
export const splitCommentsCacheKey = (
  issueId: string,
  ver: number,
  side: "for" | "against",
  cursor: string,
  limit: number,
) => `cache:comments:split:${issueId}:${ver}:${side}:${cursor}:${limit}`;
export const timelineVerKey = (issueId: string) => `cache:timeline:ver:${issueId}`;
export const timelineCacheKey = (issueId: string, ver: number) => `cache:timeline:${issueId}:${ver}`;
export const globalTimelineVerKey = () => "cache:timeline:global:ver";
export const globalTimelineCacheKey = (ver: number) => `cache:timeline:global:${ver}`;
export const fcEmbedKey = (bodyHash: string) => `fc:embed:${bodyHash}`;
export const FC_INFLIGHT_KEY = "fc:inflight";

/** バージョンカウンタ（incr）。キャッシュキーに含めて書き込み時に一括無効化する */
export async function getCacheVersion(verKey: string): Promise<number> {
  try {
    const raw = await kv.get(verKey);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}
/** KV から JSON を安全に復元 */
export function parseKvJson<T>(raw: string | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const rateKey = (scope: string, id: string, windowSec: number) =>
  `rate:${scope}:${id}:${Math.floor(Date.now() / 1000 / windowSec)}`;
