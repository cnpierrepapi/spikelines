// Real cross-player leaderboard — top N by score from the isolated spk_players.
import { supaReady, supaGet } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!supaReady()) return Response.json({ ok: false, players: [] });
  const rows = await supaGet<{ username: string; score: number; wallet: string | null }[]>(
    "spk_players?username=not.is.null&order=score.desc&limit=50&select=username,score,wallet"
  );
  return Response.json({ ok: true, players: rows.map((r) => ({ username: r.username, score: r.score })) });
}
