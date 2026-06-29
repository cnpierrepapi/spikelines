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
      const prev = { g1: 0, g2: 0, c1: 0, c2: 0, y1: 0, y2: 0, r1: 0, r2: 0, pe1: 0, pe2: 0, possTs: 0, chanceTs: 0, shotTs: 0, penTs: 0, varTs: 0, subTs: 0, started: false, finished: false };

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
        let anyScore = false;
        const cur = { g1: 0, g2: 0, c1: 0, c2: 0, y1: 0, y2: 0, r1: 0, r2: 0 };
        let chanceRec: any, chanceTs = -1;
        let shotRec: any, shotTs = -1;
        let penTs = -1, varTs = -1, subRec: any, subTs = -1;
        let finishedNow = false;
        // VAR overturn (the one case a score legitimately DECREASES) + the latest
        // cumulative Score (authoritative current totals, incl. the rollback) +
        // penalty-shootout goals (the PE period, which Total excludes).
        let overturn = false;
        let lastScore: any = null, lastScoreTs = -1;
        let pe1 = 0, pe2 = 0;
        for (const rr of arr) {
          if (rr.Action === "game_finalised") finishedNow = true;
          if (rr.Action === "action_discarded") overturn = true;
          if (rr.Action === "var_end" && rr.Data?.Outcome === "Overturned") overturn = true;
          if (rr.Clock && rr.Ts > clockTs) { clock = rr.Clock; clockTs = rr.Ts; }
          if (POSS[rr.Action as string] && rr.Ts > possTs) { possRec = rr; possTs = rr.Ts; }
          // Cumulative stats only increase — take the MAX across ALL records, since
          // any single record's Score.Total can omit stats that haven't moved.
          if (rr.Score) {
            anyScore = true;
            cur.g1 = Math.max(cur.g1, tot(rr.Score, "Participant1", "Goals")); cur.g2 = Math.max(cur.g2, tot(rr.Score, "Participant2", "Goals"));
            cur.c1 = Math.max(cur.c1, tot(rr.Score, "Participant1", "Corners")); cur.c2 = Math.max(cur.c2, tot(rr.Score, "Participant2", "Corners"));
            cur.y1 = Math.max(cur.y1, tot(rr.Score, "Participant1", "YellowCards")); cur.y2 = Math.max(cur.y2, tot(rr.Score, "Participant2", "YellowCards"));
            cur.r1 = Math.max(cur.r1, tot(rr.Score, "Participant1", "RedCards")); cur.r2 = Math.max(cur.r2, tot(rr.Score, "Participant2", "RedCards"));
            if (rr.Score.Participant1?.Total && rr.Ts > lastScoreTs) { lastScore = rr.Score; lastScoreTs = rr.Ts; }
            // Shootout (PE) goals only ever climb — max across records.
            pe1 = Math.max(pe1, rr.Score.Participant1?.PE?.Goals ?? 0);
            pe2 = Math.max(pe2, rr.Score.Participant2?.PE?.Goals ?? 0);
          }
          if (TRIGGER[rr.Action as string] && rr.Ts > chanceTs) { chanceRec = rr; chanceTs = rr.Ts; }
          if (rr.Action === "shot" && rr.Ts > shotTs) { shotRec = rr; shotTs = rr.Ts; }
          if (rr.Action === "penalty" && rr.Ts > penTs) penTs = rr.Ts;
          if (rr.Action === "var" && rr.Ts > varTs) varTs = rr.Ts;
          if (rr.Action === "substitution" && rr.Ts > subTs) { subRec = rr; subTs = rr.Ts; }
        }

        // Scoreboard + per-side stat deltas.
        //
        // ⚠️ `cur` is a running-max WITHIN this poll only — it starts at 0, so a
        // sparse poll whose records omit a stat collapses that stat to 0. We must
        // therefore keep `prev` MONOTONIC ACROSS polls: never let a sparse poll
        // lower the baseline. The old `Object.assign(prev, cur)` clobbered prev
        // with the (possibly-0) poll value, so the next poll that re-reported the
        // real total fired a PHANTOM second goal/corner/card event.
        if (anyScore) {
          // VAR overturn is the ONLY legitimate score decrease. When the feed
          // signals one, trust the latest cumulative Total (which already reflects
          // the rollback), pull our baseline DOWN to it, and announce the
          // disallowed goal. The disallowed `goal` / stale `var_end` records keep
          // their pre-overturn Total forever, so a plain running-max never recovers.
          if (overturn && lastScore) {
            const lg1 = tot(lastScore, "Participant1", "Goals");
            const lg2 = tot(lastScore, "Participant2", "Goals");
            if (prev.started && lg1 < prev.g1) send({ t: "stat", kind: "goal_disallowed", side: 1, clock });
            if (prev.started && lg2 < prev.g2) send({ t: "stat", kind: "goal_disallowed", side: 2, clock });
            prev.g1 = cur.g1 = lg1;
            prev.g2 = cur.g2 = lg2;
          }
          send({ t: "score", score: { p1: Math.max(prev.g1, cur.g1), p2: Math.max(prev.g2, cur.g2) }, clock });
          const bump = (k: keyof typeof cur, kind: string, side: 1 | 2) => {
            if (cur[k] > prev[k]) {
              if (prev.started) send({ t: "stat", kind, side, clock });
              prev[k] = cur[k]; // raise the baseline ONLY on a real increase
            }
          };
          bump("g1", "goal", 1); bump("g2", "goal", 2);
          bump("c1", "corner", 1); bump("c2", "corner", 2);
          bump("y1", "yellow", 1); bump("y2", "yellow", 2);
          bump("r1", "red", 1); bump("r2", "red", 2);
        }

        // Penalty shootout (PE period). Total excludes it, so the main scoreboard
        // stays at the regulation/ET score — surface the shootout as its own line.
        if ((pe1 > 0 || pe2 > 0) && (pe1 !== prev.pe1 || pe2 !== prev.pe2)) {
          send({ t: "shootout", score: { p1: pe1, p2: pe2 }, clock });
          prev.pe1 = pe1; prev.pe2 = pe2;
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
        if (finishedNow && !prev.finished) { send({ t: "finished" }); prev.finished = true; }
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
