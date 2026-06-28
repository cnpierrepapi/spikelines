// Streams ONE live fixture to the browser as sanitized game events.
//
// ⚠️ TxLINE's push stream /api/scores/stream is heartbeat-only on the free tier
// (scores aren't sampled), so we POLL /api/scores/snapshot/{fid} every few
// seconds and diff it instead. The snapshot returns the latest record of each
// action type, each carrying the FULL cumulative Score.Total per team, so we can
// derive multiple bettable markets (goal/corner/booking) + shots, all per side.
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
// Actions that open a betting prompt, mapped to the trigger the client uses to
// pick a market. high_danger → goal-heavy, attack → corner/shot, etc.
const TRIGGER: Record<string, "high_danger" | "danger" | "attack" | "shot" | "free_kick"> = {
  high_danger_possession: "high_danger",
  penalty: "high_danger",
  danger_possession: "danger",
  attack_possession: "attack",
  shot: "shot",
  free_kick: "free_kick",
};
const tot = (s: any, p: string, k: string) => s?.[p]?.Total?.[k] ?? 0;
const sideOf = (p: unknown): 1 | 2 => (p === 2 ? 2 : 1);

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

      // started=false so the first poll only seeds the baseline (no settle/prompt
      // events for things that happened before the viewer connected).
      const prev = { g1: 0, g2: 0, c1: 0, c2: 0, y1: 0, y2: 0, r1: 0, r2: 0, possTs: 0, chanceTs: 0, shotTs: 0, penTs: 0, varTs: 0, subTs: 0, started: false };

      async function poll() {
        const res = await fetch(`${base}/api/scores/snapshot/${fid}`, {
          headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken as string },
          cache: "no-store",
          signal: upstream.signal,
        });
        if (!res.ok) { send({ t: "error", msg: `upstream ${res.status}` }); return; }
        const j: any = await res.json();
        const arr: any[] = Array.isArray(j) ? j : [j];

        let clock: any, clockTs = -1;
        let possRec: any, possTs = -1;
        let scoreRec: any, scoreTs = -1;
        let chanceRec: any, chanceTs = -1;
        let shotRec: any, shotTs = -1;
        let penTs = -1, varTs = -1, subRec: any, subTs = -1;
        for (const rr of arr) {
          if (rr.Clock && rr.Ts > clockTs) { clock = rr.Clock; clockTs = rr.Ts; }
          if (POSS[rr.Action as string] && rr.Ts > possTs) { possRec = rr; possTs = rr.Ts; }
          if (rr.Score && rr.Ts > scoreTs) { scoreRec = rr; scoreTs = rr.Ts; }
          if (TRIGGER[rr.Action as string] && rr.Ts > chanceTs) { chanceRec = rr; chanceTs = rr.Ts; }
          if (rr.Action === "shot" && rr.Ts > shotTs) { shotRec = rr; shotTs = rr.Ts; }
          if (rr.Action === "penalty" && rr.Ts > penTs) penTs = rr.Ts;
          if (rr.Action === "var" && rr.Ts > varTs) varTs = rr.Ts;
          if (rr.Action === "substitution" && rr.Ts > subTs) { subRec = rr; subTs = rr.Ts; }
        }

        // Scoreboard + per-side stat deltas (each Score record carries full totals).
        if (scoreRec) {
          const S = scoreRec.Score;
          const cur = {
            g1: tot(S, "Participant1", "Goals"), g2: tot(S, "Participant2", "Goals"),
            c1: tot(S, "Participant1", "Corners"), c2: tot(S, "Participant2", "Corners"),
            y1: tot(S, "Participant1", "YellowCards"), y2: tot(S, "Participant2", "YellowCards"),
            r1: tot(S, "Participant1", "RedCards"), r2: tot(S, "Participant2", "RedCards"),
          };
          send({ t: "score", score: { p1: cur.g1, p2: cur.g2 }, clock });
          if (prev.started) {
            if (cur.g1 > prev.g1) send({ t: "stat", kind: "goal", side: 1, clock });
            if (cur.g2 > prev.g2) send({ t: "stat", kind: "goal", side: 2, clock });
            if (cur.c1 > prev.c1) send({ t: "stat", kind: "corner", side: 1, clock });
            if (cur.c2 > prev.c2) send({ t: "stat", kind: "corner", side: 2, clock });
            if (cur.y1 > prev.y1) send({ t: "stat", kind: "yellow", side: 1, clock });
            if (cur.y2 > prev.y2) send({ t: "stat", kind: "yellow", side: 2, clock });
            if (cur.r1 > prev.r1) send({ t: "stat", kind: "red", side: 1, clock });
            if (cur.r2 > prev.r2) send({ t: "stat", kind: "red", side: 2, clock });
          }
          Object.assign(prev, cur);
        }

        // Meter follows possession.
        if (possRec && possTs !== prev.possTs) {
          prev.possTs = possTs;
          send({ t: "momentum", tier: POSS[possRec.Action as string], participant: sideOf(possRec.Participant), clock });
        }

        // Shot event = settlement signal for the shot market (no Score.Total).
        if (shotRec && shotTs !== prev.shotTs) {
          if (prev.started) send({ t: "event", kind: "shot", side: sideOf(shotRec.Participant), clock });
          prev.shotTs = shotTs;
        }

        // Scoring chance → prompt opportunity, tagged with trigger + attacking side.
        if (chanceRec && chanceTs !== prev.chanceTs) {
          if (prev.started) send({ t: "chance", trigger: TRIGGER[chanceRec.Action as string], side: sideOf(chanceRec.Participant), clock });
          prev.chanceTs = chanceTs;
        }

        // Highlights ticker — penalty / VAR / substitution.
        if (penTs > prev.penTs) { if (prev.started) send({ t: "feed", kind: "penalty", clock }); prev.penTs = penTs; }
        if (varTs > prev.varTs) { if (prev.started) send({ t: "feed", kind: "var", clock }); prev.varTs = varTs; }
        if (subTs > prev.subTs) { if (prev.started) send({ t: "feed", kind: "sub", side: subRec?.Data?.Participant === 2 ? 2 : 1, clock }); prev.subTs = subTs; }
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
