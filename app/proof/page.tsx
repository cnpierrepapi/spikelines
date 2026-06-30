"use client";

// The public proof ledger: every settled bet from every player. A bet that
// reconciles to TxLINE's on-chain scores Merkle root shows a live "Verify" button;
// clicking it LANDS a real validate_stat transaction on Solana and returns the tx
// hash — an immutable, explorer-linkable receipt that the exact stat is anchored.
// A bet whose root isn't posted / doesn't reconcile can't be proven, so its button
// is greyed out. Nothing here is taken on trust.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Bet = {
  id: number;
  username: string | null;
  fixture_id: number;
  match: string;
  mode: "live" | "archived";
  market: "goal" | "corner" | "yellow" | "red";
  side: 1 | 2;
  mins: number;
  choice: "YES" | "NO";
  outcome: "won" | "lost";
  reward: number;
  proof_status: "verified" | "unprovable" | "failed" | "pending";
  proof_root: string | null;
  proof_tx: string | null;
  reverted: boolean;
  revert_reason: string | null;
  created_at: string;
};
type Fixture = { fixture_id: number; match: string };
type Result = { txSig?: string | null; status?: string; detail?: string; delta?: number | null; reverted?: boolean; clawed?: number; revertReason?: string | null };

const MARKET_ICON: Record<Bet["market"], string> = { goal: "⚽", corner: "🚩", yellow: "🟨", red: "🟥" };
const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

function teamOf(match: string, side: 1 | 2): string {
  const parts = match.split("–");
  return (side === 2 ? parts[1] : parts[0])?.trim() || (side === 2 ? "Away" : "Home");
}

function Badge({ status, anchored }: { status: Bet["proof_status"]; anchored: boolean }) {
  if (anchored) return <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 text-success border-success/40 bg-success/10">⛓ on-chain</span>;
  const map: Record<Bet["proof_status"], { t: string; c: string }> = {
    verified: { t: "verifiable", c: "text-success border-success/40 bg-success/10" },
    unprovable: { t: "not anchored", c: "text-muted border-white/15 bg-white/5" },
    failed: { t: "not anchored", c: "text-muted border-white/15 bg-white/5" },
    pending: { t: "unchecked", c: "text-muted border-white/15 bg-white/5" },
  };
  const m = map[status] ?? map.pending;
  return <span className={`text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 ${m.c}`}>{m.t}</span>;
}

