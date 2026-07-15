// Client-side store for user state (localStorage). Stands in for the
// account + on-chain layer until the real backend exists.
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
// Set the balance to an authoritative value (e.g. server balance after a pack buy).
export function setBalance(n: number) {
  if (!has()) return;
  localStorage.setItem(BAL_KEY, String(Math.max(0, Math.round(n))));
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
// ── identity (device id + chosen username) ────────────────────────
// device_id = a stable anon key for this browser; it's the player's primary key
// in Supabase. username is chosen on first /play visit.
const DEVICE_KEY = "spikes_device";
const USERNAME_KEY = "spikes_username";
export function getDeviceId(): string {
  if (!has()) return "";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
export function getUsername(): string {
  if (!has()) return "";
  return localStorage.getItem(USERNAME_KEY) || "";
}
export function setUsername(name: string) {
  if (!has()) return;
  localStorage.setItem(USERNAME_KEY, name);
}

// ── settle retry queue (durability for the proof ledger) ──────────
// A settled bet is POSTed to /api/bets/settle to be persisted + proved. That POST
// used to be fire-and-forget: if the backend was down (as during the July DB
// outage) the call — and its proof — was lost forever. We now queue any failed
// settle locally and re-send it on the next settle or app load, so a transient
// backend blip can never silently drop a player's calls again. Keyed by
// client_bet_id so re-queuing the same bet de-dupes.
const SETTLE_Q_KEY = "spikes_settle_queue";
type QueuedSettle = { id: string; body: unknown };

export function getSettleQueue(): QueuedSettle[] {
  if (!has()) return [];
  try {
    return JSON.parse(localStorage.getItem(SETTLE_Q_KEY) || "[]");
  } catch {
    return [];
  }
}
export function queueSettle(id: string, body: unknown) {
  if (!has()) return;
  const q = getSettleQueue().filter((x) => x.id !== id); // replace any prior attempt
  q.push({ id, body });
  localStorage.setItem(SETTLE_Q_KEY, JSON.stringify(q.slice(-100))); // bound the backlog
}
export function dequeueSettle(id: string) {
  if (!has()) return;
  localStorage.setItem(SETTLE_Q_KEY, JSON.stringify(getSettleQueue().filter((x) => x.id !== id)));
}

// ── payout wallet (Solana address for USDC rewards) ───────────────
// Stored locally until the payout backend lands; it's the address a player's
// pool share / SPIKES redemption would be sent to.
const WALLET_KEY = "spikes_wallet";
// Base58, 32–44 chars — the standard shape of a Solana public key.
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isValidWallet(addr: string): boolean {
  return SOLANA_RE.test(addr.trim());
}
export function getWallet(): string {
  if (!has()) return "";
  return localStorage.getItem(WALLET_KEY) || "";
}
export function saveWallet(addr: string): boolean {
  if (!has() || !isValidWallet(addr)) return false;
  localStorage.setItem(WALLET_KEY, addr.trim());
  return true;
}
export function clearWallet() {
  if (!has()) return;
  localStorage.removeItem(WALLET_KEY);
}

// ── per-fixture live-room snapshot (survives reload) ──────────────
// The live room derives streak / bets / events from a one-shot delta stream that
// the server won't replay on reconnect, so they'd vanish on reload. We snapshot
// the player-derived state (plus a score/clock seed to avoid a 0–0 flash) keyed
// by fixture id, hydrate it on mount, and re-save it whenever it changes.
// Cumulative match stats (the four on-chain-provable categories, per side).
// Goals live in `score`; this carries corners + cards.
export type MatchStats = { c1: number; c2: number; y1: number; y2: number; r1: number; r2: number };
export const EMPTY_STATS: MatchStats = { c1: 0, c2: 0, y1: 0, y2: 0, r1: 0, r2: 0 };

export type LiveRoomSnapshot = {
  bets: unknown[];
  events: unknown[];
  streak: number;
  maxStreak: number;
  gameBets: number;
  bonusAwarded: boolean;
  score: { p1: number; p2: number };
  stats?: MatchStats;
  shootout: { p1: number; p2: number } | null; // penalty shootout (PE), null if none
  sec: number;
  finished: boolean;
};
const LIVE_PREFIX = "spikes_live_"; // + fid

export function getLiveRoom(fid: number): LiveRoomSnapshot | null {
  if (!has()) return null;
  try {
    const raw = localStorage.getItem(LIVE_PREFIX + fid);
    return raw ? (JSON.parse(raw) as LiveRoomSnapshot) : null;
  } catch {
    return null;
  }
}
export function saveLiveRoom(fid: number, snap: LiveRoomSnapshot) {
  if (!has()) return;
  try {
    localStorage.setItem(LIVE_PREFIX + fid, JSON.stringify(snap));
  } catch {}
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
