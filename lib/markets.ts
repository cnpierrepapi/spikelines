// Shared micro-bet market logic for both the live (/live/[fid]) and archived
// (/match/[fid]) match rooms. Keeping this in one place stops the two pages
// from drifting apart again.
//
// A "market" is the question a prompt asks. Side-specific markets (goal/corner/
// shot) are framed to the team currently attacking and settle on THAT team's
// stat; booking is team-agnostic (side 0) and settles on either team.
export type MarketKind = "goal" | "corner" | "shot" | "booking";
export type Side = 0 | 1 | 2; // 0 = any team
export type Trigger = "high_danger" | "danger" | "attack" | "shot" | "free_kick";
export type MarketSignal = { kind: MarketKind; side: 1 | 2 };

export type Market = { kind: MarketKind; side: Side };

// TxLINE records always carry Participant as a 1/2 index (never the team id).
export const sideOf = (participant: unknown): 1 | 2 => (participant === 2 ? 2 : 1);

// Map a possession/action trigger to weighted market choices. Intensity skews
// the question: high danger → likely a goal call; calm attack → corner/shot.
const WEIGHTS: Record<Trigger, [MarketKind, number][]> = {
  high_danger: [["goal", 5], ["corner", 3], ["shot", 2]],
  danger: [["corner", 4], ["shot", 3], ["goal", 2], ["booking", 1]],
  attack: [["corner", 3], ["shot", 4], ["booking", 2], ["goal", 1]],
  shot: [["goal", 3], ["shot", 4], ["corner", 2], ["booking", 1]],
  free_kick: [["booking", 5], ["corner", 2], ["shot", 2], ["goal", 1]],
};

export function pickMarket(trigger: Trigger, side: 1 | 2, rng: () => number = Math.random): Market {
  const table = WEIGHTS[trigger] ?? WEIGHTS.attack;
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  let kind: MarketKind = table[0][0];
  for (const [k, w] of table) { r -= w; if (r <= 0) { kind = k; break; } }
  return { kind, side: kind === "booking" ? 0 : side };
}

// Per-market answer window (minutes), calibrated so neither YES nor NO is a
// near-certainty given each stat's real rate (~goals rare, shots frequent).
// Live matches use SHORTER windows (2–4 min) so calls resolve while you watch.
const WINDOWS: Record<MarketKind, number[]> = {
  goal: [4, 5, 6, 7, 8, 10],
  corner: [4, 5, 6, 7, 8],
  shot: [1, 2, 3],
  booking: [6, 8, 10, 12],
};
const WINDOWS_LIVE: Record<MarketKind, number[]> = {
  goal: [2, 3, 4, 5],
  corner: [2, 3, 4],
  shot: [1, 2, 3],
  booking: [3, 4, 5],
};
export function pickWindow(kind: MarketKind, live = false, rng: () => number = Math.random): number {
  const arr = (live ? WINDOWS_LIVE : WINDOWS)[kind];
  return arr[Math.floor(rng() * arr.length)];
}

// A bet settles YES when a matching signal lands inside its window.
export function marketMatches(betKind: MarketKind, betSide: Side, sig: MarketSignal): boolean {
  if (betKind !== sig.kind) return false;
  if (betSide === 0) return true; // booking: either team counts
  return betSide === sig.side;
}

export function marketQuestion(kind: MarketKind, teamName: string, mins: number): string {
  const w = mins === 1 ? "minute" : "minutes";
  switch (kind) {
    case "goal": return `Will ${teamName} score in the next ${mins} ${w}?`;
    case "corner": return `Will ${teamName} win a corner in the next ${mins} ${w}?`;
    case "shot": return `Will ${teamName} get a shot away in the next ${mins} ${w}?`;
    case "booking": return `A booking in the next ${mins} ${w}?`;
  }
}

export function marketLabel(kind: MarketKind, side: Side, teamName: string, mins: number): string {
  switch (kind) {
    case "goal": return `${teamName} goal in ${mins}m`;
    case "corner": return `${teamName} corner in ${mins}m`;
    case "shot": return `${teamName} shot in ${mins}m`;
    case "booking": return `Booking in ${mins}m`;
  }
}

export function marketHeader(kind: MarketKind): { icon: string; text: string } {
  switch (kind) {
    case "goal": return { icon: "⚡", text: "Goal chance" };
    case "corner": return { icon: "🚩", text: "Corner watch" };
    case "shot": return { icon: "🎯", text: "Shot watch" };
    case "booking": return { icon: "🟨", text: "Booking watch" };
  }
}
