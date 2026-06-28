// Serves a finished match for replay straight from TxLINE's full in-play
// sequence (/api/scores/updates/{fid}) — so a match that ends can be played in
// Archived mode WITHOUT having been pre-recorded into public/replays. Returns
// the same slimmed record shape the /match page expects, plus team meta.
import { iso } from "@/lib/iso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLIM = (r: any) => ({ Action: r.Action, Score: r.Score, Clock: r.Clock, Participant: r.Participant, Participant1Id: r.Participant1Id, Participant2Id: r.Participant2Id, Ts: r.Ts, GameState: r.GameState });

function parseUpdates(text: string): any[] {
  const recs: any[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    let v = line.slice(5);
    if (v.startsWith(" ")) v = v.slice(1);
    try { const o = JSON.parse(v); if (o && o.FixtureId != null) recs.push(o); } catch {}
  }
  return recs;
}

export async function GET(_request: Request, ctx: { params: Promise<{ fid: string }> }) {
  const { fid: fidStr } = await ctx.params;
  const fid = Number(fidStr);
  const base = process.env.TXLINE_API_BASE;
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  if (!base || !jwt || !apiToken) return Response.json({ recs: [], error: "not configured" }, { status: 503 });
  const headers = { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken };
  try {
    const res = await fetch(`${base}/api/scores/updates/${fid}`, { headers, cache: "no-store" });
    if (!res.ok) return Response.json({ recs: [], error: res.status }, { status: 502 });
    const recs = parseUpdates(await res.text()).map(SLIM).sort((a, b) => (a.Ts ?? 0) - (b.Ts ?? 0));

    // team meta from the fixtures snapshot
    let p1 = "Home", p2 = "Away";
    try {
      const fr = await fetch(`${base}/api/fixtures/snapshot`, { headers, cache: "no-store" });
      if (fr.ok) {
        const fj: any = await fr.json();
        const fxs: any[] = Array.isArray(fj) ? fj : fj.fixtures || [];
        const f = fxs.find((x) => x.FixtureId === fid);
        if (f) { p1 = f.Participant1; p2 = f.Participant2; }
      }
    } catch {}
    const minutes = recs.reduce((m, r) => Math.max(m, r.Clock?.Seconds ?? 0), 0) / 60;
    const entry = { fid, p1, p2, iso1: iso(p1), iso2: iso(p2), minutes: Math.round(minutes) };
    return Response.json({ entry, recs });
  } catch (e) {
    return Response.json({ recs: [], error: String(e) }, { status: 502 });
  }
}
