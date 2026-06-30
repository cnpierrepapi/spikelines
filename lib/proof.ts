// SERVER-ONLY. Proves a settled Spikelines bet against TxLINE's on-chain,
// Solana-anchored scores Merkle root using the txoracle `validate_stat` view.
//
// We deploy NOTHING: validate_stat is a read-only Anchor view (no signer, no
// writable account, no SOL, no landed tx) on TxLINE's already-deployed program.
// We simulate it against the devnet program and read back the boolean.
//
// A Spikelines bet is a WINDOW bet ("does <stat> happen for <side> within N
// min?"), i.e. a DELTA. validate_stat proves ONE stat value at ONE feed event,
// so we prove BOTH endpoints — the cumulative stat at the window's open and at
// its close — each against the on-chain root, then the delta settles the bet.
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, BN, type Idl } from "@coral-xyz/anchor";
import rawIdl from "./txline/idl/txoracle.json";

// ── config ────────────────────────────────────────────────────────
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
// Devnet txoracle program (the shipped IDL carries the mainnet address).
const PROGRAM_ID = new PublicKey(process.env.TXORACLE_PROGRAM_ID || "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TXLINE_BASE = process.env.TXLINE_API_BASE || "https://txline-dev.txodds.com";
const DAY_MS = 86_400_000;
// validate_stat is read-only, but Anchor's .view() still builds a fee-paying tx,
// and devnet `simulateTransaction` requires the fee payer to be an EXISTING,
// funded, system-owned account (a random/zero key fails InvalidAccountForFee /
// AccountNotFound). Point SOLANA_SIM_PAYER at any funded devnet wallet; the view
// never spends it. Without it the proof simply stays 'pending' (not 'failed').
const SIM_PAYER = process.env.SOLANA_SIM_PAYER;

export type ProofStatus = "verified" | "failed" | "unprovable" | "pending";
export type BetProof = {
  status: ProofStatus;
  root: string | null; // daily_scores_roots PDA (base58) the data anchors to
  valueBase: number | null;
  valueSettle: number | null;
  delta: number | null;
  recomputedYes: boolean | null; // did the event occur in the window?
  detail: string;
  bundles?: unknown; // the raw stat-validation bundles (for the /proof "Verify" UI)
};

// ── TxLINE REST ───────────────────────────────────────────────────
function txHeaders(): Record<string, string> | null {
  const jwt = process.env.TXLINE_JWT;
  const tok = process.env.TXLINE_API_TOKEN;
  if (!jwt || !tok) return null;
  return { Authorization: `Bearer ${jwt}`, "X-Api-Token": tok };
}

// Lightweight per-fixture index of {seq, ts}, so we can map a window timestamp to
// the feed sequence number stat-validation needs. Cached per process run.
const seqCache = new Map<number, { seq: number; ts: number }[]>();
async function seqIndex(fid: number, headers: Record<string, string>): Promise<{ seq: number; ts: number }[]> {
  const hit = seqCache.get(fid);
  if (hit) return hit;
  const res = await fetch(`${TXLINE_BASE}/api/scores/updates/${fid}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`updates ${res.status}`);
  const text = await res.text();
  const idx: { seq: number; ts: number }[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const o = JSON.parse(line.slice(5).trim());
      if (o && typeof o.Seq === "number" && typeof o.Ts === "number") idx.push({ seq: o.Seq, ts: o.Ts });
    } catch {}
  }
  idx.sort((a, b) => a.ts - b.ts);
  seqCache.set(fid, idx);
  return idx;
}
// The feed sequence active at (or just before) a given timestamp.
function seqAt(idx: { seq: number; ts: number }[], ts: number): number | null {
  let found: number | null = null;
  for (const r of idx) {
    if (r.ts <= ts) found = r.seq;
    else break;
  }
  return found;
}

type StatBundle = {
  ts: number;
  statToProve: { key: number; value: number; period: number };
  eventStatRoot: number[] | string;
  summary: { fixtureId: number; updateStats: { updateCount: number; minTimestamp: number; maxTimestamp: number }; eventStatsSubTreeRoot: number[] | string };
  statProof: { hash: number[] | string; isRightSibling: boolean }[];
  subTreeProof: { hash: number[] | string; isRightSibling: boolean }[];
  mainTreeProof: { hash: number[] | string; isRightSibling: boolean }[];
};
async function statValidation(fid: number, seq: number, statKey: number, headers: Record<string, string>): Promise<StatBundle> {
  const url = `${TXLINE_BASE}/api/scores/stat-validation?fixtureId=${fid}&seq=${seq}&statKey=${statKey}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`stat-validation ${res.status}`);
  return res.json();
}

// ── Anchor view plumbing ──────────────────────────────────────────
function toBytes(v: number[] | string): number[] {
  if (Array.isArray(v)) return v;
  // base64 (the OpenAPI types it as binary; the dev feed returns arrays)
  return Array.from(Buffer.from(v, "base64"));
}
function toNodes(nodes: { hash: number[] | string; isRightSibling: boolean }[]) {
  return nodes.map((n) => ({ hash: toBytes(n.hash), isRightSibling: n.isRightSibling }));
}

let _program: Program | null = null;
function program(): Program {
  if (_program) return _program;
  // Re-point the (mainnet) IDL at the devnet program and declare the view's
  // return type (the shipped IDL omits it), so Anchor can decode the boolean.
  const idl = JSON.parse(JSON.stringify(rawIdl)) as Idl & { address: string; instructions: { name: string; returns?: unknown }[] };
  idl.address = PROGRAM_ID.toBase58();
  const vs = idl.instructions.find((i) => i.name === "validate_stat");
  if (vs && !vs.returns) vs.returns = "bool";
  const connection = new Connection(RPC, "confirmed");
  // A read-only view never signs, but the fee-payer slot must be a real funded
  // devnet account or simulate rejects it. Use SOLANA_SIM_PAYER when set.
  const payer = SIM_PAYER ? new PublicKey(SIM_PAYER) : Keypair.generate().publicKey;
  const wallet = { publicKey: payer, signTransaction: async (t: unknown) => t, signAllTransactions: async (t: unknown) => t } as never;
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  _program = new Program(idl as Idl, provider);
  return _program;
}

function pdaForTs(ts: number): PublicKey {
  const epochDay = Math.floor(ts / DAY_MS);
  const day = Buffer.alloc(2);
  day.writeUInt16LE(epochDay, 0);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), day], PROGRAM_ID);
  return pda;
}

