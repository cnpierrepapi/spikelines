"use client";

// The public proof ledger: every settled bet from every player. A bet that
// reconciles to TxLINE's on-chain scores Merkle root shows a live "Verify" button;
// clicking it LANDS a real validate_stat transaction on Solana and returns the tx
// hash — an immutable, explorer-linkable receipt that the exact stat is anchored.
// A bet whose root isn't posted / doesn't reconcile can't be proven, so its button
// is greyed out. Nothing here is taken on trust.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

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
  recheckable?: boolean; // proof not final + not terminal → worth an auto re-check
};
type Fixture = { fixture_id: number; match: string };
// Gate 3 — our own deployed program's on-chain record of the corrected match result.
type TruthRecord = {
  recordPda: string;
  commitTx: string | null;
  truth: { p1: number; p2: number };
  anchored: { p1: number; p2: number };
  diverges: boolean;
  varApplied: boolean;
  slot: number;
};
type Independent = { ok: boolean; absent?: boolean; detail?: string; baseOk?: boolean; settleOk?: boolean };
type Result = { txSig?: string | null; status?: string; detail?: string; delta?: number | null; reverted?: boolean; clawed?: number; revertReason?: string | null; independent?: Independent | null; cluster?: string };

const MARKET_ICON: Record<Bet["market"], string> = { goal: "⚽", corner: "🚩", yellow: "🟨", red: "🟥" };
// Proofs land on Solana MAINNET (the production oracle where real WC roots
// reconcile), so explorer links target mainnet-beta (the default cluster).
const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}`;
const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}`;
// Gate 3's program lives on devnet, so its receipts need the cluster query param.
const clusterQ = (cluster: string) => (cluster === "mainnet-beta" || cluster === "mainnet" ? "" : `?cluster=${cluster}`);
const explorerAddrOn = (a: string, cluster: string) => `${explorerAddr(a)}${clusterQ(cluster)}`;
const explorerTxOn = (s: string, cluster: string) => `${explorerTx(s)}${clusterQ(cluster)}`;

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
  const [oracle, setOracle] = useState<Record<number, TruthRecord | null>>({});
  const [oracleCluster, setOracleCluster] = useState("devnet");
  const [watching, setWatching] = useState(false);
  const betsRef = useRef<Bet[]>([]);
  const sweepingRef = useRef(false);

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

  // Keep a ref of the current bets so the interval sweep sees fresh data without
  // being re-created on every state change.
  useEffect(() => {
    betsRef.current = bets;
  }, [bets]);

  // GATE 3 — read our own program's on-chain corrected-result record for every
  // fixture on the board (batched, deduped). Read-only devnet lookup; nothing is
  // signed or deployed. Fixtures we haven't fetched yet get looked up once.
  useEffect(() => {
    const need = [...new Set(bets.map((b) => b.fixture_id))].filter((fid) => !(fid in oracle));
    if (!need.length) return;
    let cancelled = false;
    (async () => {
      try {
        const j = await fetch(`/api/proof/oracle?fids=${need.join(",")}`).then((r) => r.json());
        if (cancelled || !j.ok) return;
        if (j.cluster) setOracleCluster(j.cluster);
        setOracle((prev) => ({ ...prev, ...(j.records ?? {}) }));
      } catch {
        // best-effort: leave Gate 3 unshown for these fixtures
        if (!cancelled) setOracle((prev) => ({ ...prev, ...Object.fromEntries(need.map((f) => [f, null])) }));
      }
    })();
    return () => { cancelled = true; };
  }, [bets, oracle]);

  // AUTOMATIC availability watcher. A bet settles greyed because TxLINE hasn't
  // posted its on-chain root yet; the root shows up minutes later. Rather than make
  // a human tap every greyed button, we periodically re-run the read-only check
  // (no tx, no SOL) for the still-open bets and un-grey the ones whose root has
  // since become available. Terminal bets (won't reconcile) report recheckable=false
  // and are skipped, so we don't poll them forever.
  const autoSweep = useCallback(async () => {
    if (sweepingRef.current) return;
    const targets = betsRef.current.filter((b) => b.recheckable && !b.proof_tx && b.proof_status !== "verified");
    if (targets.length === 0) return;
    sweepingRef.current = true;
    setWatching(true);
    try {
      const CONC = 3;
      for (let i = 0; i < targets.length; i += CONC) {
        const chunk = targets.slice(i, i + CONC);
        await Promise.all(
          chunk.map(async (b) => {
            try {
              const j = await fetch("/api/proof/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.id }) }).then((r) => r.json());
              if (!j.ok) return;
              // Still re-checkable only while the root remains unposted; a verified,
              // failed, or "doesn't reconcile" verdict is terminal → stop sweeping it.
              const stillOpen = j.status === "pending" || (j.status === "unprovable" && /not posted yet/i.test(j.detail || ""));
              setBets((bs) =>
                bs.map((x) =>
                  x.id === b.id
                    ? {
                        ...x,
                        proof_status: j.status,
                        proof_root: j.root ?? x.proof_root,
                        recheckable: stillOpen,
                        ...(j.clawed > 0 ? { outcome: "lost" as const, reward: 0, reverted: true, revert_reason: j.revertReason ?? x.revert_reason } : {}),
                      }
                    : x,
                ),
              );
            } catch {}
          }),
        );
      }
    } finally {
      sweepingRef.current = false;
      setWatching(false);
    }
  }, []);

  // Sweep shortly after load, then every 60s while the page is open. Each check is a
  // free .view(); anchoring (the paid .rpc tx) still only happens on an explicit tap.
  useEffect(() => {
    const first = setTimeout(autoSweep, 1500);
    const iv = setInterval(autoSweep, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [autoSweep]);

  // Anchor on-chain: land the real validate_stat tx and capture the signature.
  const anchor = async (id: number) => {
    setBusy(id);
    try {
      const j = await fetch("/api/proof/anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((r) => r.json());
      if (j.ok) {
        setResults((r) => ({ ...r, [id]: { txSig: j.settleSig, status: "verified", delta: j.delta, reverted: j.reverted, clawed: j.clawed, revertReason: j.revertReason, independent: j.independent ?? null, cluster: j.cluster } }));
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
        setResults((r) => ({ ...r, [id]: { status: j.status, detail: j.detail, delta: j.delta, independent: j.independent ?? null } }));
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
          scores — anchored on <span className="text-foreground">Solana mainnet</span> as a Merkle root — we{" "}
          <span className="text-foreground font-semibold">automatically land a real{" "}
          <span className="font-mono text-primary">validate_stat</span> transaction</span> on-chain and
          show its hash — an immutable receipt you can open in any Solana explorer. Proofs appear{" "}
          <span className="text-foreground">within minutes</span> of each window closing (once TxLINE posts
          the root). Greyed = root not posted yet. No trust required — you can also tap{" "}
          <span className="text-foreground font-semibold">Verify</span> to re-check any call yourself.
        </p>
        <p className="text-xs text-muted leading-relaxed mb-1">
          Three checks, not one.{" "}
          <span className="text-foreground font-semibold">Gate&nbsp;1</span> — we rebuild TxLINE&apos;s Merkle
          proof ourselves (<span className="font-mono">sha256</span>, no Anchor program, no wallet) and confirm the
          stat value matches their published sub-tree root; it catches a tampered value that{" "}
          <span className="font-mono text-primary">validate_stat</span> alone would take on trust.{" "}
          <span className="text-foreground font-semibold">Gate&nbsp;2</span> — <span className="font-mono text-primary">validate_stat</span>{" "}
          anchors that sub-tree to TxLINE&apos;s on-chain daily root (their mainnet program).{" "}
          <span className="text-foreground font-semibold">Gate&nbsp;3</span> — <span className="text-foreground">our own
          deployed Solana program</span> holds an immutable, timestamped record of the VAR-aware corrected match
          result, linked back to TxLINE&apos;s root. Every gate links to its own explorer receipt — trust none of us.
        </p>
        <p className="text-xs text-muted mb-5">
          {loading ? "loading…" : `${bets.length} calls shown · ${anchoredCount} anchored on-chain`}
          {watching && <span className="text-primary"> · ⛓ checking the chain for new proofs…</span>}
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
            // Gate 2 lands on mainnet in prod; the route tells us which cluster it used.
            const gate2Cluster = res?.cluster || "mainnet-beta";
            // Gate 3 = our own program's on-chain corrected-result record (devnet).
            const o = oracle[b.fixture_id];
            const oLoaded = b.fixture_id in oracle;
            // Show the full 3-gate panel once the row has any on-chain artifact or the
            // user has tapped Verify (res set) — so one tap surfaces all three gates.
            const showGates = !!(res || b.proof_tx || b.proof_root || b.reverted || o);
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
                      <a href={explorerTxOn(txSig!, gate2Cluster)} target="_blank" rel="noreferrer" className="text-xs font-bold rounded-lg border border-success/40 text-success px-2.5 py-1 hover:bg-success/10">
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
                {showGates && (
                  <div className="mt-2 pt-2 border-t border-white/5 space-y-1.5">
                    {/* dispute / claw-back note */}
                    {(res?.revertReason || (b.reverted && b.revert_reason)) && (
                      <div className="text-[11px] text-destructive truncate">⚑ {res?.revertReason || b.revert_reason}</div>
                    )}

                    {/* GATE 1 — our own sha256 recompute, offline, no program. A 0-value
                        leg is an absence proof (not recomputable) → attested, not ✗. */}
                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                      <span className="truncate">
                        <span className={`font-bold ${!res?.independent ? "text-muted" : res.independent.ok ? "text-success" : "text-destructive"}`}>
                          {!res?.independent ? "•" : res.independent.ok ? "✓" : "✗"} Gate&nbsp;1
                        </span>
                        <span className="text-foreground"> independent recompute</span>
                        <span className="text-muted"> · our own sha256 Merkle, no program</span>
                      </span>
                      <span className="text-muted shrink-0">
                        {!res?.independent ? "tap Verify" : res.independent.ok ? (res.independent.absent ? "0-value leg attested ✓" : "reproduced ✓") : "mismatch"}
                      </span>
                    </div>

                    {/* GATE 2 — TxLINE validate_stat, landed on mainnet */}
                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                      <span className="truncate">
                        <span className={`font-bold ${anchored ? "text-success" : "text-muted"}`}>{anchored ? "✓" : "•"} Gate&nbsp;2</span>
                        <span className="font-mono text-primary"> validate_stat</span>
                        <span className="text-muted"> · TxLINE mainnet oracle{res?.delta != null ? ` · Δ${res.delta}` : ""}</span>
                      </span>
                      {anchored ? (
                        <a href={explorerTxOn(txSig!, gate2Cluster)} target="_blank" rel="noreferrer" className="text-success shrink-0 hover:underline">
                          ⛓ tx {txSig!.slice(0, 4)}…{txSig!.slice(-4)} ↗
                        </a>
                      ) : b.proof_status === "verified" ? (
                        <span className="text-primary shrink-0">reconciles ▶ tap Verify</span>
                      ) : b.proof_root ? (
                        <a href={explorerAddrOn(b.proof_root, gate2Cluster)} target="_blank" rel="noreferrer" className="text-muted shrink-0 hover:underline">
                          root {b.proof_root.slice(0, 4)}…{b.proof_root.slice(-4)} ↗
                        </a>
                      ) : (
                        <span className="text-muted shrink-0">root not posted yet</span>
                      )}
                    </div>

                    {/* GATE 3 — OUR own deployed program's corrected-result record, on devnet */}
                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                      {o ? (
                        <>
                          <span className="truncate">
                            <span className={`font-bold ${o.diverges ? "text-destructive" : "text-success"}`}>{o.diverges ? "⚠" : "✓"} Gate&nbsp;3</span>
                            <span className="text-foreground"> our program</span>
                            <span className="text-muted"> · {o.diverges ? `caught VAR discrepancy (${o.truth.p1}–${o.truth.p2} vs anchored ${o.anchored.p1}–${o.anchored.p2})` : `corrected result ${o.truth.p1}–${o.truth.p2}`} · devnet</span>
                          </span>
                          <a
                            href={o.commitTx ? explorerTxOn(o.commitTx, oracleCluster) : explorerAddrOn(o.recordPda, oracleCluster)}
                            target="_blank"
                            rel="noreferrer"
                            className={`shrink-0 hover:underline ${o.diverges ? "text-destructive" : "text-success"}`}
                            title="Our own deployed Solana program's immutable record of the corrected result"
                          >
                            ⛓ {o.commitTx ? `tx ${o.commitTx.slice(0, 4)}…${o.commitTx.slice(-4)}` : `rec ${o.recordPda.slice(0, 4)}…${o.recordPda.slice(-4)}`} ↗
                          </a>
                        </>
                      ) : (
                        <>
                          <span className="truncate">
                            <span className="font-bold text-muted">• Gate&nbsp;3</span>
                            <span className="text-foreground"> our program</span>
                            <span className="text-muted"> · {oLoaded ? "no record committed for this fixture" : "checking devnet…"} · devnet</span>
                          </span>
                          <span className="text-muted shrink-0">—</span>
                        </>
                      )}
                    </div>
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
