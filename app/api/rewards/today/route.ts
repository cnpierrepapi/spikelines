// Public: today's revealed reward pool, for display on the leaderboard. Returns
// null pool if the admin hasn't set one for today yet.
import { supaReady, supaGet } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!supaReady()) return Response.json({ ok: false });
  const day = new Date().toISOString().slice(0, 10);
  const r = (await supaGet<{ pool_usdc: string; status: string }[]>(
    `spk_rewards?day=eq.${day}&select=pool_usdc,status`
  ))[0];
  return Response.json({ ok: true, day, pool: r ? Number(r.pool_usdc) : null, status: r?.status ?? null });
}
