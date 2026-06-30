// Client → server glue for the Supabase-backed features (leaderboard, username,
// profile sync). Best-effort: if the backend isn't configured the app still runs
// fully on local state.
import { getDeviceId, getUsername, getBalance, getWallet, leaderboardScore } from "./store";

type SyncBody = { device_id: string; username: string; score: number; spikes: number; wallet: string };
function localState(usernameOverride?: string): SyncBody {
  return {
    device_id: getDeviceId(),
    username: usernameOverride ?? getUsername(),
    score: leaderboardScore(),
    spikes: getBalance(),
    wallet: getWallet(),
  };
}

export type Player = { device_id: string; username: string | null; wallet: string | null; spikes: number; score: number; rewards_usdc: number };

// Push local progress (score/spikes/wallet/username) and return the player row.
export async function syncProfile(): Promise<Player | null> {
  const body = localState();
  if (!body.device_id) return null;
  try {
    const j = await fetch("/api/profile/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    return j.player ?? null;
  } catch {
    return null;
  }
}

// Claim a username (also seeds the player's row). Returns taken/ok.
export async function claimUsername(name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/profile/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(localState(name)) });
    return await r.json();
  } catch {
    return { ok: false, error: "network" };
  }
}

export type LeaderRow = { username: string; score: number };
export async function fetchLeaderboard(): Promise<{ ok: boolean; players: LeaderRow[] }> {
  try {
    const j = await fetch("/api/leaderboard").then((r) => r.json());
    return { ok: !!j.ok, players: j.players ?? [] };
  } catch {
    return { ok: false, players: [] };
  }
}

// Buy a pack: verify the on-chain tx + credit SPIKES. Returns the new balance.
export async function verifyPack(signature: string, packId: string): Promise<{ ok: boolean; balance?: number; error?: string }> {
  try {
    const r = await fetch("/api/packs/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature, packId, device_id: getDeviceId(), username: getUsername(), wallet: getWallet() }),
    });
    return await r.json();
  } catch {
    return { ok: false, error: "network" };
  }
}

// Persist a settled bet to the public proof ledger + verify it on-chain. Best-
// effort and fire-and-forget — gameplay never waits on it.
export type SettleBet = {
  client_bet_id: number;
  fixture_id: number;
  match: string;
  mode: "live" | "archived";
  market: string;
  side: 1 | 2;
  mins: number;
  choice: "YES" | "NO";
  outcome: "won" | "lost";
  reward: number;
  base_ts?: number;
  settle_ts?: number;
};
export function settleBet(b: SettleBet): void {
  const device_id = getDeviceId();
  if (!device_id) return;
  try {
    void fetch("/api/bets/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...b, device_id, username: getUsername() }),
      keepalive: true, // survive a page navigation right after a final-whistle settle
    });
  } catch {}
}

export async function requestWithdraw(): Promise<{ ok: boolean; queued?: number; error?: string }> {
  try {
    const r = await fetch("/api/rewards/withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id: getDeviceId() }) });
    return await r.json();
  } catch {
    return { ok: false, error: "network" };
  }
}
