// Admin distributes a day's reward pool: computes the split and CREDITS each
// player's rewards_usdc (which they can then withdraw). Uses the SAVED pool, is
// atomic, and idempotent — spk_compute_day refuses an already-distributed day.
import { supaReady, supaRpc, supaGet } from "@/lib/supa";
import { verifyToken, bearer } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!verifyToken(bearer(req))) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let b: { day?: string };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!b.day) return Response.json({ ok: false, error: "missing day" }, { status: 400 });
  if (!supaReady()) return Response.json({ ok: false, error: "backend not configured" }, { status: 503 });

  const r = (await supaGet<{ pool_usdc: string; status: string }[]>(
    `spk_rewards?day=eq.${b.day}&select=pool_usdc,status`
  ))[0];
  if (!r) return Response.json({ ok: false, error: "no pool set for that day" }, { status: 400 });
  if (r.status === "distributed") return Response.json({ ok: false, error: "already distributed" }, { status: 409 });

  try {
    const rows = await supaRpc<{ device_id: string; total_usdc: string }[]>(
      "spk_compute_day", { p_day: b.day, p_pool: Number(r.pool_usdc), p_commit: true }
    );
    const total = (rows ?? []).reduce((s, x) => s + Number(x.total_usdc), 0);
    return Response.json({ ok: true, credited: rows?.length ?? 0, total_usdc: total });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "distribute failed" }, { status: 500 });
  }
}
