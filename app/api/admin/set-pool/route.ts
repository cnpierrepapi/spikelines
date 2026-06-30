// Admin sets (or updates) the USDC reward pool for a given calendar day. Set in
// advance for the next day; revealed to players on that day via the leaderboard.
// Refuses to change a day that's already been distributed.
import { supaReady, supaUpsert, supaGet } from "@/lib/supa";
import { verifyToken, bearer } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!verifyToken(bearer(req))) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let b: { day?: string; pool_usdc?: number };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (!b.day || b.pool_usdc == null || !(b.pool_usdc >= 0)) {
    return Response.json({ ok: false, error: "need day + non-negative pool_usdc" }, { status: 400 });
  }
  if (!supaReady()) return Response.json({ ok: false, error: "backend not configured" }, { status: 503 });

  const cur = (await supaGet<{ status: string }[]>(`spk_rewards?day=eq.${b.day}&select=status`))[0];
  if (cur?.status === "distributed") return Response.json({ ok: false, error: "day already distributed" }, { status: 409 });

  const rows = await supaUpsert<{ day: string; pool_usdc: string; status: string }[]>(
    "spk_rewards", { day: b.day, pool_usdc: b.pool_usdc, status: "set" }, { onConflict: "day" }
  );
  return Response.json({ ok: true, reward: Array.isArray(rows) ? rows[0] : rows });
}
