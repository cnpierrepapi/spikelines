// Tunables for the group-call game.
export const GROUP_REWARD = 20; // SPIKES per correct LIVE group call
export const ARCHIVED_REWARD = 15; // SPIKES per correct ARCHIVED (replay) group call
export const DECISION_WINDOW_MS = 30_000; // how long taps are accepted after a call fires
export const CALL_COOLDOWN_MS = 90_000; // min gap between calls in the same chat (anti-spam)
export const DISCOVERY_MS = 60_000; // how often to re-check which matches are live
export const SETTLE_SWEEP: number = 1; // (kept for clarity) sweeps run every feed poll

// ── T8 economy ──────────────────────────────────────────────────────
export const STREAK_SAVE_MIN = 3; // shortest broken streak worth offering to save
export const STREAK_SAVE_WINDOW_MS = 5 * 60_000; // how long a save offer stays valid
const STREAK_SAVE_COST_PER = 8; // SPIKES per streak-length to buy it back
const STREAK_SAVE_COST_CAP = 120; // never charge more than this
export const STREAK_MILESTONES = [5, 10, 25, 50, 100]; // streaks that earn a praise DM

// Price of saving a broken streak — scales with what you're protecting, capped.
export function streakSaveCost(prevStreak: number): number {
  return Math.min(STREAK_SAVE_COST_CAP, prevStreak * STREAK_SAVE_COST_PER);
}
