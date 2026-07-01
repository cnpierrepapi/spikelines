// Anchor a settled bet ON-CHAIN: land a real validate_stat transaction (signed +
// fee-paid by the funded devnet wallet) for the bet's window, and return the tx
// signature — the explorer-linkable proof that the stat reconciles to TxLINE's
// on-chain Merkle root. This is what the /proof "Verify" button now does for a
// verifiable bet. Idempotent: a bet already anchored returns its stored signature
// (never double-spends). If the proof reconciles but contradicts a recorded win,
// the unearned SPIKES are clawed back (dispute resolution).
import { anchorBet, canonicalOutcome, isRetryable } from "@/lib/proof";
import { supaGet, supaPatch, supaRpc, supaReady } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // landing 2 txns + confirmations

const txUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export async function POST(request: Request) {
  if (!supaReady()) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
  let id: number;
  try {
    id = Number((await request.json()).id);
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (!id) return Response.json({ ok: false, error: "missing id" }, { status: 400 });

  type Row = {
    device_id: string; fixture_id: number; stat_key: number;
    base_ts: number | null; settle_ts: number | null;
    choice: "YES" | "NO"; outcome: "won" | "lost"; reward: number;
    reverted: boolean; proof_tx: string | null;
  };
  let rows: Row[];
  try {
    rows = await supaGet(`spk_bets?id=eq.${id}&select=device_id,fixture_id,stat_key,base_ts,settle_ts,choice,outcome,reward,reverted,proof_tx`);
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 502 });
  }
  const bet = rows[0];
  if (!bet) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  if (bet.base_ts == null || bet.settle_ts == null) return Response.json({ ok: false, error: "no window timestamps" }, { status: 422 });

  // Idempotent: don't re-land (and re-spend) if already anchored.
  if (bet.proof_tx) {
    return Response.json({ ok: true, status: "verified", alreadyAnchored: true, settleSig: bet.proof_tx, txUrl: txUrl(bet.proof_tx) });
  }

  const r = await anchorBet({ fid: bet.fixture_id, statKey: bet.stat_key, baseTs: bet.base_ts, settleTs: bet.settle_ts });

  // Not anchorable → report why; persist the refreshed (non-verified) status. A
  // terminal verdict (won't reconcile) stops the sweep from re-polling it.
  if (!r.ok || !r.settleSig) {
    const nextCheck = isRetryable(r.status, r.detail) ? new Date(Date.now() + 120_000).toISOString() : "infinity";
    try {
      await supaPatch(`spk_bets?id=eq.${id}`, { proof_status: r.status, proof_root: r.root, next_check_at: nextCheck });
    } catch {}
    return Response.json({ ok: false, status: r.status, root: r.root, detail: r.detail }, { status: 409 });
  }

  // Landed. Dispute resolution: the on-chain delta is authoritative — if it proves a
  // recorded WIN should have lost, claw the SPIKES back (gated, double-deduct-safe).
  let reverted = bet.reverted;
  let clawed = 0;
  let revertReason: string | null = null;
  if (r.recomputedYes != null && !bet.reverted && bet.outcome === "won" && bet.reward > 0) {
    if (canonicalOutcome(bet.choice, r.recomputedYes) === "lost") {
      revertReason = `on-chain Δ${r.delta} ⇒ ${bet.choice} loses; clawed ${bet.reward} SPIKES`;
      try {
        await supaRpc("spk_revert_bet", { p_device: bet.device_id, p_spikes: bet.reward });
        reverted = true;
        clawed = bet.reward;
      } catch (e) {
        revertReason = `clawback failed: ${String((e as Error)?.message ?? e)}`;
      }
    }
  }

  try {
    await supaPatch(`spk_bets?id=eq.${id}`, {
      proof_status: "verified",
      proof_root: r.root,
      proof_tx: r.settleSig,
      proof_json: { detail: r.detail, valueBase: r.valueBase, valueSettle: r.valueSettle, delta: r.delta, recomputedYes: r.recomputedYes, baseSig: r.baseSig, settleSig: r.settleSig },
      verified_at: new Date().toISOString(),
      ...(clawed > 0 ? { outcome: "lost", reward: 0, reverted: true, revert_reason: revertReason } : {}),
    });
  } catch {}

  return Response.json({
    ok: true,
    status: "verified",
    root: r.root,
    baseSig: r.baseSig,
    settleSig: r.settleSig,
    txUrl: txUrl(r.settleSig),
    delta: r.delta,
    recomputedYes: r.recomputedYes,
    reverted,
    clawed,
    revertReason,
  });
}
