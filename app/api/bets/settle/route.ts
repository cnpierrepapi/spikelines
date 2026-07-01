// Persist a settled bet to the public proof ledger and verify it inline against
// TxLINE's on-chain scores root via validate_stat. Called (best-effort, non-
// blocking) by the live + archived rooms the moment a bet resolves.
//
// nodejs runtime: the verifier uses @coral-xyz/anchor + @solana/web3.js.
import { statKeyFor, type MarketKind } from "@/lib/markets";
import { verifyBet, isRetryable } from "@/lib/proof";
import { supaUpsert, supaReady } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Body = {
  device_id: string;
  username?: string;
  client_bet_id: string | number;
  fixture_id: number;
  match: string;
  mode?: "live" | "archived";
  market: MarketKind;
  side: 1 | 2;
  mins: number;
  choice: "YES" | "NO";
  outcome: "won" | "lost";
  reward?: number;
  base_ts?: number;
  settle_ts?: number;
};

export async function POST(request: Request) {
  if (!supaReady()) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
  let b: Body;
  try {
    b = await request.json();
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  if (!b.device_id || b.client_bet_id == null || !b.fixture_id || !b.market || (b.side !== 1 && b.side !== 2)) {
    return Response.json({ ok: false, error: "missing fields" }, { status: 400 });
  }

  const statKey = statKeyFor(b.market, b.side);

  // Verify inline. Never let a verification hiccup block the ledger write — on any
  // failure the row still lands as 'pending' and can be re-verified later.
  let proof = { status: "pending" as string, root: null as string | null, json: null as unknown, detail: "" };
  if (typeof b.base_ts === "number" && typeof b.settle_ts === "number") {
    try {
      const r = await verifyBet({ fid: b.fixture_id, statKey, baseTs: b.base_ts, settleTs: b.settle_ts });
      proof = { status: r.status, root: r.root, json: { detail: r.detail, valueBase: r.valueBase, valueSettle: r.valueSettle, delta: r.delta, recomputedYes: r.recomputedYes, bundles: r.bundles }, detail: r.detail };
    } catch (e) {
      proof = { status: "pending", root: null, json: { detail: String((e as Error)?.message ?? e) }, detail: "" };
    }
  }
  // At settle the root usually isn't posted yet → 'pending'/'unprovable' and the
  // background sweep should poll it. Only a terminal verdict skips the sweep.
  const nextCheck = proof.status === "verified" || !isRetryable(proof.status as never, proof.detail)
    ? "infinity"
    : new Date().toISOString();

  const row = {
    device_id: b.device_id,
    client_bet_id: String(b.client_bet_id),
    username: b.username || null,
    fixture_id: b.fixture_id,
    match: b.match,
    mode: b.mode === "archived" ? "archived" : "live",
    market: b.market,
    side: b.side,
    stat_key: statKey,
    mins: b.mins,
    choice: b.choice,
    outcome: b.outcome,
    reward: b.reward ?? 0,
    base_ts: b.base_ts ?? null,
    settle_ts: b.settle_ts ?? null,
    proof_status: proof.status,
    proof_root: proof.root,
    proof_json: proof.json,
    verified_at: proof.status === "verified" ? new Date().toISOString() : null,
    next_check_at: nextCheck,
  };

  try {
    await supaUpsert("spk_bets", row, { onConflict: "device_id,client_bet_id", returning: false });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 502 });
  }
  return Response.json({ ok: true, proof_status: proof.status, proof_root: proof.root });
}
