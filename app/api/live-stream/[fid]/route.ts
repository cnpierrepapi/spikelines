// Streams ONE live fixture to the browser as sanitized game events.
//
// The poll+diff that DERIVES the events now lives in lib/match-feed.ts, shared
// with the Telegram bot's match watcher so the two can't drift. This route is just
// the browser transport: it wraps that producer in an SSE ReadableStream, polling
// on a fixed cadence and forwarding each event as `data: {...}`.
// Uses a server-held apiToken (env) — no keypair.
import { createMatchFeedState, pollMatchOnce, MATCH_POLL_MS, type MatchEvent } from "@/lib/match-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request, ctx: { params: Promise<{ fid: string }> }) {
  const { fid: fidStr } = await ctx.params;
  const fid = Number(fidStr);
  const base = process.env.TXLINE_API_BASE;
  const jwt = await (await import("@/lib/txline-auth")).mintJwt(base);
  const apiToken = process.env.TXLINE_API_TOKEN;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (o: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`)); } catch {}
      };
      if (!base || !jwt || !apiToken) {
        send({ t: "error", msg: "live not configured" });
        try { controller.close(); } catch {}
        return;
      }
      send({ t: "ready" });

      const upstream = new AbortController();
      const stop = () => { closed = true; upstream.abort(); };
      request.signal.addEventListener("abort", stop);

      const prev = createMatchFeedState();
      const emit = (e: MatchEvent) => send(e);

      try {
        while (!closed) {
          await pollMatchOnce({ base, jwt, apiToken, fid, prev, emit, signal: upstream.signal });
          if (closed) break;
          await new Promise((r) => setTimeout(r, MATCH_POLL_MS));
        }
      } catch (e) {
        if (!closed) send({ t: "error", msg: String(e) });
      }
      try { controller.close(); } catch {}
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
