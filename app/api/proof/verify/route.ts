// Re-verify a single ledger bet on demand (the /proof "Verify ▶" button). Re-runs
// the validate_stat view live against TxLINE's on-chain root and returns the fresh
// verdict + the on-chain root account (so the UI can link it to the explorer).
// Also refreshes the stored proof_status so a once-'pending'/'unprovable' bet can
// settle to 'verified' once the root is posted.
import { verifyBet, canonicalOutcome, isRetryable } from "@/lib/proof";
import { supaGet, supaPatch, supaRpc, supaReady } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
    device_id: string;
    fixture_id: number;
    stat_key: number;
    base_ts: number | null;
    settle_ts: number | null;
    choice: "YES" | "NO";
    outcome: "won" | "lost";
    reward: number;
    reverted: boolean;
  };
  let rows: Row[];
  try {
    rows = await supaGet(`spk_bets?id=eq.${id}&select=device_id,fixture_id,stat_key,base_ts,settle_ts,choice,outcome,reward,reverted`);
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 502 });
  }
  const bet = rows[0];
  if (!bet) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  if (bet.base_ts == null || bet.settle_ts == null) return Response.json({ ok: false, error: "no window timestamps" }, { status: 422 });

  const r = await verifyBet({ fid: bet.fixture_id, statKey: bet.stat_key, baseTs: bet.base_ts, settleTs: bet.settle_ts });

  // Dispute resolution: a proof that fully reconciles to the on-chain root is
  // authoritative. If it proves a recorded WIN should have been a loss, the SPIKES
  // it paid were unearned → claw them back from the server-authoritative balance
  // (the copy the daily USDC split reads) and flag the bet. Gated on the bet not
  // already being reverted, so a second Verify tap can't double-deduct.
  let reverted = bet.reverted;
  let clawed = 0;
  let revertReason: string | null = null;
  if (r.status === "verified" && r.recomputedYes != null && !bet.reverted && bet.outcome === "won" && bet.reward > 0) {
    const truth = canonicalOutcome(bet.choice, r.recomputedYes);
    if (truth === "lost") {
      revertReason = `on-chain Δ${r.delta} ⇒ ${bet.choice} loses; clawed ${bet.reward} SPIKES`;
      try {
        await supaRpc("spk_revert_bet", { p_device: bet.device_id, p_spikes: bet.reward });
        reverted = true;
        clawed = bet.reward;
      } catch (e) {
        // Couldn't deduct → leave the bet un-reverted so a later Verify retries.
        revertReason = `clawback failed: ${String((e as Error)?.message ?? e)}`;
      }
    }
  }

  // Persist the refreshed verdict (best-effort). On an overturn we also rewrite the
  // ledger outcome to the proven truth so the public ledger never shows a phantom win.
  // Keep the sweep schedule coherent: a verified/terminal verdict stops future
  // polling ('infinity'); a still-pending root gets a short re-check window (the
  // background sweep owns the real backoff curve via check_attempts).
  const nextCheck = r.status === "verified" || !isRetryable(r.status, r.detail)
    ? "infinity"
    : new Date(Date.now() + 120_000).toISOString();
  try {
    await supaPatch(`spk_bets?id=eq.${id}`, {
      proof_status: r.status,
      proof_root: r.root,
      proof_json: { detail: r.detail, valueBase: r.valueBase, valueSettle: r.valueSettle, delta: r.delta, recomputedYes: r.recomputedYes, bundles: r.bundles },
      verified_at: r.status === "verified" ? new Date().toISOString() : null,
      next_check_at: nextCheck,
      ...(clawed > 0 ? { outcome: "lost", reward: 0, reverted: true, revert_reason: revertReason } : {}),
    });
  } catch {}

  return Response.json({
    ok: true,
    status: r.status,
    root: r.root,
    valueBase: r.valueBase,
    valueSettle: r.valueSettle,
    delta: r.delta,
    recomputedYes: r.recomputedYes,
    detail: r.detail,
    reverted,
    clawed,
    revertReason,
  });
}
