// Upsert a player's leaderboard/profile state (username, score, spikes, wallet).
// Used to claim a username on first /play visit AND to push local progress.
import { supaReady, supaRpc } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { device_id?: string; username?: string; score?: number; spikes?: number; wallet?: string };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const { device_id, username = "", score = 0, spikes = 0, wallet = "" } = b;
  if (!device_id) return Response.json({ ok: false, error: "missing device_id" }, { status: 400 });
  if (!supaReady()) return Response.json({ ok: false, error: "backend not configured" }, { status: 503 });

  try {
    const rows = await supaRpc<{ device_id: string; username: string; score: number; spikes: number }[]>(
      "spk_sync_player",
      { p_device: device_id, p_username: username, p_score: score, p_spikes: spikes, p_wallet: wallet }
    );
    const player = Array.isArray(rows) ? rows[0] : rows;
    return Response.json({ ok: true, player });
  } catch (e) {
    // Unique-violation on the case-insensitive username index → name taken.
    const msg = e instanceof Error ? e.message : String(e);
    if (/spk_players_username_uniq|duplicate key|23505/.test(msg)) {
      return Response.json({ ok: false, error: "username_taken" }, { status: 409 });
    }
    return Response.json({ ok: false, error: "sync_failed" }, { status: 500 });
  }
}
