"use client";

// Admin rewards console. Locked to allow-listed wallets (ADMIN_WALLETS): sign in
// by signing a nonce with your wallet → get a 2h bearer token → set a day's USDC
// pool, preview the split, and distribute (credits each player's withdrawable
// balance). Split: top 10% by that day's score share 30%; 70% split by daily
// improvement (today − yesterday score).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { detectWallets, connectWallet, signMessage, type WalletName } from "@/lib/wallet";

// Must match lib/adminAuth.adminMessage().
const adminMessage = (address: string, nonce: string) =>
  `Spikelines ADMIN sign-in.\n\nWallet: ${address}\nNonce: ${nonce}`;

const todayUTC = () => new Date().toISOString().slice(0, 10);
const usd = (n: number) => `$${n.toFixed(2)}`;

type PreviewRow = {
  device_id: string; username: string; today: number; improve: number;
  top_usdc: number; pb_usdc: number; total_usdc: number;
};
type Overview = {
  ok: boolean; day: string; pool: number;
  saved: { day: string; pool_usdc: string; status: string } | null;
  players: number; preview: PreviewRow[]; error?: string;
};

export default function AdminConsole() {
  const [installed, setInstalled] = useState<WalletName[]>([]);
  const [token, setToken] = useState<string>("");
  const [address, setAddress] = useState<string>("");
  const [authErr, setAuthErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [day, setDay] = useState(todayUTC());
  const [poolInput, setPoolInput] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setInstalled(detectWallets());
    const t = sessionStorage.getItem("spk_admin_token") || "";
    const a = sessionStorage.getItem("spk_admin_addr") || "";
    if (t) { setToken(t); setAddress(a); }
  }, []);

  const signIn = async () => {
    setAuthErr(""); setBusy(true);
    try {
      const w = installed[0];
      if (!w) throw new Error("Install a Solana wallet (Phantom) to sign in.");
      const { address: addr } = await connectWallet(w);
      const { nonce } = await fetch("/api/wallet/nonce").then((r) => r.json());
      const signature = await signMessage(w, adminMessage(addr, nonce));
      const res = await fetch("/api/admin/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr, nonce, signature }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "sign-in failed");
      setToken(res.token); setAddress(addr);
      sessionStorage.setItem("spk_admin_token", res.token);
      sessionStorage.setItem("spk_admin_addr", addr);
    } catch (e) {
      setAuthErr(e instanceof Error ? e.message : "sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    setToken(""); setAddress(""); setData(null);
    sessionStorage.removeItem("spk_admin_token");
    sessionStorage.removeItem("spk_admin_addr");
  };

  const auth = useCallback(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async (d: string, poolOverride?: string) => {
    if (!token) return;
    setMsg("");
    const qs = new URLSearchParams({ day: d });
    if (poolOverride != null && poolOverride !== "") qs.set("pool", poolOverride);
    const res: Overview = await fetch(`/api/admin/overview?${qs}`, { headers: auth() }).then((r) => r.json());
    if (!res.ok) {
      if (res.error === "unauthorized") signOut();
      setMsg(res.error || "failed to load"); return;
    }
    setData(res);
    if (res.saved && poolOverride == null) setPoolInput(String(Number(res.saved.pool_usdc)));
  }, [token, auth]);

  useEffect(() => { if (token) load(day); }, [token, day, load]);

  const savePool = async () => {
    setBusy(true); setMsg("");
    const res = await fetch("/api/admin/set-pool", {
      method: "POST", headers: { "Content-Type": "application/json", ...auth() },
      body: JSON.stringify({ day, pool_usdc: Number(poolInput) }),
    }).then((r) => r.json());
    setBusy(false);
    setMsg(res.ok ? `✓ Pool for ${day} set to ${usd(Number(poolInput))}` : (res.error || "save failed"));
    if (res.ok) load(day);
  };

  const distribute = async () => {
    if (!confirm(`Distribute ${usd(data?.pool ?? 0)} for ${day}? This credits players and can't be undone.`)) return;
    setBusy(true); setMsg("");
    const res = await fetch("/api/admin/distribute", {
      method: "POST", headers: { "Content-Type": "application/json", ...auth() },
      body: JSON.stringify({ day }),
    }).then((r) => r.json());
    setBusy(false);
    setMsg(res.ok ? `✓ Distributed to ${res.credited} player(s) — ${usd(Number(res.total_usdc))} credited` : (res.error || "distribute failed"));
    if (res.ok) load(day);
  };

  const distributed = data?.saved?.status === "distributed";
  const totalPreview = (data?.preview ?? []).reduce((s, r) => s + r.total_usdc, 0);

  // ── Sign-in gate ──────────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="card-surface gold-glow rounded-2xl p-8 max-w-sm w-full text-center">
          <div className="text-4xl mb-3">🔐</div>
          <h1 className="text-2xl font-black mb-1">Admin console</h1>
          <p className="text-muted text-sm mb-6">Sign in with an authorized wallet to manage rewards.</p>
          <button onClick={signIn} disabled={busy}
            className="w-full py-3 rounded-xl bg-primary text-background font-black gold-glow active:scale-95 transition disabled:opacity-50">
            {busy ? "Check your wallet…" : "Sign in with wallet →"}
          </button>
          {authErr && <p className="text-destructive text-xs mt-3">{authErr}</p>}
          {!installed.length && <p className="text-muted text-[11px] mt-3">No Solana wallet detected.</p>}
          <Link href="/" className="block text-muted text-xs mt-5 hover:text-foreground">← back to Spikelines</Link>
        </div>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-30 nav-blur border-b border-white/[0.06]">
        <div className="app-container flex items-center justify-between py-3">
          <span className="font-black text-xl tracking-tight">Admin <span className="text-primary">· rewards</span></span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted font-mono">{address.slice(0, 4)}…{address.slice(-4)}</span>
            <button onClick={signOut} className="text-muted hover:text-foreground font-bold">sign out</button>
          </div>
        </div>
      </nav>

      <main className="app-container py-6 max-w-3xl">
        {/* Day + pool */}
        <div className="card-surface rounded-2xl p-5 mb-5">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-widest text-muted">Reward day</span>
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 font-bold" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-widest text-muted">Pool (USDC)</span>
              <input type="number" min="0" step="0.01" value={poolInput} placeholder="0.00"
                onChange={(e) => { setPoolInput(e.target.value); load(day, e.target.value); }}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 font-bold w-32 tabular-nums" />
            </label>
            <button onClick={savePool} disabled={busy || distributed || poolInput === ""}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 font-black text-sm active:scale-95 transition disabled:opacity-40">
              {distributed ? "locked" : "Save pool"}
            </button>
            <button onClick={distribute} disabled={busy || distributed || !data?.saved || (data?.pool ?? 0) <= 0}
              className="px-4 py-2.5 rounded-xl bg-primary text-background font-black text-sm gold-glow active:scale-95 transition disabled:opacity-40 ml-auto">
              {distributed ? "✓ distributed" : "Distribute →"}
            </button>
          </div>
          <p className="text-muted text-[11px] mt-3">
            Top 10% by that day&apos;s score share <b>30%</b>; the rest of <b>70%</b> is split by daily improvement
            (today − yesterday). Set a day in advance — it&apos;s revealed to players on that day.
          </p>
          {msg && <p className="text-sm mt-2">{msg}</p>}
        </div>

        {/* Preview */}
        <div className="card-surface rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-black">Split preview <span className="text-muted text-xs font-normal">· {data?.players ?? 0} players</span></h2>
            <span className="text-xs text-muted">
              {distributed ? "distributed" : "dry run"} · projected payout <b className="text-foreground">{usd(totalPreview)}</b>
            </span>
          </div>
          {!data?.preview?.length ? (
            <p className="text-muted text-sm">No player snapshots for {day} yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted text-[11px] uppercase tracking-widest">
                  <tr className="text-left border-b border-white/10">
                    <th className="py-2">Player</th>
                    <th className="text-right">Score</th>
                    <th className="text-right">Improve</th>
                    <th className="text-right">Top 30%</th>
                    <th className="text-right">PB 70%</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {data.preview.map((r) => (
                    <tr key={r.device_id} className="border-b border-white/[0.04]">
                      <td className="py-2 font-bold">{r.username}</td>
                      <td className="text-right">{r.today}</td>
                      <td className="text-right text-success">{r.improve > 0 ? `+${r.improve}` : "—"}</td>
                      <td className="text-right text-muted">{r.top_usdc > 0 ? usd(r.top_usdc) : "—"}</td>
                      <td className="text-right text-muted">{r.pb_usdc > 0 ? usd(r.pb_usdc) : "—"}</td>
                      <td className="text-right font-black text-primary">{r.total_usdc > 0 ? usd(r.total_usdc) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
