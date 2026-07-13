/**
 * 争点 viewer API のクライアント側共有フェッチ。
 * IssueViewerProvider と AdSlotGated が同じ slug で二重リクエストしないようにする。
 */
import type { Plan } from "@prisma/client";
import type { VoteChoiceId } from "@/lib/constants";

export interface ViewerResponseGuest {
  isLoggedIn: false;
}

export interface ViewerResponseAuthed {
  isLoggedIn: true;
  plan: Plan;
  userVote: VoteChoiceId | null;
  bookmarked: boolean;
}

export type ViewerResponse = ViewerResponseGuest | ViewerResponseAuthed;

const inflight = new Map<string, Promise<ViewerResponse>>();

/** セッションcookieの有無だけ見る（中身は読まない）。未ログインなら投票を即描画できる */
export function hasLikelySessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  const c = document.cookie;
  return (
    c.includes("authjs.session-token") ||
    c.includes("__Secure-authjs.session-token") ||
    c.includes("next-auth.session-token") ||
    c.includes("__Secure-next-auth.session-token")
  );
}

export function fetchIssueViewer(slug: string): Promise<ViewerResponse> {
  const existing = inflight.get(slug);
  if (existing) return existing;

  const promise = fetch(`/api/issues/${encodeURIComponent(slug)}/viewer`)
    .then(async (res) => {
      if (!res.ok) return { isLoggedIn: false as const };
      return (await res.json()) as ViewerResponse;
    })
    .catch(() => ({ isLoggedIn: false as const }))
    .finally(() => {
      // 短いTTLで同一ページ内の二重取得だけ共有（遷移後は再取得）
      window.setTimeout(() => inflight.delete(slug), 8_000);
    });

  inflight.set(slug, promise);
  return promise;
}
