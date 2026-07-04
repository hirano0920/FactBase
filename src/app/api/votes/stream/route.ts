import type { NextRequest } from "next/server";
import { getTallyFast } from "@/lib/votes";
import { checkRateLimit, getClientIp } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { BURST } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const POLL_INTERVAL_MS = BURST.ssePollMs;
const STREAM_LIFETIME_MS = 55_000; // maxDuration前に自主クローズ→クライアントが自動再接続

/**
 * SSE: 投票tallyを5秒間隔で配信。値が変わったときだけeventを送る。
 * EventSourceは切断時に自動再接続するため、55秒でサーバー側からクローズする。
 */
export async function GET(req: NextRequest) {
  const issueId = req.nextUrl.searchParams.get("issueId");
  if (!issueId) {
    return new Response("issueId required", { status: 422 });
  }

  // 増幅DoS対策: 接続はIP毎に制限し、存在しない争点への接続は開始前に拒否
  // （存在しないIDだと2秒毎のpollが毎回DBに落ちるため）
  const ip = getClientIp(req);
  const allowed = await checkRateLimit("sse", ip, BURST.ssePerIpPerMin, 60);
  if (!allowed) {
    return new Response("too many connections", { status: 429 });
  }
  const burstOk = await checkRateLimit("api-ip", ip, BURST.apiPerIpPerMin, 60);
  if (!burstOk) {
    return new Response("too many requests", { status: 429 });
  }
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { id: true },
  });
  if (!issue) {
    return new Response("issue not found", { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastPayload = "";
      let closed = false;

      const send = async () => {
        try {
          const tally = await getTallyFast(issueId);
          const payload = JSON.stringify(tally);
          if (payload !== lastPayload) {
            lastPayload = payload;
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          }
        } catch {
          // 一時的なKV/DB障害はスキップ（次のpollで再試行）
        }
      };

      await send();

      const interval = setInterval(send, POLL_INTERVAL_MS);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        clearTimeout(lifetime);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const lifetime = setTimeout(close, STREAM_LIFETIME_MS);
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