export default function ProofPage() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [fixture, setFixture] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, Result>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams({ limit: "150" });
    if (fixture) q.set("fixture", fixture);
    if (outcome) q.set("outcome", outcome);
    try {
      const j = await fetch(`/api/proof/list?${q}`).then((r) => r.json());
      setBets(j.bets ?? []);
      if ((j.fixtures ?? []).length) setFixtures(j.fixtures);
    } catch {
      setBets([]);
    }
    setLoading(false);
  }, [fixture, outcome]);

  useEffect(() => {
    load();
  }, [load]);

  // Anchor on-chain: land the real validate_stat tx and capture the signature.
  const anchor = async (id: number) => {
    setBusy(id);
    try {
      const j = await fetch("/api/proof/anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((r) => r.json());
      if (j.ok) {
        setResults((r) => ({ ...r, [id]: { txSig: j.settleSig, status: "verified", delta: j.delta, reverted: j.reverted, clawed: j.clawed, revertReason: j.revertReason } }));
        setBets((bs) => bs.map((b) => (b.id === id
          ? { ...b, proof_status: "verified", proof_tx: j.settleSig ?? b.proof_tx, reverted: !!j.reverted, revert_reason: j.revertReason ?? b.revert_reason, ...(j.clawed > 0 ? { outcome: "lost" as const, reward: 0 } : {}) }
          : b)));
      } else {
        setResults((r) => ({ ...r, [id]: { status: j.status, detail: j.detail } }));
        setBets((bs) => bs.map((b) => (b.id === id ? { ...b, proof_status: j.status ?? b.proof_status } : b)));
      }
    } catch {}
    setBusy(null);
  };

  // Re-run the read-only check (no tx) so a bet whose root posts later can flip from
  // greyed → verifiable without anchoring/spending.
  const recheck = async (id: number) => {
    setBusy(id);
    try {
      const j = await fetch("/api/proof/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((r) => r.json());
      if (j.ok) {
        setResults((r) => ({ ...r, [id]: { status: j.status, detail: j.detail, delta: j.delta } }));
        setBets((bs) => bs.map((b) => (b.id === id ? { ...b, proof_status: j.status, proof_root: j.root ?? b.proof_root } : b)));
      }
    } catch {}
    setBusy(null);
  };

  const anchoredCount = bets.filter((b) => b.proof_tx).length;

  return (
    <div className="min-h-screen">
      <main className="app-container py-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <Link href="/play" className="text-muted hover:text-foreground text-sm">← play</Link>
          <Link href="/leaderboard" className="text-muted hover:text-foreground text-sm">leaderboard →</Link>
        </div>

        <h1 className="text-3xl font-black mb-1">Proof ledger</h1>
        <p className="text-muted text-sm leading-relaxed mb-1">
          Every settled call, from every player. When a result reconciles to TxLINE&apos;s World Cup
          scores — anchored on <span className="text-foreground">Solana</span> as a Merkle root — its{" "}
          <span className="text-foreground font-semibold">Verify</span> button lights up. Tap it to{" "}
          <span className="text-foreground font-semibold">land a real <span className="font-mono text-primary">validate_stat</span> transaction</span>{" "}
          on-chain and get a transaction hash you can open in a Solana explorer. Greyed = not anchored
          on-chain (root not posted, or doesn&apos;t reconcile). No trust required.
        </p>
        <p className="text-xs text-muted mb-5">
          {loading ? "loading…" : `${bets.length} calls shown · ${anchoredCount} anchored on-chain`}
        </p>

        <div className="flex flex-wrap gap-2 mb-5">
          <select value={fixture} onChange={(e) => setFixture(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground">
            <option value="">All matches</option>
            {fixtures.map((f) => (
              <option key={f.fixture_id} value={f.fixture_id}>{f.match}</option>
            ))}
          </select>
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground">
            <option value="">Won &amp; lost</option>
            <option value="won">Won only</option>
            <option value="lost">Lost only</option>
          </select>
        </div>

        {!loading && bets.length === 0 && (
          <div className="card-surface rounded-2xl p-8 text-center text-muted">
            No calls settled yet. <Link href="/play" className="text-primary font-bold">Go make one →</Link>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {bets.map((b) => {
            const res = results[b.id];
            const txSig = res?.txSig || b.proof_tx;
            const anchored = !!txSig;
            const canAnchor = b.proof_status === "verified" && !anchored;
            const working = busy === b.id;
            return (
              <div key={b.id} className="card-surface rounded-xl p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span>{MARKET_ICON[b.market]}</span>
                      <span className="font-bold truncate">{teamOf(b.match, b.side)} {b.market}</span>
                      <span className="text-muted">·</span>
                      <span className={b.choice === "YES" ? "text-success font-bold" : "text-destructive font-bold"}>{b.choice}</span>
                      <span className={`text-xs font-bold ${b.outcome === "won" ? "text-success" : "text-muted"}`}>{b.outcome === "won" ? `✓ +${b.reward}` : "✕"}</span>
                      {b.reverted && (
                        <span className="text-[10px] font-bold uppercase tracking-wider rounded-full border px-2 py-0.5 text-destructive border-destructive/40 bg-destructive/10">⚑ overturned</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5 truncate">
                      {b.match} · {b.mins}m window · {b.username || "anon"} · {b.mode}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge status={b.proof_status} anchored={anchored} />
                    {anchored ? (
                      <a href={explorerTx(txSig!)} target="_blank" rel="noreferrer" className="text-xs font-bold rounded-lg border border-success/40 text-success px-2.5 py-1 hover:bg-success/10">
                        tx ↗
                      </a>
                    ) : canAnchor ? (
                      <button
                        onClick={() => anchor(b.id)}
                        disabled={working}
                        className="text-xs font-bold rounded-lg border border-primary/50 text-primary px-2.5 py-1 hover:bg-primary/10 disabled:opacity-50"
                        title="Land a validate_stat transaction on-chain"
                      >
                        {working ? "anchoring…" : "Verify ▶"}
                      </button>
                    ) : (
                      <button
                        onClick={() => recheck(b.id)}
                        disabled={working}
                        className="text-xs font-bold rounded-lg border border-white/10 text-muted px-2.5 py-1 cursor-not-allowed hover:border-white/20 disabled:opacity-50"
                        title={b.proof_status === "pending" ? "Not checked yet — tap to re-check against the chain" : "Can't be anchored: on-chain root not posted or doesn't reconcile. Tap to re-check."}
                      >
                        {working ? "…" : "Verify ▶"}
                      </button>
                    )}
                  </div>
                </div>
                {(res || b.proof_root || b.proof_tx || b.reverted) && (
                  <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between gap-2 text-[11px]">
                    <span className={`truncate ${b.reverted ? "text-destructive" : "text-muted"}`}>
                      {res?.revertReason || (b.reverted ? b.revert_reason : null) ||
                        (anchored ? "anchored on-chain ✓" : res?.detail || (b.proof_status === "verified" ? "reconciles — tap Verify to anchor" : "not anchored on-chain"))}
                      {res?.delta != null && <span className="text-foreground"> · Δ{res.delta}</span>}
                    </span>
                    {anchored ? (
                      <a href={explorerTx(txSig!)} target="_blank" rel="noreferrer" className="text-success font-mono shrink-0 hover:underline">
                        {txSig!.slice(0, 4)}…{txSig!.slice(-4)} ↗
                      </a>
                    ) : b.proof_root ? (
                      <a href={explorerAddr(b.proof_root)} target="_blank" rel="noreferrer" className="text-muted font-mono shrink-0 hover:underline">
                        root {b.proof_root.slice(0, 4)}…{b.proof_root.slice(-4)} ↗
                      </a>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
