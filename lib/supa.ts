// Tiny server-side Supabase (PostgREST) client. Lives in the foil project but
// only ever touches the isolated `spk_*` tables. Uses the service-role key, so
// it MUST stay server-only (API routes), never imported into a client bundle.
const URL = process.env.SUPABASE_URL || "https://mohbmvajroqizlfaarjk.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export function supaReady(): boolean {
  return !!KEY;
}

function headers(extra?: Record<string, string>) {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...extra };
}

export async function supaGet<T = unknown>(pathAndQuery: string): Promise<T> {
  const r = await fetch(`${URL}/rest/v1/${pathAndQuery}`, { headers: headers(), cache: "no-store" });
  if (!r.ok) throw new Error(`supabase GET ${r.status}: ${await r.text()}`);
  return r.json();
}

// Insert/upsert. `onConflict` + `merge` → upsert; `ignoreDuplicates` → idempotent insert.
export async function supaUpsert<T = unknown>(
  table: string,
  rows: unknown,
  opts?: { onConflict?: string; ignoreDuplicates?: boolean; returning?: boolean }
): Promise<T> {
  const resolution = opts?.ignoreDuplicates ? "ignore-duplicates" : "merge-duplicates";
  const prefer = [`resolution=${resolution}`, opts?.returning === false ? "return=minimal" : "return=representation"].join(",");
  const q = opts?.onConflict ? `${table}?on_conflict=${opts.onConflict}` : table;
  const r = await fetch(`${URL}/rest/v1/${q}`, { method: "POST", headers: headers({ Prefer: prefer }), body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(`supabase UPSERT ${r.status}: ${await r.text()}`);
  return opts?.returning === false ? (undefined as T) : r.json();
}

export async function supaPatch<T = unknown>(pathAndQuery: string, patch: unknown): Promise<T> {
  const r = await fetch(`${URL}/rest/v1/${pathAndQuery}`, { method: "PATCH", headers: headers({ Prefer: "return=representation" }), body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`supabase PATCH ${r.status}: ${await r.text()}`);
  return r.json();
}

// Atomic increment via a Postgres function (defined in the migration) so two
// concurrent pack credits can't clobber each other's balance.
export async function supaRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: headers(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`supabase RPC ${fn} ${r.status}: ${await r.text()}`);
  return r.json();
}
