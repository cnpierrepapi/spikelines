// Shared TxLINE match-feed producer: ONE poll of a fixture's scores snapshot,
// diffed against a caller-held state, emitting sanitized game events. Used by BOTH
// the browser SSE route (app/api/live-stream/[fid]) and the Telegram bot's match
// watcher, so the two can never drift on HOW events are derived from the feed.
//
// ⚠️ TxLINE's push stream is heartbeat-only on the free tier (scores aren't
// sampled), so callers POLL this every few seconds and diff the snapshot. The
// snapshot returns the latest record of each action type, each carrying the FULL
// cumulative Score.Total per team, so we can derive multiple bettable markets
// (goal/corner/booking) + shots, all per side.

export const MATCH_POLL_MS = 4000;

type Tier = "safe" | "attack" | "danger" | "high_danger";
type Trigger = "high_danger" | "danger" | "attack" | "shot" | "free_kick";

const POSS: Record<string, Tier> = {
  safe_possession: "safe",
  attack_possession: "attack",
  danger_possession: "danger",
  high_danger_possession: "high_danger",
};
// Actions that open a betting prompt, mapped to the trigger the client uses to
// pick a market. high_danger → goal-heavy, attack → corner/shot, etc.
const TRIGGER: Record<string, Trigger> = {
  high_danger_possession: "high_danger",
  penalty: "high_danger",
  danger_possession: "danger",
  attack_possession: "attack",
  shot: "shot",
  free_kick: "free_kick",
};
const tot = (s: any, p: string, k: string) => s?.[p]?.Total?.[k] ?? 0;
const sideOf = (p: unknown): 1 | 2 => (p === 2 ? 2 : 1);

// Every event shape the two consumers already parse. Kept identical to the old
// inline SSE payloads so the live + archived client pages are unaffected.
export type MatchEvent =
  | { t: "score"; score: { p1: number; p2: number }; clock: any; ts: number }
  | { t: "stat"; kind: string; side: 1 | 2; clock: any; ts?: number }
  | { t: "shootout"; score: { p1: number; p2: number }; clock: any }
  | { t: "momentum"; tier: Tier; participant: 1 | 2; clock: any; ts: number }
  | { t: "event"; kind: "shot"; side: 1 | 2; clock: any }
  | { t: "chance"; trigger: Trigger; side: 1 | 2; clock: any; ts: number }
  | { t: "feed"; kind: "penalty" | "var" | "sub"; side?: 1 | 2; clock: any }
  | { t: "finished"; ts: number }
  | { t: "error"; msg: string };

export type MatchFeedState = {
  g1: number; g2: number; c1: number; c2: number; y1: number; y2: number; r1: number; r2: number;
  pe1: number; pe2: number;
  possTs: number; chanceTs: number; shotTs: number; penTs: number; varTs: number; subTs: number;
  started: boolean; finished: boolean;
};

// Fresh state for a fixture. started=false so the first poll only SEEDS the
// baseline (no settle/prompt events for things that happened before we connected).
export function createMatchFeedState(): MatchFeedState {
  return { g1: 0, g2: 0, c1: 0, c2: 0, y1: 0, y2: 0, r1: 0, r2: 0, pe1: 0, pe2: 0, possTs: 0, chanceTs: 0, shotTs: 0, penTs: 0, varTs: 0, subTs: 0, started: false, finished: false };
}

