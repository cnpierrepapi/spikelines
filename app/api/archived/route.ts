// Lists finished World Cup matches for the lobby's Archived section. The durable set
// is the static in-repo list (lib/archived-matches.ts) — every played match through
// the semifinals, with team names + final tally baked in so it survives TxLINE's
// rolling fixtures snapshot with no database. On top of that we fold in anything that
// has JUST finished and is still visible in the live snapshot, so a match appears in
// Archived the moment it ends (before it's been added to the static list). Each is
// playable from kickoff via /api/replay/{fid}.
import { iso } from "@/lib/iso";
import { matchStates } from "@/lib/live-state";
import { loadArchived, type ArchivedRow } from "@/lib/archive-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ARCHIVE_WINDOW_MS = 8 * 60 * 60 * 1000;

type Row = ArchivedRow & { source: string };

export async function GET() {
  // The static list is the baseline — always returned, even if TxLINE is unreachable.
  const byFid = new Map<number, Row>();
  for (const r of await loadArchived()) byFid.set(r.fid, { ...r, source: "static" });

  const base = process.env.TXLINE_API_BASE;
  const jwt = await (await import("@/lib/txline-auth")).mintJwt(base);
  const apiToken = process.env.TXLINE_API_TOKEN;

  // Best-effort live pass: catch matches that finished so recently they're not in the
  // static list yet. Any failure here just leaves the static baseline untouched.
  if (base && jwt && apiToken) {
    try {
      const res = await fetch(`${base}/api/fixtures/snapshot`, { headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken }, cache: "no-store" });
      if (res.ok) {
        const j: any = await res.json();
        const arr: any[] = Array.isArray(j) ? j : j.fixtures || j.data || [];
        const now = Date.now();
        const started = arr.filter((f) => f.CompetitionId === 72 && f.StartTime <= now && f.StartTime >= now - ARCHIVE_WINDOW_MS);
        const states = await matchStates(base, jwt, apiToken, started.map((f) => f.FixtureId));
        for (const f of started) {
          const s = states.get(f.FixtureId);
          if (!s?.finished) continue;
          byFid.set(f.FixtureId, { fid: f.FixtureId, p1: f.Participant1, p2: f.Participant2, iso1: iso(f.Participant1), iso2: iso(f.Participant2), goals: s.g1 + s.g2, minutes: s.minutes, source: "live-finished" });
        }
      }
    } catch {
      // swallow — the static list is already in byFid, so Archived is never empty
    }
  }

  const matches = [...byFid.values()].sort((a, b) => b.goals - a.goals);
  return Response.json({ configured: !!(base && jwt && apiToken), matches });
}
