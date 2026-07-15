import { createMatchFeedState, pollMatchOnce, MATCH_POLL_MS, type MatchEvent } from "../../lib/match-feed.ts";
import { getLiveMatches, txlineBase, txlineToken, txlineJwt, type LiveMatch } from "./txline.ts";
import { openCall, settleFixtureStat, sweepElapsed, settleAllNo } from "./calls.ts";
import { DISCOVERY_MS } from "./config.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One watcher per live fixture. Runs the SAME shared feed the web app's SSE route
// uses (pollMatchOnce), but points `emit` at the group-call pipeline instead of a
// browser stream. Discovery below starts/stops these as matches go live/finish.
const active = new Map<number, boolean>();

async function runFixture(m: LiveMatch): Promise<void> {
  active.set(m.fid, true);
  const prev = createMatchFeedState();
  let matchSec = 0, lastTs = 0, running = true;

  const emit = (e: MatchEvent) => {
    const anyE = e as any;
    if (anyE.clock) {
      if (typeof anyE.clock.Seconds === "number") matchSec = anyE.clock.Seconds;
      if (typeof anyE.clock.Running === "boolean") running = anyE.clock.Running;
    }
    if (typeof anyE.ts === "number" && anyE.ts > 0) lastTs = anyE.ts;

    if (e.t === "chance") {
      openCall(m, e.trigger, e.side, matchSec, lastTs, running).catch((err) => console.error("openCall", err));
    } else if (e.t === "momentum" && (e.tier === "danger" || e.tier === "high_danger")) {
      openCall(m, e.tier, e.participant, matchSec, lastTs, running).catch(() => {});
    } else if (e.t === "stat") {
      if (e.kind === "goal" || e.kind === "corner" || e.kind === "yellow" || e.kind === "red") {
        settleFixtureStat(m.fid, e.kind, e.side, matchSec, lastTs).catch((err) => console.error("settleStat", err));
      }
    } else if (e.t === "finished") {
      settleAllNo(m.fid, lastTs).catch(() => {});
    }
  };

  console.log(`watch ${m.fid} ${m.p1}-${m.p2}`);
  while (active.get(m.fid)) {
    try {
      const base = txlineBase(), token = txlineToken(), jwt = await txlineJwt();
      if (base && token && jwt) {
        await pollMatchOnce({ base, jwt, apiToken: token, fid: m.fid, prev, emit });
        await sweepElapsed(m.fid, matchSec, lastTs); // settle NO on windows that elapsed
      }
    } catch (e) {
      console.error("poll", m.fid, e);
    }
    if (prev.finished) break;
    await sleep(MATCH_POLL_MS);
  }
  active.delete(m.fid);
  console.log(`unwatch ${m.fid}`);
}

// Discovery loop: pick up newly-live matches, let finished ones fall out on their
// own (the feed emits `finished` → the watcher breaks). Runs forever.
export async function startWatching(): Promise<void> {
  for (;;) {
    try {
      const live = await getLiveMatches();
      for (const m of live) if (!active.has(m.fid)) runFixture(m).catch((e) => console.error("runFixture", e));
    } catch (e) {
      console.error("discovery", e);
    }
    await sleep(DISCOVERY_MS);
  }
}
