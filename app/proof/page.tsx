"use client";

// The public proof ledger: every settled bet from every player, each checked
// against TxLINE's on-chain scores Merkle root via the txoracle validate_stat
// view. Anyone can re-run the check (Verify ▶) and follow the on-chain root to a
// Solana explorer — nothing here is taken on trust.
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
  created_at: string;
};
type Fixture = { fixture_id: number; match: string };

const MARKET_ICON: Record<Bet["market"], string> = { goal: "⚽", corner: "🚩", yellow: "🟨", red: "🟥" };
const explorer = (addr: string) => `https://explorer.solana.com/address/${addr}?cluster=devnet`;

function teamOf(match: string, side: 1 | 2): string {
  const parts = match.split("–");
  return (side === 2 ? parts[1] : parts[0])?.trim() || (side === 2 ? "Away" : "Home");
}

function Badge({ status }: { status: Bet["proof_status"] }) {
  const map: Record<Bet["proof_status"], { t: string; c: string }> = {
    verified: { t: "⛓ verified", c: "text-success border-success/40 bg-success/10" },
    unprovable: { t: "root pending", c: "text-primary border-primary/40 bg-primary/10" },
    failed: { t: "failed", c: "text-destructive border-destructive/40 bg-destructive/10" },
    pending: { t: "pending", c: "text-muted border-white/15 bg-white/5" },
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
  const [verifying, setVerifying] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, { status: string; root: string | null; detail: string; delta: number | null }>>({});

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

  const verify = async (id: number) => {
    setVerifying(id);
    try {
      const j = await fetch("/api/proof/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((r) => r.json());
      if (j.ok) {
        setResults((r) => ({ ...r, [id]: { status: j.status, root: j.root, detail: j.detail, delta: j.delta } }));
        setBets((bs) => bs.map((b) => (b.id === id ? { ...b, proof_status: j.status, proof_root: j.root } : b)));
      }
    } catch {}
    setVerifying(null);
  };

  const verifiedCount = bets.filter((b) => b.proof_status === "verified").length;

  return (
    <div className="min-h-screen">
      <main className="app-container py-8 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <Link href="/play" className="text-muted hover:text-foreground text-sm">← play</Link>
          <Link href="/leaderboard" className="text-muted hover:text-foreground text-sm">leaderboard →</Link>
        </div>

        <h1 className="text-3xl font-black mb-1">Proof ledger</h1>
        <p className="text-muted text-sm leading-relaxed mb-1">
          Every settled call, from every player. Each result is checked against TxLINE&apos;s World Cup
          scores — anchored on <span className="text-foreground">Solana</span> as a Merkle root — using the
          on-chain <span className="font-mono text-primary">validate_stat</span> view. Hit{" "}
          <span className="text-foreground font-semibold">Verify</span> to re-run the check yourself and
          open the on-chain root in an explorer. No trust required.
        </p>
        <p className="text-xs text-muted mb-5">
          {loading ? "loading…" : `${bets.length} calls shown · ${verifiedCount} on-chain verified`}
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
                    </div>
                    <div className="text-[11px] text-muted mt-0.5 truncate">
                      {b.match} · {b.mins}m window · {b.username || "anon"} · {b.mode}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge status={b.proof_status} />
                    <button
                      onClick={() => verify(b.id)}
                      disabled={verifying === b.id}
                      className="text-xs font-bold rounded-lg border border-primary/40 text-primary px-2.5 py-1 hover:bg-primary/10 disabled:opacity-50"
                    >
                      {verifying === b.id ? "…" : "Verify ▶"}
                    </button>
                  </div>
                </div>
                {(res || b.proof_root) && (
                  <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-muted truncate">
                      {res ? res.detail : "on-chain root"}
                      {res?.delta != null && <span className="text-foreground"> · Δ{res.delta}</span>}
                    </span>
                    {(res?.root || b.proof_root) && (
                      <a href={explorer((res?.root || b.proof_root)!)} target="_blank" rel="noreferrer" className="text-primary font-mono shrink-0 hover:underline">
                        {(res?.root || b.proof_root)!.slice(0, 4)}…{(res?.root || b.proof_root)!.slice(-4)} ↗
                      </a>
                    )}
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
