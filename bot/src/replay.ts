import { bot } from "./instance.ts";
import { env } from "./env.ts";
import { DECISION_WINDOW_MS } from "./config.ts";
import { postCall, settleOne } from "./calls.ts";
import { sessionActive, startSession, endSession } from "./sessions.ts";
import { pickMarket, pickWindow, sideOf, type Trigger, type MarketKind } from "../../lib/markets.ts";
import type { TgCall } from "./db.ts";

// Archived group play: replay a recorded match in a group, firing the same calls the
// live watcher would, settling from the recorded outcome. Reuses the web app's replay
// data (fetched over HTTP) so it's the same matches, same events, same on-chain proof
// (mode 'archived'). A compact session: paced fast between calls, capped at MAX_CALLS.
const TRIGGER: Record<string, Trigger> = {
  high_danger_possession: "high_danger", penalty: "high_danger", danger_possession: "danger",
  attack_possession: "attack", shot: "shot", free_kick: "free_kick",
};
const tot = (s: any, p: string, k: string) => s?.[p]?.Total?.[k] ?? 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_CALLS = 10;   // enough for one session; a full match has too many chances
const COOLDOWN = 45;    // match-seconds between calls

type Entry = { fid: number; p1: string; p2: string };

async function fetchJson(path: string): Promise<any | null> {
  try {
    const r = await fetch(`${env.MINIAPP_URL}${path}`, { cache: "no-store" } as RequestInit);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Kick off a session (returns immediately; the replay runs in the background).
export async function startArchivedSession(chatId: number): Promise<string> {
  if (sessionActive(chatId)) return "A match is already running here. Let it finish first.";
  const idx: Entry[] = (await fetchJson("/replays/index.json")) ?? [];
  if (!idx.length) return "No archived matches available right now.";
  const entry = idx[Math.floor(Math.random() * idx.length)];
  const recs: any[] | null = await fetchJson(`/replays/${entry.fid}.json`);
  if (!recs || !recs.length) return "Couldn't load that match, try again.";
  startSession(chatId);
  runSession(chatId, entry, recs).catch((e) => console.error("session", e)).finally(() => endSession(chatId));
  return `▶ Replaying ${entry.p1} v ${entry.p2}. Calls incoming, tap fast.`;
}

async function runSession(chatId: number, entry: Entry, recs: any[]): Promise<void> {
  const match = `${entry.p1}-${entry.p2}`;
  const open: TgCall[] = [];
  const prev = { g1: 0, g2: 0, c1: 0, c2: 0, y1: 0, y2: 0, r1: 0, r2: 0 };
  let matchSec = 0, lastTs = 0, cooldownSec = 0, calls = 0;

  const settleMatching = async (kind: MarketKind, side: 1 | 2) => {
    for (const c of [...open]) {
      if (c.market === kind && c.side === side) { await settleOne(c, "yes", lastTs); open.splice(open.indexOf(c), 1); }
    }
  };

  for (const r of recs) {
    if (!sessionActive(chatId)) break;
    if (typeof r.Ts === "number") lastTs = r.Ts;
    if (r.Clock && typeof r.Clock.Seconds === "number") matchSec = r.Clock.Seconds;

    // stat deltas → settle YES for matching calls
    if (r.Score) {
      const cur = {
        g1: Math.max(prev.g1, tot(r.Score, "Participant1", "Goals")), g2: Math.max(prev.g2, tot(r.Score, "Participant2", "Goals")),
        c1: Math.max(prev.c1, tot(r.Score, "Participant1", "Corners")), c2: Math.max(prev.c2, tot(r.Score, "Participant2", "Corners")),
        y1: Math.max(prev.y1, tot(r.Score, "Participant1", "YellowCards")), y2: Math.max(prev.y2, tot(r.Score, "Participant2", "YellowCards")),
        r1: Math.max(prev.r1, tot(r.Score, "Participant1", "RedCards")), r2: Math.max(prev.r2, tot(r.Score, "Participant2", "RedCards")),
      };
      if (cur.g1 > prev.g1) await settleMatching("goal", 1);
      if (cur.g2 > prev.g2) await settleMatching("goal", 2);
      if (cur.c1 > prev.c1) await settleMatching("corner", 1);
      if (cur.c2 > prev.c2) await settleMatching("corner", 2);
      if (cur.y1 > prev.y1) await settleMatching("yellow", 1);
      if (cur.y2 > prev.y2) await settleMatching("yellow", 2);
      if (cur.r1 > prev.r1) await settleMatching("red", 1);
      if (cur.r2 > prev.r2) await settleMatching("red", 2);
      Object.assign(prev, cur);
    }

    // settle NO for windows that elapsed in match time
    for (const c of [...open]) {
      if (matchSec > c.deadline_sec) { await settleOne(c, "no", lastTs); open.splice(open.indexOf(c), 1); }
    }

    // a chance action opens a call (rate-limited by a match-second cooldown)
    const trig = TRIGGER[r.Action as string];
    if (trig && calls < MAX_CALLS && matchSec >= cooldownSec) {
      const side = sideOf(r.Participant);
      const m = pickMarket(trig, side);
      const mins = pickWindow(m.kind);
      const team = side === 2 ? entry.p2 : entry.p1;
      const call = await postCall({ chatId, fid: entry.fid, match, market: m.kind, side, team, mins, matchSec, baseTs: lastTs, mode: "archived" });
      if (call) { open.push(call); calls++; cooldownSec = matchSec + COOLDOWN; }
      await sleep(DECISION_WINDOW_MS); // let the group tap
    } else {
      await sleep(30); // brisk march through the match between calls
    }
    if (calls >= MAX_CALLS && open.length === 0) break;
  }

  for (const c of open) await settleOne(c, "no", lastTs); // settle any leftovers
  try { await bot.api.sendMessage(chatId, `Full time: ${entry.p1} v ${entry.p2}. /play again, or /top for the board.`); } catch {}
}
