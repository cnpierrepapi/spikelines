// GATE 3 (read-only) — surface OUR own deployed program's on-chain corrected-result
// record for a set of fixtures. Takes ?fids=1,2,3 and returns each fixture's immutable
// truth record (or null if none committed). Pure devnet read: no secret, no write, no
// deploy — the program is already live and the record is keyed by fixtureId, which
// Spikelines shares with Bootroom's writer.
import { readTruthRecords, TRUTH_ORACLE_PROGRAM, TRUTH_ORACLE_CLUSTER } from "@/lib/truth-oracle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("fids") || "";
  const fids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!fids.length) return Response.json({ ok: true, program: TRUTH_ORACLE_PROGRAM, cluster: TRUTH_ORACLE_CLUSTER, records: {} });
  try {
    const records = await readTruthRecords(fids);
    return Response.json({ ok: true, program: TRUTH_ORACLE_PROGRAM, cluster: TRUTH_ORACLE_CLUSTER, records });
  } catch {
    return Response.json({ ok: false, error: "oracle_read_failed", records: {} }, { status: 500 });
  }
}
