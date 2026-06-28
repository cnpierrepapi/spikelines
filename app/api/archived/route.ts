// Lists recently-FINISHED World Cup matches (full time) so they appear in the
// lobby's Archived section automatically — even ones we never pre-recorded. Each
// is playable via /api/replay/{fid}. Bounded to the last few hours so the
// /updates feed still has data (older matches get gated on the free tier).
import { iso } from "@/lib/iso";
import { matchStates } from "@/lib/live-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARCHIVE_WINDOW_MS = 8 * 60 * 60 * 1000;

export async function GET() {
  const base = process.env.TXLINE_API_BASE;
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  if (!base || !jwt || !apiToken) return Response.json({ configured: false, matches: [] });
  try {
    const res = await fetch(`${base}/api/fixtures/snapshot`, { headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken }, cache: "no-store" });
    if (!res.ok) return Response.json({ configured: true, matches: [], error: res.status });
    const j: any = await res.json();
    const arr: any[] = Array.isArray(j) ? j : j.fixtures || j.data || [];
    const now = Date.now();
    const started = arr.filter((f) => f.CompetitionId === 72 && f.StartTime <= now && f.StartTime >= now - ARCHIVE_WINDOW_MS);
    const states = await matchStates(base, jwt, apiToken, started.map((f) => f.FixtureId));

    const matches = started
      .filter((f) => states.get(f.FixtureId)?.finished)
      .map((f) => {
        const s = states.get(f.FixtureId)!;
        return { fid: f.FixtureId, p1: f.Participant1, p2: f.Participant2, iso1: iso(f.Participant1), iso2: iso(f.Participant2), goals: s.g1 + s.g2, minutes: s.minutes, source: "live-finished" };
      })
      .sort((a, b) => b.goals - a.goals);
    return Response.json({ configured: true, matches });
  } catch (e) {
    return Response.json({ configured: true, matches: [], error: String(e) });
  }
}
