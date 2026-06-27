// World Cup fixtures from ~now to +3 days (in-play or upcoming), ranked by FIFA
// strength — feeds the desktop "hero" match. Uses the server-held mainnet token.
import { iso } from "@/lib/iso";
import { fifaRank } from "@/lib/fifa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_WINDOW_MS = 2.5 * 60 * 60 * 1000;
const AHEAD_MS = 3 * 24 * 60 * 60 * 1000;

export async function GET() {
  const base = process.env.TXLINE_API_BASE;
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  if (!base || !jwt || !apiToken) return Response.json({ configured: false, fixtures: [] });
  try {
    const res = await fetch(`${base}/api/fixtures/snapshot`, {
      headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
      cache: "no-store",
    });
    if (!res.ok) return Response.json({ configured: true, fixtures: [], error: res.status });
    const j: any = await res.json();
    const arr: any[] = Array.isArray(j) ? j : j.fixtures || j.data || [];
    const now = Date.now();
    const fixtures = arr
      .filter((f) => f.CompetitionId === 72 && f.StartTime >= now - LIVE_WINDOW_MS && f.StartTime <= now + AHEAD_MS)
      .map((f) => ({
        fid: f.FixtureId,
        p1: f.Participant1,
        p2: f.Participant2,
        iso1: iso(f.Participant1),
        iso2: iso(f.Participant2),
        startTime: f.StartTime,
        live: f.StartTime <= now && now <= f.StartTime + LIVE_WINDOW_MS,
        strength: fifaRank(f.Participant1) + fifaRank(f.Participant2), // lower = bigger match
      }))
      .sort((a, b) => Number(b.live) - Number(a.live) || a.strength - b.strength);
    return Response.json({ configured: true, fixtures });
  } catch (e) {
    return Response.json({ configured: true, fixtures: [], error: String(e) });
  }
}
