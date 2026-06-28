// Client-side store for the shared user state (localStorage). Stands in for the
// cross-product account + on-chain layer until the real backend exists.
//   - SPIKES balance + bet history (earned currency)
//   - played matches (one-shot-per-match: each match playable once ever)
//   - paid flag ($5 user-slot unlock; stubbed until USDC rails land)
//   - daily streak-save counter (escalating SPIKES sink)
export type StoredBet = {
  id: number;
  match: string;
  mins: number;
  choice: "YES" | "NO";
  status: "won" | "lost";
  reward: number;
  at: number;
};

const BETS_KEY = "spikes_bets";
const BAL_KEY = "spikes_balance";
const PLAYED_KEY = "spikes_played";
const SAVES_PREFIX = "spikes_saves_"; // + YYYY-MM-DD

export const REPLAY_COST = 175; // SPIKES to replay an already-played archived match

// Cost of each streak-save through the day; the last value caps all further saves.
const STREAK_SAVE_SCHEDULE = [25, 50, 125, 150, 175];

const has = () => typeof window !== "undefined";
const dayKey = () => SAVES_PREFIX + new Date().toISOString().slice(0, 10);

// ── SPIKES balance ────────────────────────────────────────────────
export function getBalance(): number {
  if (!has()) return 0;
  return Number(localStorage.getItem(BAL_KEY) || 0);
}
export function addBalance(n: number) {
  if (!has()) return;
  localStorage.setItem(BAL_KEY, String(getBalance() + n));
}
// Spend SPIKES; returns false (no change) if the balance is too low.
export function spendBalance(n: number): boolean {
  if (!has()) return false;
  const bal = getBalance();
  if (bal < n) return false;
  localStorage.setItem(BAL_KEY, String(bal - n));
  return true;
}

// ── bet history ───────────────────────────────────────────────────
export function getBets(): StoredBet[] {
  if (!has()) return [];
  try {
    return JSON.parse(localStorage.getItem(BETS_KEY) || "[]");
  } catch {
    return [];
  }
}
export function recordBet(b: StoredBet) {
  if (!has()) return;
  localStorage.setItem(BETS_KEY, JSON.stringify([b, ...getBets()].slice(0, 50)));
}

// ── one-shot-per-match ────────────────────────────────────────────
export function getPlayed(): number[] {
  if (!has()) return [];
  try {
    return JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]");
  } catch {
    return [];
  }
}
export function hasPlayed(fid: number): boolean {
  return getPlayed().includes(fid);
}
export function markPlayed(fid: number) {
  if (!has() || hasPlayed(fid)) return;
  localStorage.setItem(PLAYED_KEY, JSON.stringify([...getPlayed(), fid]));
}
export function unmarkPlayed(fid: number) {
  if (!has()) return;
  localStorage.setItem(PLAYED_KEY, JSON.stringify(getPlayed().filter((f) => f !== fid)));
}
// Buy a replay of an already-played archived match: spend REPLAY_COST, clear the
// played flag so it can be played once more (re-marked on the next first call).
export function buyReplay(fid: number): boolean {
  if (!spendBalance(REPLAY_COST)) return false;
  unmarkPlayed(fid);
  return true;
}

// ── streak-save (escalating daily SPIKES sink) ────────────────────
export function streakSavesToday(): number {
  if (!has()) return 0;
  return Number(localStorage.getItem(dayKey()) || 0);
}
// Cost of the NEXT streak-save today: walks the schedule, then caps at the last.
export function streakSaveCost(): number {
  const n = streakSavesToday();
  return STREAK_SAVE_SCHEDULE[Math.min(n, STREAK_SAVE_SCHEDULE.length - 1)];
}
// Try to save a streak: spends the current cost, increments today's counter.
export function buyStreakSave(): { ok: boolean; cost: number } {
  const cost = streakSaveCost();
  if (!spendBalance(cost)) return { ok: false, cost };
  if (has()) localStorage.setItem(dayKey(), String(streakSavesToday() + 1));
  return { ok: true, cost };
}

// ── per-game stats → leaderboard ──────────────────────────────────
// Each played match contributes (maxStreak/bets)×100 points; the score sums them.
// e.g. game1 40/80=50 + game2 20/50=25 → 75.
// Anti-farming: a match's points are CAPPED at 35 unless ≥14 calls were made in it
// (so a few lucky calls on a tiny sample can't post a high accuracy).
export const MIN_BETS_FOR_HIGH = 14;
export const LOW_SAMPLE_CAP = 35;
export type GameStat = { fid: number; match: string; maxStreak: number; bets: number };
const GAMES_KEY = "spikes_games";

export function getGames(): GameStat[] {
  if (!has()) return [];
  try {
    return JSON.parse(localStorage.getItem(GAMES_KEY) || "[]");
  } catch {
    return [];
  }
}
// Upsert one game's stats by fid (a match is played once, but this updates live).
export function recordGameStats(fid: number, match: string, maxStreak: number, bets: number) {
  if (!has()) return;
  const games = getGames().filter((g) => g.fid !== fid);
  games.push({ fid, match, maxStreak, bets });
  localStorage.setItem(GAMES_KEY, JSON.stringify(games));
}
// Points one match contributes (0–100), with the low-sample cap applied.
export function gamePoints(g: GameStat): number {
  if (g.bets <= 0) return 0;
  const raw = (g.maxStreak / g.bets) * 100;
  return g.bets >= MIN_BETS_FOR_HIGH ? raw : Math.min(raw, LOW_SAMPLE_CAP);
}
export function leaderboardScore(games: GameStat[] = getGames()): number {
  return Math.round(games.reduce((s, g) => s + gamePoints(g), 0));
}
