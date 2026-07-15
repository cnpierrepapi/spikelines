// STATIC ARCHIVE — the durable source of truth for finished World Cup matches.
//
// Why static: TxLINE's fixtures snapshot is a rolling window (it only ever holds a
// handful of near-term matches), so a finished match disappears from the live feed
// within hours. The Archived list used to survive that by persisting every finished
// match into a Supabase table (spk_archived); that table was removed, so the list is
// baked here instead — no database, no rolling-window blind spot.
//
// Each row's goals/minutes were read from TxLINE's per-fixture scores snapshot
// (/api/scores/snapshot/{fid}) using the same tally logic as lib/live-state.ts. The
// full play-by-play for every fid below is still fetchable on demand via
// /api/scores/updates/{fid}, which is what /api/replay streams — so these stay fully
// playable from kickoff even though they've aged out of the live snapshot.
//
// Covers every match played through the semifinals EXCEPT the three still to come
// (the second semifinal, the third-place playoff and the final). When one of those
// finishes, /api/archived picks it up live from the snapshot automatically; add it
// here once it rolls off so it stays durable.
import { iso } from "@/lib/iso";

export type ArchivedRow = { fid: number; p1: string; p2: string; iso1: string; iso2: string; goals: number; minutes: number };

// fid + team names + final tally. iso codes are derived from the names below so they
// always match lib/iso.ts (and the flag PNGs in /public/flags). Ordered newest-first.
const MATCHES: Array<{ fid: number; p1: string; p2: string; goals: number; minutes: number }> = [
  { fid: 18237038, p1: "France", p2: "Spain", goals: 2, minutes: 97 },
  { fid: 18222446, p1: "Argentina", p2: "Switzerland", goals: 4, minutes: 124 },
  { fid: 18218149, p1: "Spain", p2: "Belgium", goals: 3, minutes: 97 },
  { fid: 18213979, p1: "Norway", p2: "England", goals: 3, minutes: 122 },
  { fid: 18209181, p1: "France", p2: "Morocco", goals: 2, minutes: 96 },
  { fid: 18202783, p1: "Switzerland", p2: "Colombia", goals: 0, minutes: 121 },
  { fid: 18202701, p1: "Argentina", p2: "Egypt", goals: 5, minutes: 101 },
  { fid: 18198205, p1: "Portugal", p2: "Spain", goals: 1, minutes: 99 },
  { fid: 18193785, p1: "USA", p2: "Belgium", goals: 5, minutes: 94 },
  { fid: 18192996, p1: "Mexico", p2: "England", goals: 5, minutes: 102 },
  { fid: 18188721, p1: "Paraguay", p2: "France", goals: 1, minutes: 100 },
  { fid: 18187298, p1: "Brazil", p2: "Norway", goals: 3, minutes: 102 },
  { fid: 18185036, p1: "Canada", p2: "Morocco", goals: 3, minutes: 98 },
  { fid: 18179763, p1: "Portugal", p2: "Croatia", goals: 3, minutes: 109 },
  { fid: 18179552, p1: "Switzerland", p2: "Algeria", goals: 2, minutes: 96 },
  { fid: 18179551, p1: "Spain", p2: "Austria", goals: 3, minutes: 96 },
  { fid: 18179549, p1: "Colombia", p2: "Ghana", goals: 1, minutes: 98 },
  { fid: 18176123, p1: "Australia", p2: "Egypt", goals: 2, minutes: 122 },
  { fid: 18175981, p1: "France", p2: "Sweden", goals: 3, minutes: 94 },
  { fid: 18175397, p1: "Ivory Coast", p2: "Norway", goals: 3, minutes: 98 },
  { fid: 18172469, p1: "Brazil", p2: "Japan", goals: 3, minutes: 101 },
];

export const ARCHIVED_MATCHES: ArchivedRow[] = MATCHES.map((m) => ({
  ...m,
  iso1: iso(m.p1),
  iso2: iso(m.p2),
}));

export const ARCHIVED_BY_FID: Map<number, ArchivedRow> = new Map(ARCHIVED_MATCHES.map((m) => [m.fid, m]));
