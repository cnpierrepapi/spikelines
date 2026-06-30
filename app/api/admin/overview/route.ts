// Admin dashboard data for a day: the saved reward pool (if any) + a DRY-RUN
// preview of the split (top-10% share + personal-best improvement share) per
// player, with usernames. Pass ?pool= to preview a tentative pool before saving.
import { supaReady, supaRpc, supaGet } from "@/lib/supa";
import { verifyToken, bearer } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const todayUTC = () => new Date().toISOString().slice(0, 10);

type Row = { device_id: string; today: number; improve: number; top_usdc: string; pb_usdc: string; total_usdc: string };

export async function GET(req: Request) {
  if (!verifyToken(bearer(req))) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supaReady()) return Response.json({ ok: false, error: "backend not configured" }, { status: 503 });

  const url = new URL(req.url);
  const day = url.searchParams.get("day") || todayUTC();
  const saved = (await supaGet<{ day: string; pool_usdc: string; status: string }[]>(
    `spk_rewards?day=eq.${day}&select=day,pool_usdc,status`
  ))[0] ?? null;

  const poolParam = url.searchParams.get("pool");
  const pool = poolParam != null && poolParam !== "" ? Number(poolParam) : saved ? Number(saved.pool_usdc) : 0;

  const rows = await supaRpc<Row[]>("spk_compute_day", { p_day: day, p_pool: pool, p_commit: false });
  const players = await supaGet<{ device_id: string; username: string | null }[]>("spk_players?select=device_id,username");
  const nameById = new Map(players.map((p) => [p.device_id, p.username]));
  const preview = (rows ?? []).map((r) => ({
    device_id: r.device_id,
    username: nameById.get(r.device_id) || r.device_id.slice(0, 8),
    today: r.today,
    improve: r.improve,
    top_usdc: Number(r.top_usdc),
    pb_usdc: Number(r.pb_usdc),
    total_usdc: Number(r.total_usdc),
  }));

  return Response.json({ ok: true, day, pool, saved, players: preview.length, preview });
}
