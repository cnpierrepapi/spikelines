// Durable archive of finished matches. Previously backed by a Supabase table
// (spk_archived); that table was dropped in the July database consolidation, which
// silently emptied the Archived list. The durable set now lives in-repo as a static
// list (lib/archived-matches.ts) — no database dependency, and it can't be lost to a
// rolling live-feed window. This module keeps the original API so /api/live,
// /api/archived and /api/replay don't have to change.
import { ARCHIVED_MATCHES, ARCHIVED_BY_FID, type ArchivedRow } from "@/lib/archived-matches";

export type { ArchivedRow };

// No-op: archiving is now a build-time concern (the static list), not a runtime write.
// Kept so the live/archived routes can still call it on every finished match without
// caring where the durable copy lives. To make a newly-finished match permanent, add
// it to lib/archived-matches.ts.
export async function persistArchived(_rows: ArchivedRow[]): Promise<void> {
  return;
}

// The full durable archive, newest-finished first (already ordered in the static list).
export async function loadArchived(limit = 100): Promise<ArchivedRow[]> {
  return ARCHIVED_MATCHES.slice(0, limit);
}

// One archived match by fixture id — used by /api/replay to recover team names once a
// match has aged out of the fixtures snapshot (otherwise replay falls back to Home/Away).
export async function lookupArchived(fid: number): Promise<ArchivedRow | null> {
  return ARCHIVED_BY_FID.get(fid) ?? null;
}
