// Durable archive of finished matches (spk_archived). Server-only: uses the
// service-role Supabase client. This is what makes Archived survive TxLINE's
// rolling fixtures snapshot — once a match is seen finished it's persisted here
// and listed forever, even after it ages out of the live feed.
import { supaReady, supaUpsert, supaGet } from "@/lib/supa";

export type ArchivedRow = { fid: number; p1: string; p2: string; iso1: string; iso2: string; goals: number; minutes: number };

// Upsert finished matches by fixture id. Idempotent (safe to call on every
// live/archived request); refreshes goals/minutes if a later pass has newer data.
// Never throws — archiving is best-effort and must not break the lobby.
export async function persistArchived(rows: ArchivedRow[]): Promise<void> {
  if (!supaReady() || rows.length === 0) return;
  try {
    const now = new Date().toISOString();
    await supaUpsert(
      "spk_archived",
      rows.map((r) => ({ fixture_id: r.fid, p1: r.p1, p2: r.p2, iso1: r.iso1, iso2: r.iso2, goals: r.goals, minutes: r.minutes, updated_at: now })),
      { onConflict: "fixture_id", returning: false }
    );
  } catch {
    // swallow — a Supabase blip shouldn't take down /api/live or /api/archived
  }
}

// All persisted archived matches, newest-finished first.
export async function loadArchived(limit = 100): Promise<ArchivedRow[]> {
  if (!supaReady()) return [];
  try {
    const rows = await supaGet<Array<{ fixture_id: number; p1: string; p2: string; iso1: string; iso2: string; goals: number; minutes: number }>>(
      `spk_archived?select=fixture_id,p1,p2,iso1,iso2,goals,minutes&order=finished_at.desc&limit=${limit}`
    );
    return rows.map((r) => ({ fid: r.fixture_id, p1: r.p1, p2: r.p2, iso1: r.iso1, iso2: r.iso2, goals: r.goals, minutes: r.minutes }));
  } catch {
    return [];
  }
}

// One persisted match by fixture id — used by /api/replay to recover team names
// once a match has aged out of the fixtures snapshot.
export async function lookupArchived(fid: number): Promise<ArchivedRow | null> {
  if (!supaReady()) return null;
  try {
    const rows = await supaGet<Array<{ fixture_id: number; p1: string; p2: string; iso1: string; iso2: string; goals: number; minutes: number }>>(
      `spk_archived?select=fixture_id,p1,p2,iso1,iso2,goals,minutes&fixture_id=eq.${fid}&limit=1`
    );
    const r = rows[0];
    return r ? { fid: r.fixture_id, p1: r.p1, p2: r.p2, iso1: r.iso1, iso2: r.iso2, goals: r.goals, minutes: r.minutes } : null;
  } catch {
    return null;
  }
}
