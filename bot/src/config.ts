// Tunables for the group-call game.
export const GROUP_REWARD = 20; // SPIKES per correct group call
export const DECISION_WINDOW_MS = 30_000; // how long taps are accepted after a call fires
export const CALL_COOLDOWN_MS = 90_000; // min gap between calls in the same chat (anti-spam)
export const DISCOVERY_MS = 60_000; // how often to re-check which matches are live
export const SETTLE_SWEEP: number = 1; // (kept for clarity) sweeps run every feed poll
