// Shared micro-bet market logic for both the live (/live/[fid]) and archived
// (/match/[fid]) match rooms. Keeping this in one place stops the two pages
// from drifting apart again.
//
// A "market" is the question a prompt asks. Every market is side-framed to the
// team currently attacking and settles on THAT team's stat. The four markets map
// 1:1 onto the only stats TxLINE anchors on-chain (goals / corners / yellow / red
// cards, per side) — so every bet is provable via the txoracle validate_stat
// view. Shots are NOT on-chain, so there is no shot market (a shot still acts as
// a TRIGGER that opens a goal/corner call, and still shows in the highlights).
export type MarketKind = "goal" | "corner" | "yellow" | "red";
export type Side = 1 | 2;
export type Trigger = "high_danger" | "danger" | "attack" | "shot" | "free_kick";
export type MarketSignal = { kind: MarketKind; side: 1 | 2 };

export type Market = { kind: MarketKind; side: Side };

// TxLINE records always carry Participant as a 1/2 index (never the team id).
export const sideOf = (participant: unknown): 1 | 2 => (participant === 2 ? 2 : 1);

// Map a possession/action trigger to weighted market choices. Intensity skews
// the question: high danger → likely a goal call; a free kick → likely a card.
// Red cards are rare, so they carry low weight (an occasional longshot call).
const WEIGHTS: Record<Trigger, [MarketKind, number][]> = {
  high_danger: [["goal", 5], ["corner", 3], ["yellow", 1]],
  danger: [["corner", 4], ["goal", 2], ["yellow", 2], ["red", 1]],
  attack: [["corner", 4], ["yellow", 2], ["goal", 1], ["red", 1]],
  shot: [["goal", 4], ["corner", 3], ["yellow", 1]],
  free_kick: [["yellow", 5], ["corner", 2], ["goal", 1], ["red", 1]],
};

export function pickMarket(trigger: Trigger, side: 1 | 2, rng: () => number = Math.random): Market {
  const table = WEIGHTS[trigger] ?? WEIGHTS.attack;
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  let kind: MarketKind = table[0][0];
  for (const [k, w] of table) { r -= w; if (r <= 0) { kind = k; break; } }
  return { kind, side };
}

// Per-market answer window (minutes), calibrated so neither YES nor NO is a
// near-certainty given each stat's real rate (~goals rare, shots frequent).
const WINDOWS: Record<MarketKind, number[]> = {
  goal: [4, 5, 6, 7, 8, 10],
  corner: [4, 5, 6, 7, 8],
  yellow: [6, 8, 10, 12],
  red: [8, 10, 12],
};
export function pickWindow(kind: MarketKind, live = false, rng: () => number = Math.random): number {
  // Live: keep it snappy — 8 of 10 calls resolve in 2–4 min, occasionally longer.
  if (live) {
    const arr = rng() < 0.8 ? [2, 3, 4] : [5, 6];
    return arr[Math.floor(rng() * arr.length)];
  }
  const arr = WINDOWS[kind];
  return arr[Math.floor(rng() * arr.length)];
}

// A bet settles YES when a matching signal lands inside its window.
export function marketMatches(betKind: MarketKind, betSide: Side, sig: MarketSignal): boolean {
  if (betKind !== sig.kind) return false;
  return betSide === sig.side;
}

export function marketQuestion(kind: MarketKind, teamName: string, mins: number): string {
  const w = mins === 1 ? "minute" : "minutes";
  switch (kind) {
    case "goal": return `Will ${teamName} score in the next ${mins} ${w}?`;
    case "corner": return `Will ${teamName} win a corner in the next ${mins} ${w}?`;
    case "yellow": return `Will ${teamName} pick up a yellow card in the next ${mins} ${w}?`;
    case "red": return `Will ${teamName} get a red card in the next ${mins} ${w}?`;
  }
}

export function marketLabel(kind: MarketKind, side: Side, teamName: string, mins: number): string {
  switch (kind) {
    case "goal": return `${teamName} goal in ${mins}m`;
    case "corner": return `${teamName} corner in ${mins}m`;
    case "yellow": return `${teamName} yellow in ${mins}m`;
    case "red": return `${teamName} red in ${mins}m`;
  }
}

export function marketHeader(kind: MarketKind): { icon: string; text: string } {
  switch (kind) {
    case "goal": return { icon: "⚡", text: "Goal chance" };
    case "corner": return { icon: "🚩", text: "Corner watch" };
    case "yellow": return { icon: "🟨", text: "Yellow-card watch" };
    case "red": return { icon: "🟥", text: "Red-card watch" };
  }
}

// Each market maps to exactly one on-chain TxLINE stat. statKey indexes the
// per-side score stat (verified later via the validate_stat view); the side
// selects Participant1 vs Participant2. These are the ONLY stats anchored
// on-chain, which is why the four markets are limited to them.
export const STAT_LABEL: Record<MarketKind, string> = {
  goal: "Goals",
  corner: "Corners",
  yellow: "YellowCards",
  red: "RedCards",
};
