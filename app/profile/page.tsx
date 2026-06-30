"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getBalance, getBets, getGames, getPlayed, leaderboardScore,
  getWallet, saveWallet, clearWallet,
  type StoredBet, type GameStat,
} from "@/lib/store";
import { detectWallets, connectWallet, signMessage, ownershipMessage, type WalletName } from "@/lib/wallet";

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

export default function Profile() {
  const [balance, setBalance] = useState(0);
  const [score, setScore] = useState(0);
  const [bets, setBets] = useState<StoredBet[]>([]);
  const [games, setGames] = useState<GameStat[]>([]);
  const [played, setPlayed] = useState(0);

  const [wallet, setWallet] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<WalletName | null>(null);
  const [installed, setInstalled] = useState<WalletName[]>([]);

  useEffect(() => {
    setBalance(getBalance());
    setScore(leaderboardScore());
    setBets(getBets());
    setGames(getGames());
    setPlayed(getPlayed().length);
    setWallet(getWallet());
    setInstalled(detectWallets());
  }, []);

  // Derived stats.
  const settled = bets.length; // only won/lost calls are recorded
  const won = bets.filter((b) => b.status === "won").length;
  const winRate = settled ? Math.round((won / settled) * 100) : 0;
  const earned = bets.reduce((s, b) => s + (b.status === "won" ? b.reward : 0), 0);
  const bestStreak = games.reduce((m, g) => Math.max(m, g.maxStreak), 0);

  // Connect → prove ownership: fetch a server nonce, sign it with the wallet,
  // verify the signature server-side, then save the address. No pasted address
  // is ever trusted — only a real signature links a payout wallet.
  const connectAndVerify = async (name: WalletName) => {
    setErr("");
    setBusy(name);
    try {
      const { address } = await connectWallet(name);
      const { nonce } = await fetch("/api/wallet/nonce").then((r) => r.json());
      const signature = await signMessage(name, ownershipMessage(address, nonce));
      const res = await fetch("/api/wallet/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, nonce, signature }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "verification failed");
      saveWallet(address);
      setWallet(address);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't link wallet.");
    } finally {
      setBusy(null);
    }
  };

  const unlink = () => { clearWallet(); setWallet(""); };

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-30 nav-blur border-b border-white/[0.06]">
        <div className="app-container flex items-center justify-between py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-primary font-black text-xl tracking-tight">SPIKES</span>
            <span className="text-muted text-sm">· Spikelines</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/play" className="text-sm text-muted hover:text-foreground">Play</Link>
            <Link href="/leaderboard" className="text-sm text-muted hover:text-foreground">Leaderboard</Link>
            <div className="text-sm font-mono px-3 py-1.5 rounded-full border border-white/10">
              <span className="text-primary font-bold">{balance.toLocaleString()}</span> <span className="text-muted">SPIKES</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="app-container py-8 max-w-2xl">
        <h1 className="text-3xl font-black mb-1">Your profile</h1>
        <p className="text-muted text-sm mb-6">Your SPIKES, your record, and where to send your rewards.</p>

        {/* Headline stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Stat label="SPIKES" value={balance.toLocaleString()} primary />
          <Stat label="Leaderboard" value={score} />
          <Stat label="Win rate" value={settled ? `${winRate}%` : "—"} />
          <Stat label="Best streak" value={bestStreak} />
        </div>

        {/* Rewards / wallet */}
        <div className="card-surface rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-black text-lg">Rewards</h2>
            <span className="text-xs uppercase tracking-widest text-muted">Solana · USDC</span>
          </div>
          <p className="text-muted text-sm mb-4">
            Top of the <Link href="/leaderboard" className="text-primary font-semibold">weekly leaderboard</Link> shares a USDC pool. Link a wallet so your payout has somewhere to land.
          </p>

          {wallet ? (
            <div className="rounded-xl border border-success/40 bg-success/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-success text-sm font-bold">✓ Wallet linked</div>
                  <div className="text-muted font-mono text-xs truncate mt-0.5" title={wallet}>{short(wallet)}</div>
                </div>
                <button onClick={unlink} className="text-muted hover:text-foreground text-xs font-bold shrink-0">unlink</button>
              </div>
              <p className="text-muted text-[11px] mt-3">You&apos;re set to receive payouts at this address. Pool distributions are processed by Spikelines at the end of each weekly cycle.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {(installed.length ? installed : (["Phantom", "Solflare", "Backpack"] as WalletName[])).map((name) => {
                const isInstalled = installed.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => connectAndVerify(name)}
                    disabled={!!busy}
                    className={`w-full py-3 rounded-xl font-black active:scale-95 transition disabled:opacity-60 ${name === (installed[0] ?? "Phantom") ? "bg-primary text-background gold-glow" : "bg-white/5 border border-white/10 text-foreground"}`}
                  >
                    {busy === name ? "Confirm in your wallet…" : `Connect ${name}${isInstalled ? "" : " ↗"}`}
                  </button>
                );
              })}
              <p className="text-muted text-[11px] text-center">You&apos;ll be asked to sign a message — this proves you own the wallet. It&apos;s free and never moves funds.</p>
              {err && <p className="text-destructive text-xs text-center">{err}</p>}
            </div>
          )}
        </div>

        {/* Career summary */}
        <div className="grid sm:grid-cols-3 gap-3 mb-6">
          <Stat label="Matches played" value={played} />
          <Stat label="Calls settled" value={settled} />
          <Stat label="SPIKES from calls" value={earned.toLocaleString()} />
        </div>

        {/* Recent calls */}
        <div className="card-surface rounded-2xl p-5">
          <div className="text-xs uppercase tracking-widest text-muted mb-3">Recent calls</div>
          {bets.length === 0 ? (
            <p className="text-muted text-sm">No calls yet — <Link href="/play" className="text-primary font-bold">pick a match</Link> and start a streak.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {bets.slice(0, 12).map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm gap-2">
                  <span className="text-muted truncate pr-2">
                    {b.match} · <span className={b.choice === "YES" ? "text-success" : "text-destructive"}>{b.choice}</span>
                  </span>
                  <span className={`shrink-0 font-bold text-xs ${b.status === "won" ? "text-success" : "text-destructive"}`}>
                    {b.status === "won" ? `✓ +${b.reward}` : "✕ missed"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, primary }: { label: string; value: string | number; primary?: boolean }) {
  return (
    <div className="card-surface rounded-2xl p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted mb-1">{label}</div>
      <div className={`text-2xl font-black tabular-nums ${primary ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