// Run the validate_stat view for one stat bundle. We assert the bundle's stat
// value against the on-chain root with an EqualTo predicate: a `true` result (no
// program error) means the proof reconciles to the published root AND the value
// is genuine. Returns { ok, root, error }.
async function viewStat(b: StatBundle): Promise<{ ok: boolean; root: string; error?: string }> {
  const pda = pdaForTs(b.summary.updateStats.minTimestamp);
  const statA = {
    statToProve: { key: b.statToProve.key, value: b.statToProve.value, period: b.statToProve.period },
    eventStatRoot: toBytes(b.eventStatRoot),
    statProof: toNodes(b.statProof),
  };
  const fixtureSummary = {
    fixtureId: new BN(b.summary.fixtureId),
    updateStats: {
      updateCount: b.summary.updateStats.updateCount,
      minTimestamp: new BN(b.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(b.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: toBytes(b.summary.eventStatsSubTreeRoot),
  };
  const predicate = { threshold: b.statToProve.value, comparison: { equalTo: {} } };
  try {
    const result = await (program().methods as Record<string, (...a: unknown[]) => { accounts: (a: unknown) => { view: () => Promise<unknown> } }>)
      .validateStat(
        new BN(b.ts),
        fixtureSummary,
        toNodes(b.subTreeProof),
        toNodes(b.mainTreeProof),
        predicate,
        statA,
        null,
        null,
      )
      .accounts({ dailyScoresMerkleRoots: pda })
      .view();
    return { ok: result === true, root: pda.toBase58() };
  } catch (e) {
    // Anchor surfaces the program error in message; the simulate infra error
    // (fee payer etc.) lives on simulationResponse.err. Prefer whichever is set.
    const sr = (e as { simulationResponse?: { err?: unknown } })?.simulationResponse?.err;
    const msg = sr ? JSON.stringify(sr) : String((e as Error)?.message ?? e);
    return { ok: false, root: pda.toBase58(), error: classify(msg) };
  }
}

function classify(msg: string): string {
  if (/RootNotAvailable/i.test(msg)) return "RootNotAvailable";
  if (/InvalidStatProof/i.test(msg)) return "InvalidStatProof";
  if (/InvalidSubTreeProof/i.test(msg)) return "InvalidSubTreeProof";
  if (/InvalidMainTreeProof/i.test(msg)) return "InvalidMainTreeProof";
  // Simulation-infra problems (fee payer not funded / stale blockhash) are NOT a
  // data failure — flag them so the bet stays 'pending', never 'failed'.
  if (/InvalidAccountForFee|AccountNotFound|BlockhashNotFound|account not found/i.test(msg)) return "SimInfra";
  return msg.slice(0, 140) || "unknown";
}

// ── public entrypoint ─────────────────────────────────────────────
// Verify one window bet end-to-end. `baseTs`/`settleTs` are the feed timestamps
// (ms) at the window's open and close; `statKey` is the per-side on-chain key.
export async function verifyBet(args: {
  fid: number;
  statKey: number;
  baseTs: number;
  settleTs: number;
}): Promise<BetProof> {
  const empty: BetProof = { status: "pending", root: null, valueBase: null, valueSettle: null, delta: null, recomputedYes: null, detail: "" };
  const headers = txHeaders();
  if (!headers) return { ...empty, detail: "txline not configured" };

  try {
    const idx = await seqIndex(args.fid, headers);
    const baseSeq = seqAt(idx, args.baseTs);
    const settleSeq = seqAt(idx, args.settleTs);
    if (baseSeq == null || settleSeq == null) return { ...empty, detail: "no feed seq for window" };

    const [bBase, bSettle] = await Promise.all([
      statValidation(args.fid, baseSeq, args.statKey, headers),
      statValidation(args.fid, settleSeq, args.statKey, headers),
    ]);
    const valueBase = bBase.statToProve.value;
    const valueSettle = bSettle.statToProve.value;
    const delta = valueSettle - valueBase;
    const recomputedYes = delta > 0;

    const [vBase, vSettle] = await Promise.all([viewStat(bBase), viewStat(bSettle)]);
    const root = vSettle.root;
    const bundles = { base: { seq: baseSeq, ...bBase, view: vBase }, settle: { seq: settleSeq, ...bSettle, view: vSettle } };

    if (vBase.ok && vSettle.ok) {
      return { status: "verified", root, valueBase, valueSettle, delta, recomputedYes, detail: "validate_stat ✓ both endpoints", bundles };
    }
    if (vBase.error === "RootNotAvailable" || vSettle.error === "RootNotAvailable") {
      return { status: "unprovable", root, valueBase, valueSettle, delta, recomputedYes, detail: "on-chain root not posted yet", bundles };
    }
    // Infra (unfunded sim payer / stale blockhash) → not a data failure: stay pending.
    if (vBase.error === "SimInfra" || vSettle.error === "SimInfra") {
      return { status: "pending", root, valueBase, valueSettle, delta, recomputedYes, detail: "verifier sim payer not configured (set SOLANA_SIM_PAYER)", bundles };
    }
    return { status: "failed", root, valueBase, valueSettle, delta, recomputedYes, detail: `view failed (${vBase.error ?? vBase.ok}/${vSettle.error ?? vSettle.ok})`, bundles };
  } catch (e) {
    return { ...empty, detail: classify(String((e as Error)?.message ?? e)) };
  }
}
