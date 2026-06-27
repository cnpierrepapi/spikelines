// Lists currently-live World Cup matches from the mainnet TxLINE feed.
// Uses a server-held apiToken (env var) — no keypair / no on-chain subscribe at
// runtime. The fixtures snapshot has no live flag, so "live" = kickoff window
// (started within the last ~2.5h).
import { iso } from "@/lib/iso";
import { finishedFids } from "@/lib/live-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_WINDOW_MS = 2.5 * 60 * 60 * 1000;

export async function GET() {
  const base = process.env.TXLINE_API_BASE;
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  if (!base || !jwt || !apiToken) {
    return Response.json({ configured: false, matches: [] });
  }
  try {
    const res = await fetch(`${base}/api/fixtures/snapshot`, {
      headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
      cache: "no-store",
    });
    if (!res.ok) return Response.json({ configured: true, matches: [], error: res.status });
    const j: any = await res.json();
    const arr: any[] = Array.isArray(j) ? j : j.fixtures || j.data || j.items || [];
    const now = Date.now();
    const candidates = arr.filter((f) => f.CompetitionId === 72 && f.StartTime <= now && now <= f.StartTime + LIVE_WINDOW_MS);

    // Drop matches whose scores feed has finalised — they belong in Archived now.
    const finished = await finishedFids(base, jwt, apiToken, candidates.map((f) => f.FixtureId));
    const matches = candidates
      .filter((f) => !finished.has(f.FixtureId))
      .map((f) => ({
        fid: f.FixtureId,
        p1: f.Participant1,
        p2: f.Participant2,
        iso1: iso(f.Participant1),
        iso2: iso(f.Participant2),
        startTime: f.StartTime,
      }));
    return Response.json({ configured: true, matches });
  } catch (e) {
    return Response.json({ configured: true, matches: [], error: String(e) });
  }
}
