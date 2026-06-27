// Streams ONE live fixture to the browser as sanitized game events.
//
// ⚠️ TxLINE's push stream /api/scores/stream is heartbeat-only on the free tier
// (scores aren't sampled), so we POLL /api/scores/snapshot/{fid} every few
// seconds and diff it instead. The snapshot returns the latest record of each
// action type (possession tiers, score, clock); we compute the current state and
// emit the SAME {momentum|goal|red|score} events the client already consumes.
// Uses a server-held apiToken (env) — no keypair.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 4000;

const POSS: Record<string, "safe" | "attack" | "danger" | "high_danger"> = {
  safe_possession: "safe",
  attack_possession: "attack",
  danger_possession: "danger",
  high_danger_possession: "high_danger",
};
const g = (s: any, p: string) => s?.[p]?.Total?.Goals ?? 0;
const r_ = (s: any, p: string) => s?.[p]?.Total?.RedCards ?? 0;

export async function GET(request: Request, ctx: { params: Promise<{ fid: string }> }) {
  const { fid: fidStr } = await ctx.params;
  const fid = Number(fidStr);
  const base = process.env.TXLINE_API_BASE;
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (o: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
        } catch {}
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

      // prev state: started=false so we don't fire goal/red for events that
      // happened before the viewer connected (first poll only seeds the baseline).
      const prev = { p1g: 0, p2g: 0, p1r: 0, p2r: 0, possTs: 0, started: false };

      async function poll() {
        const res = await fetch(`${base}/api/scores/snapshot/${fid}`, {
          headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken as string },
          cache: "no-store",
          signal: upstream.signal,
        });
        if (!res.ok) { send({ t: "error", msg: `upstream ${res.status}` }); return; }
        const j: any = await res.json();
        const arr: any[] = Array.isArray(j) ? j : [j];

        // Reduce the per-action-type snapshot to "current" clock / possession / score
        // by taking the most recent record (max Ts) in each category.
        let clock: any, clockTs = -1;
        let possRec: any, possTs = -1;
        let scoreRec: any, scoreTs = -1;
        for (const rr of arr) {
          if (rr.Clock && rr.Ts > clockTs) { clock = rr.Clock; clockTs = rr.Ts; }
          if (POSS[rr.Action as string] && rr.Ts > possTs) { possRec = rr; possTs = rr.Ts; }
          if (rr.Score && rr.Ts > scoreTs) { scoreRec = rr; scoreTs = rr.Ts; }
        }

        if (scoreRec) {
          const p1g = g(scoreRec.Score, "Participant1"), p2g = g(scoreRec.Score, "Participant2");
          const p1r = r_(scoreRec.Score, "Participant1"), p2r = r_(scoreRec.Score, "Participant2");
          if (prev.started) {
            if (p1g > prev.p1g || p2g > prev.p2g) send({ t: "goal", clock, score: { p1: p1g, p2: p2g } });
            if (p1r > prev.p1r || p2r > prev.p2r) send({ t: "red", clock });
          }
          Object.assign(prev, { p1g, p2g, p1r, p2r });
          send({ t: "score", score: { p1: p1g, p2: p2g }, clock });
        }

        // New possession event (Ts advanced) → momentum. high_danger drives prompts.
        if (possRec && possTs !== prev.possTs) {
          prev.possTs = possTs;
          const participant = possRec.Participant === 2 || possRec.Participant === possRec.Participant2Id ? 2 : 1;
          send({ t: "momentum", tier: POSS[possRec.Action as string], participant, clock });
        }
        prev.started = true;
      }

      try {
        while (!closed) {
          await poll();
          if (closed) break;
          await new Promise((r) => setTimeout(r, POLL_MS));
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
