// Re-verify a single ledger bet on demand (the /proof "Verify ▶" button). Re-runs
// the validate_stat view live against TxLINE's on-chain root and returns the fresh
// verdict + the on-chain root account (so the UI can link it to the explorer).
// Also refreshes the stored proof_status so a once-'pending'/'unprovable' bet can
// settle to 'verified' once the root is posted.
import { verifyBet } from "@/lib/proof";
import { supaGet, supaPatch, supaReady } from "@/lib/supa";

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

  let rows: { fixture_id: number; stat_key: number; base_ts: number | null; settle_ts: number | null }[];
  try {
    rows = await supaGet(`spk_bets?id=eq.${id}&select=fixture_id,stat_key,base_ts,settle_ts`);
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 502 });
  }
  const bet = rows[0];
  if (!bet) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  if (bet.base_ts == null || bet.settle_ts == null) return Response.json({ ok: false, error: "no window timestamps" }, { status: 422 });

  const r = await verifyBet({ fid: bet.fixture_id, statKey: bet.stat_key, baseTs: bet.base_ts, settleTs: bet.settle_ts });
  // Persist the refreshed verdict (best-effort).
  try {
    await supaPatch(`spk_bets?id=eq.${id}`, {
      proof_status: r.status,
      proof_root: r.root,
      proof_json: { detail: r.detail, valueBase: r.valueBase, valueSettle: r.valueSettle, delta: r.delta, recomputedYes: r.recomputedYes, bundles: r.bundles },
      verified_at: r.status === "verified" ? new Date().toISOString() : null,
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
  });
}