// One poll of the snapshot, diffed against `prev` (mutated in place). Emits each
// derived event via `emit`. Throws on network error so the caller can decide how
// to surface it (the SSE route sends {t:"error"}; the bot logs + retries).
export async function pollMatchOnce(opts: {
  base: string; jwt: string; apiToken: string; fid: number;
  prev: MatchFeedState; emit: (e: MatchEvent) => void; signal?: AbortSignal;
}): Promise<void> {
  const { base, jwt, apiToken, fid, prev, emit, signal } = opts;

  const res = await fetch(`${base}/api/scores/snapshot/${fid}`, {
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
    cache: "no-store",
    signal,
    // `cache` is valid on Next/undici fetch but absent from @types/node's RequestInit;
    // the assertion keeps this file compiling under both the app (dom) and the bot (node).
  } as RequestInit);
  if (!res.ok) { emit({ t: "error", msg: `upstream ${res.status}` }); return; }
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
  let maxTs = 0; // newest feed record timestamp this poll — the proof window key
  for (const rr of arr) {
    if (typeof rr.Ts === "number" && rr.Ts > maxTs) maxTs = rr.Ts;
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
  // ⚠️ `cur` is a running-max WITHIN this poll only — it starts at 0, so a sparse
  // poll whose records omit a stat collapses that stat to 0. We must therefore
  // keep `prev` MONOTONIC ACROSS polls: never let a sparse poll lower the baseline.
  if (anyScore) {
    // VAR overturn is the ONLY legitimate score decrease. When the feed signals
    // one, trust the latest cumulative Total (which already reflects the rollback),
    // pull our baseline DOWN to it, and announce the disallowed goal.
    if (overturn && lastScore) {
      const lg1 = tot(lastScore, "Participant1", "Goals");
      const lg2 = tot(lastScore, "Participant2", "Goals");
      if (prev.started && lg1 < prev.g1) emit({ t: "stat", kind: "goal_disallowed", side: 1, clock });
      if (prev.started && lg2 < prev.g2) emit({ t: "stat", kind: "goal_disallowed", side: 2, clock });
      prev.g1 = cur.g1 = lg1;
      prev.g2 = cur.g2 = lg2;
    }
    emit({ t: "score", score: { p1: Math.max(prev.g1, cur.g1), p2: Math.max(prev.g2, cur.g2) }, clock, ts: maxTs });
    const bump = (k: keyof typeof cur, kind: string, side: 1 | 2) => {
      if (cur[k] > prev[k]) {
        if (prev.started) emit({ t: "stat", kind, side, clock, ts: maxTs });
        prev[k] = cur[k]; // raise the baseline ONLY on a real increase
      }
    };
    bump("g1", "goal", 1); bump("g2", "goal", 2);
    bump("c1", "corner", 1); bump("c2", "corner", 2);
    bump("y1", "yellow", 1); bump("y2", "yellow", 2);
    bump("r1", "red", 1); bump("r2", "red", 2);
  }

  // Penalty shootout (PE period). Total excludes it, so the main scoreboard stays
  // at the regulation/ET score — surface the shootout as its own line.
  if ((pe1 > 0 || pe2 > 0) && (pe1 !== prev.pe1 || pe2 !== prev.pe2)) {
    emit({ t: "shootout", score: { p1: pe1, p2: pe2 }, clock });
    prev.pe1 = pe1; prev.pe2 = pe2;
  }

  // Meter follows possession.
  if (possRec && possTs !== prev.possTs) {
    prev.possTs = possTs;
    emit({ t: "momentum", tier: POSS[possRec.Action as string], participant: sideOf(possRec.Participant), clock, ts: maxTs });
  }

  // Shot event = settlement signal for the shot market (no Score.Total).
  if (shotRec && shotTs !== prev.shotTs) {
    if (prev.started) emit({ t: "event", kind: "shot", side: sideOf(shotRec.Participant), clock });
    prev.shotTs = shotTs;
  }

  // Scoring chance → prompt opportunity, tagged with trigger + attacking side.
  if (chanceRec && chanceTs !== prev.chanceTs) {
    if (prev.started) emit({ t: "chance", trigger: TRIGGER[chanceRec.Action as string], side: sideOf(chanceRec.Participant), clock, ts: maxTs });
    prev.chanceTs = chanceTs;
  }

  // Highlights ticker — penalty / VAR / substitution.
  if (penTs > prev.penTs) { if (prev.started) emit({ t: "feed", kind: "penalty", clock }); prev.penTs = penTs; }
  if (varTs > prev.varTs) { if (prev.started) emit({ t: "feed", kind: "var", clock }); prev.varTs = varTs; }
  if (subTs > prev.subTs) { if (prev.started) emit({ t: "feed", kind: "sub", side: subRec?.Data?.Participant === 2 ? 2 : 1, clock }); prev.subTs = subTs; }
  if (finishedNow && !prev.finished) { emit({ t: "finished", ts: maxTs }); prev.finished = true; }
  prev.started = true;
}
