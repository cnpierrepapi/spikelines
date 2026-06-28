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
const PAID_KEY = "spikes_paid";
const SAVES_PREFIX = "spikes_saves_"; // + YYYY-MM-DD

const STREAK_SAVE_BASE = 100; // first save of the day costs this…
const STREAK_SAVE_GROWTH = 2; // …then doubles per save that day

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

// ── $5 paid unlock (stubbed; real USDC later) ─────────────────────
export function isPaid(): boolean {
  if (!has()) return false;
  return localStorage.getItem(PAID_KEY) === "1";
}
export function setPaid(v: boolean) {
  if (!has()) return;
  localStorage.setItem(PAID_KEY, v ? "1" : "0");
}

// ── streak-save (escalating daily SPIKES sink) ────────────────────
export function streakSavesToday(): number {
  if (!has()) return 0;
  return Number(localStorage.getItem(dayKey()) || 0);
}
// Cost of the NEXT streak-save today: base, then doubling each use.
export function streakSaveCost(): number {
  return STREAK_SAVE_BASE * Math.pow(STREAK_SAVE_GROWTH, streakSavesToday());
}
// Try to save a streak: spends the current cost, increments today's counter.
export function buyStreakSave(): { ok: boolean; cost: number } {
  const cost = streakSaveCost();
  if (!spendBalance(cost)) return { ok: false, cost };
  if (has()) localStorage.setItem(dayKey(), String(streakSavesToday() + 1));
  return { ok: true, cost };
}

// ── per-game stats → leaderboard ──────────────────────────────────
// Each played match contributes maxStreak/bets; the score sums those ratios ×100.
// e.g. game1 40/80=0.5 + game2 20/50=0.25 → 0.75 → score 75.
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
export function leaderboardScore(games: GameStat[] = getGames()): number {
  const ratio = games.reduce((s, g) => (g.bets > 0 ? s + g.maxStreak / g.bets : s), 0);
  return Math.round(ratio * 100);
}
