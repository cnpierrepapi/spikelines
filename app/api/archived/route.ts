// Lists recently-FINISHED World Cup matches (full time) so they appear in the
// lobby's Archived section automatically — even ones we never pre-recorded. Each
// is playable via /api/replay/{fid}. Bounded to the last few hours so the
// /updates feed still has data (older matches get gated on the free tier).
import { iso } from "@/lib/iso";
import { matchStates } from "@/lib/live-state";
import { persistArchived, loadArchived, type ArchivedRow } from "@/lib/archive-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARCHIVE_WINDOW_MS = 8 * 60 * 60 * 1000;

// Curated older matches that have aged out of the fixtures snapshot but whose full
// play-by-play is still fetchable via /api/scores/updates (confirmed intact), so
// they stay playable in Archived by fixture id. Goals/minutes are read live below.
const CURATED: { fid: number; p1: string; p2: string; iso1: string; iso2: string }[] = [
  { fid: 18172469, p1: "Brazil", p2: "Japan", iso1: "br", iso2: "jp" },
  { fid: 18175397, p1: "Ivory Coast", p2: "Norway", iso1: "ci", iso2: "no" },
  { fid: 18175981, p1: "France", p2: "Sweden", iso1: "fr", iso2: "se" },
];

export async function GET() {
  const base = process.env.TXLINE_API_BASE;
  const jwt = await (await import("@/lib/txline-auth")).mintJwt(base);
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

    const fresh: ArchivedRow[] = started
      .filter((f) => states.get(f.FixtureId)?.finished)
      .map((f) => {
        const s = states.get(f.FixtureId)!;
        return { fid: f.FixtureId, p1: f.Participant1, p2: f.Participant2, iso1: iso(f.Participant1), iso2: iso(f.Participant2), goals: s.g1 + s.g2, minutes: s.minutes };
      });

    // DURABILITY: persist everything we just saw finished. Once written, a match
    // stays in Archived even after it rolls off the fixtures snapshot.
    await persistArchived(fresh);
    const stored = await loadArchived();

    // Merge: durable store ∪ this pass's fresh readings (fresh wins — newest
    // goals/minutes) ∪ curated. Keyed by fid so nothing duplicates.
    const byFid = new Map<number, { fid: number; p1: string; p2: string; iso1: string; iso2: string; goals: number; minutes: number; source: string }>();
    for (const r of stored) byFid.set(r.fid, { ...r, source: "stored" });
    for (const m of fresh) byFid.set(m.fid, { ...m, source: "live-finished" });

    // Append curated older matches (not already listed), with live goals/minutes.
    const curFids = CURATED.filter((c) => !byFid.has(c.fid)).map((c) => c.fid);
    const curStates = curFids.length ? await matchStates(base, jwt, apiToken, curFids) : new Map();
    for (const c of CURATED) {
      if (byFid.has(c.fid)) continue;
      const s = curStates.get(c.fid);
      byFid.set(c.fid, { fid: c.fid, p1: c.p1, p2: c.p2, iso1: c.iso1, iso2: c.iso2, goals: s ? s.g1 + s.g2 : 0, minutes: s?.minutes ?? 0, source: "curated" });
    }

    const matches = [...byFid.values()].sort((a, b) => b.goals - a.goals);
    return Response.json({ configured: true, matches });
  } catch (e) {
    return Response.json({ configured: true, matches: [], error: String(e) });
  }
}
