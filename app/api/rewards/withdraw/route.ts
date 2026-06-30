// Queue a reward withdrawal: moves the player's whole rewards_usdc balance into
// a pending payout row. The off-chain payout script (scripts/payout.mjs) pays
// pending rows from the treasury and marks them paid. Requires a linked wallet.
import { supaReady, supaRpc } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { device_id?: string };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!b.device_id) return Response.json({ ok: false, error: "missing device_id" }, { status: 400 });
  if (!supaReady()) return Response.json({ ok: false, error: "backend not configured" }, { status: 503 });

  const queued = await supaRpc<number>("spk_request_withdraw", { p_device: b.device_id });
  if (!queued || Number(queued) <= 0) {
    return Response.json({ ok: false, error: "nothing to withdraw (no rewards owed, or no wallet linked)" }, { status: 400 });
  }
  return Response.json({ ok: true, queued: Number(queued) });
}
