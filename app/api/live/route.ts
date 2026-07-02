// Lists currently-live World Cup matches from the mainnet TxLINE feed.
// Uses a server-held apiToken (env var) — no keypair / no on-chain subscribe at
// runtime. The fixtures snapshot has no live flag, so "live" = kickoff window
// (started within the last ~2.5h).
import { iso } from "@/lib/iso";
import { matchStates } from "@/lib/live-state";
import { persistArchived, type ArchivedRow } from "@/lib/archive-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIVE_WINDOW_MS = 2.5 * 60 * 60 * 1000;

export async function GET() {
  const base = process.env.TXLINE_API_BASE;
  const jwt = await (await import("@/lib/txline-auth")).mintJwt(base);
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
    const states = await matchStates(base, jwt, apiToken, candidates.map((f) => f.FixtureId));

    // A match usually finishes WHILE still inside the 2.5h live window, so this is
    // the earliest moment we can catch full time. Persist those to the durable
    // archive right here so Archived is populated even if nobody hits /api/archived
    // before the match rolls off the fixtures snapshot.
    const finishedRows: ArchivedRow[] = candidates
      .filter((f) => states.get(f.FixtureId)?.finished)
      .map((f) => {
        const s = states.get(f.FixtureId)!;
        return { fid: f.FixtureId, p1: f.Participant1, p2: f.Participant2, iso1: iso(f.Participant1), iso2: iso(f.Participant2), goals: s.g1 + s.g2, minutes: s.minutes };
      });
    await persistArchived(finishedRows);

    const matches = candidates
      .filter((f) => !states.get(f.FixtureId)?.finished)
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
