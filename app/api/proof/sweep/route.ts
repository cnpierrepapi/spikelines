// Availability sweep for the /proof ledger. A settled bet is greyed until TxLINE
// builds its Merkle proof and posts the interval root on-chain — which happens a
// few minutes AFTER the window closes, with nobody watching. This route polls the
// re-checkable bets, re-runs the read-only validate_stat view, and flips the ones
// whose root has since become available to 'verified' (un-greying their button).
//
// It is the automatic counterpart to the /proof "Verify" button: no tx is landed
// here (that stays a user action), only .view() preflights + the proof_status flip.
// Backoff lives in the DB (next_check_at / check_attempts) so we don't hammer the
// 404-ing endpoint and don't re-poll devnet fixtures that will never reconcile.
//
// Drive it on an interval (a /loop that curls this route, or any external cron).
import { verifyBet, canonicalOutcome, isRetryable, anchorBet, canAnchor } from "@/lib/proof";
import { supaGet, supaPatch, supaRpc, supaReady } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How many bets to re-check per sweep, and how many .view() checks to run at once.
// verifyBet does 2 REST calls + 2 mainnet simulations, so keep both modest to stay
// inside maxDuration.
const BATCH = 12;
const CONCURRENCY = 3;
// AUTO-ANCHOR: when a bet verifies, land its real validate_stat tx automatically so
// /proof shows the on-chain receipt without a user click. Bounded per run (each
// anchor lands 2 txs and confirms, ~seconds) and capped at PROOF_SPEND_CAP_SOL.
const ANCHOR_PER_RUN = 3;
const CAP_LAMPORTS = Math.round(Number(process.env.PROOF_SPEND_CAP_SOL || "1.4") * 1e9);
const PER_BET_LAMPORTS = 10_000; // two validate_stat txs (~5000 each)
type AnchorBudget = { left: number; canSpend: () => boolean; spend: () => void };
// Exponential backoff (minutes) between re-checks, and the attempt count past which
// we give up and stop polling (roots that haven't posted in ~hours never will).
const GIVE_UP_AFTER = 12;
function nextDelayMs(attempts: number): number {
  return Math.min(2 ** attempts, 30) * 60_000; // 1,2,4,8,16,30,30… minutes, capped
}
const FOREVER = "infinity"; // timestamptz sentinel: terminal, never poll again

type Row = {
  id: number;
  device_id: string;
  fixture_id: number;
  stat_key: number;
  base_ts: number | null;
  settle_ts: number | null;
  choice: "YES" | "NO";
  outcome: "won" | "lost";
  reward: number;
  reverted: boolean;
  check_attempts: number;
  proof_tx: string | null;
};

async function sweepOne(bet: Row, budget: AnchorBudget) {
  // Missing window timestamps can never be proven → mark terminal so we drop it.
  if (bet.base_ts == null || bet.settle_ts == null) {
    await supaPatch(`spk_bets?id=eq.${bet.id}`, { next_check_at: FOREVER }).catch(() => {});
    return { id: bet.id, status: "unprovable", flipped: false };
  }

  const r = await verifyBet({ fid: bet.fixture_id, statKey: bet.stat_key, baseTs: bet.base_ts, settleTs: bet.settle_ts });
  const attempts = bet.check_attempts + 1;

  // Reschedule: verified/terminal → never again; retryable → back off; give up after N.
  const retry = isRetryable(r.status, r.detail);
  const nextCheck = r.status === "verified" || !retry || attempts >= GIVE_UP_AFTER
    ? FOREVER
    : new Date(Date.now() + nextDelayMs(attempts)).toISOString();

  // Same dispute resolution the manual Verify does: a proof that reconciles and
  // proves a recorded WIN should have lost → claw the unearned SPIKES back (gated,
  // double-deduct-safe). Never touched for unprovable/failed.
  let clawed = 0;
  let revertReason: string | null = null;
  let reverted = bet.reverted;
  if (r.status === "verified" && r.recomputedYes != null && !bet.reverted && bet.outcome === "won" && bet.reward > 0) {
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

  // AUTO-ANCHOR: on verify, land the real tx automatically (no user click) so
  // /proof shows the on-chain receipt. Bounded per run + capped at 1.4 SOL; if the
  // budget is spent it stays verified-by-view and a later sweep lands the tx.
  let proofTx = bet.proof_tx;
  if (r.status === "verified" && !proofTx && canAnchor() && budget.left > 0 && budget.canSpend()) {
    try {
      const a = await anchorBet({ fid: bet.fixture_id, statKey: bet.stat_key, baseTs: bet.base_ts, settleTs: bet.settle_ts });
      if (a.ok && a.settleSig) { proofTx = a.settleSig; budget.spend(); }
    } catch { /* a later sweep retries the anchor */ }
  }

  await supaPatch(`spk_bets?id=eq.${bet.id}`, {
    proof_status: r.status,
    proof_root: r.root,
    proof_json: { detail: r.detail, valueBase: r.valueBase, valueSettle: r.valueSettle, delta: r.delta, recomputedYes: r.recomputedYes, bundles: r.bundles },
    verified_at: r.status === "verified" ? new Date().toISOString() : null,
    check_attempts: attempts,
    next_check_at: nextCheck,
    ...(proofTx && proofTx !== bet.proof_tx ? { proof_tx: proofTx } : {}),
    ...(clawed > 0 ? { outcome: "lost", reward: 0, reverted: true, revert_reason: revertReason } : {}),
  }).catch(() => {});

  return { id: bet.id, status: r.status, flipped: r.status === "verified", anchored: !!proofTx && proofTx !== bet.proof_tx, clawed, reverted };
}

async function runSweep() {
  const nowIso = new Date().toISOString();
  const cols = "id,device_id,fixture_id,stat_key,base_ts,settle_ts,choice,outcome,reward,reverted,check_attempts,proof_tx";
  const q = [
    `select=${cols}`,
    "proof_status=in.(pending,unprovable)",
    `next_check_at=lte.${nowIso}`,
    "order=next_check_at.asc",
    `limit=${BATCH}`,
  ].join("&");
  const due = await supaGet<Row[]>(`spk_bets?${q}`);

  // Spend so far = already-anchored bets × per-bet cost; gate auto-anchoring on the cap.
  const anchored = await supaGet<{ id: number }[]>(`spk_bets?select=id&proof_tx=not.is.null`);
  let spent = anchored.length * PER_BET_LAMPORTS;
  const budget: AnchorBudget = {
    left: ANCHOR_PER_RUN,
    canSpend: () => spent + PER_BET_LAMPORTS <= CAP_LAMPORTS,
    spend: () => { spent += PER_BET_LAMPORTS; budget.left--; },
  };

  const results: Awaited<ReturnType<typeof sweepOne>>[] = [];
  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const chunk = due.slice(i, i + CONCURRENCY);
    results.push(...(await Promise.all(chunk.map((b) => sweepOne(b, budget)))));
  }
  return {
    ok: true,
    due: due.length,
    checked: results.length,
    flipped: results.filter((r) => r.flipped).length,
    anchored: results.filter((r) => r.anchored).length,
    clawed: results.filter((r) => (r.clawed ?? 0) > 0).length,
    spentSol: spent / 1e9,
    results,
  };
}

export async function POST() {
  if (!supaReady()) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
  try {
    return Response.json(await runSweep());
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 502 });
  }
}

// GET so a plain cron/curl (no body) can drive it too.
export async function GET() {
  return POST();
}
