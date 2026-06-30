// Public read for the /proof global ledger: every settled bet from every player,
// most-recent first, with optional filters. Served via the service-role key (the
// spk_bets table is RLS-locked, so the anon key can't read it directly).
import { supaGet, supaReady } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!supaReady()) return Response.json({ ok: false, bets: [], fixtures: [] }, { status: 503 });
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
  const fixture = url.searchParams.get("fixture");
  const outcome = url.searchParams.get("outcome"); // won | lost
  const status = url.searchParams.get("status"); // verified | unprovable | ...

  const cols = "id,device_id,username,fixture_id,match,mode,market,side,stat_key,mins,choice,outcome,reward,base_ts,settle_ts,proof_status,proof_root,proof_tx,reverted,revert_reason,created_at";
  const q: string[] = [`select=${cols}`, "order=created_at.desc", `limit=${limit}`, `offset=${offset}`];
  if (fixture) q.push(`fixture_id=eq.${encodeURIComponent(fixture)}`);
  if (outcome === "won" || outcome === "lost") q.push(`outcome=eq.${outcome}`);
  if (status) q.push(`proof_status=eq.${encodeURIComponent(status)}`);

  try {
    const bets = await supaGet<Record<string, unknown>[]>(`spk_bets?${q.join("&")}`);
    // Distinct fixtures (for the filter dropdown) — a small separate read.
    const fxRows = await supaGet<{ fixture_id: number; match: string }[]>(`spk_bets?select=fixture_id,match&order=created_at.desc&limit=400`);
    const seen = new Map<number, string>();
    for (const r of fxRows) if (!seen.has(r.fixture_id)) seen.set(r.fixture_id, r.match);
    const fixtures = [...seen.entries()].map(([fixture_id, match]) => ({ fixture_id, match }));
    return Response.json({ ok: true, bets, fixtures });
  } catch (e) {
    return Response.json({ ok: false, bets: [], fixtures: [], error: String((e as Error)?.message ?? e) }, { status: 502 });
  }
}
