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
import { Connection, PublicKey, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import { AnchorProvider, Program, BN, type Idl } from "@coral-xyz/anchor";
import bs58 from "bs58";
import rawIdl from "./txline/idl/txoracle.json";

// Anchor custom-error code → name (the simulate `err` only carries the number;
// the name lives in the logs). Lets us classify a program error precisely.
const ERR_BY_CODE: Record<number, string> = Object.fromEntries(
  ((rawIdl as { errors?: { code: number; name: string }[] }).errors ?? []).map((e) => [e.code, e.name]),
);

// ── config ────────────────────────────────────────────────────────
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
// Devnet txoracle program (the shipped IDL carries the mainnet address).
const PROGRAM_ID = new PublicKey(process.env.TXORACLE_PROGRAM_ID || "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TXLINE_BASE = process.env.TXLINE_API_BASE || "https://txline-dev.txodds.com";
const DAY_MS = 86_400_000;
// validate_stat is read-only, but Anchor's .view() still builds a fee-paying tx,
// and devnet `simulateTransaction` requires the fee payer to be an EXISTING,
// funded, system-owned account (a random/zero key fails InvalidAccountForFee /
// AccountNotFound). The view never lands and never SPENDS — the funded account is
// only there so the simulator accepts the fee-payer slot.
//
// Resolution order for that account:
//   1. SOLANA_SIM_PAYER_SECRET  — base58 64-byte secret → a real signing wallet
//   2. TREASURY_SECRET_KEY      — the funded treasury wallet already in env (reused)
//   3. SOLANA_SIM_PAYER         — a bare pubkey (funded, but we can't sign)
// With (1)/(2) the simulated tx is genuinely signed by the funded wallet; with (3)
// the pubkey alone is enough on devnet. None of them ever move SOL.
const SIM_PAYER = process.env.SOLANA_SIM_PAYER;
const SIM_SECRET = process.env.SOLANA_SIM_PAYER_SECRET || process.env.TREASURY_SECRET_KEY;

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

// Build the provider wallet for the read-only view. With a secret key we return a
// wallet that actually signs the simulated tx; otherwise a funded pubkey (or, as a
// last resort, a random key that simulate will reject → result classified 'pending').
function simWallet() {
  if (SIM_SECRET) {
    const kp = Keypair.fromSecretKey(bs58.decode(SIM_SECRET.trim()));
    const sign = (tx: { partialSign?: (k: Keypair) => void; sign?: (k: Keypair[]) => void }) => {
      // Legacy Transaction (what .view() builds) → partialSign; tolerate either API.
      try {
        if (typeof tx.partialSign === "function") tx.partialSign(kp);
        else if (typeof tx.sign === "function") tx.sign([kp]);
      } catch { /* the funded fee-payer check is what matters, not the sig */ }
      return tx;
    };
    return {
      publicKey: kp.publicKey,
      signTransaction: async (t: unknown) => sign(t as never),
      signAllTransactions: async (ts: unknown[]) => (ts as never[]).map((t) => sign(t)),
    } as never;
  }
  const payer = SIM_PAYER ? new PublicKey(SIM_PAYER) : Keypair.generate().publicKey;
  return { publicKey: payer, signTransaction: async (t: unknown) => t, signAllTransactions: async (t: unknown) => t } as never;
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
  // The fee-payer slot must be a real funded devnet account or simulate rejects it.
  // Prefer a secret key (so the simulated tx is genuinely signed by the funded
  // wallet); fall back to a bare funded pubkey; last resort a throwaway key (which
  // simulate rejects → the proof stays 'pending', never 'failed').
  const provider = new AnchorProvider(connection, simWallet(), { commitment: "confirmed" });
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

// Build the validate_stat instruction args for one stat bundle. The `timestamp`
// arg + PDA seed MUST be the batch/interval minTimestamp (not the per-event ts),
// else the program rejects with TimestampMismatch (6010). EqualTo(value) makes the
// returned bool == "the proof reconciles to the on-chain root".
function buildArgs(b: StatBundle) {
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
  const targetTs = new BN(b.summary.updateStats.minTimestamp);
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  return { pda, statA, fixtureSummary, predicate, targetTs, computeIx };
}

// The validate_stat method builder, ready for either .view() (simulate) or .rpc()
// (land a real tx). Same instruction either way.
function statMethod(b: StatBundle) {
  const a = buildArgs(b);
  const m = (program().methods as Record<string, (...args: unknown[]) => { accounts: (x: unknown) => { preInstructions: (ix: unknown[]) => unknown } }>)
    .validateStat(a.targetTs, a.fixtureSummary, toNodes(b.subTreeProof), toNodes(b.mainTreeProof), a.predicate, a.statA, null, null)
    .accounts({ dailyScoresMerkleRoots: a.pda })
    .preInstructions([a.computeIx]);
  return { m, root: a.pda.toBase58() };
}

// Resolve a program/sim error (works for both .view() simulationResponse and .rpc()
// SendTransactionError) to a classified IDL error name. The program logs the
// AnchorError name; we also map the numeric Custom code (decimal or hex) as backup.
function extractErr(e: unknown): string {
  const any = e as { simulationResponse?: { err?: unknown; logs?: string[] }; logs?: string[]; transactionLogs?: string[]; message?: string };
  const logs = any.simulationResponse?.logs ?? any.logs ?? any.transactionLogs ?? [];
  const fromLogs = logs.join("\n").match(/Error Code:\s*(\w+)/)?.[1];
  const simErr = any.simulationResponse?.err as { InstructionError?: [number, { Custom?: number } | string] } | undefined;
  const custom = simErr?.InstructionError?.[1];
  const code = typeof custom === "object" && custom ? custom.Custom : undefined;
  const hex = String(any.message ?? "").match(/custom program error:\s*0x([0-9a-f]+)/i)?.[1];
  const byCode = typeof code === "number" ? ERR_BY_CODE[code] : hex ? ERR_BY_CODE[parseInt(hex, 16)] : undefined;
  const name = fromLogs ?? byCode;
  const msg = name ?? (simErr ? JSON.stringify(simErr) : String(any.message ?? e));
  return classify(msg);
}

// Read-only preflight: does this stat reconcile to the on-chain root? `true` (no
// program error) means yes. Used to decide whether a bet is anchorable.
async function viewStat(b: StatBundle): Promise<{ ok: boolean; root: string; error?: string }> {
  const { m, root } = statMethod(b);
  try {
    const result = await (m as { view: () => Promise<unknown> }).view();
    return { ok: result === true, root };
  } catch (e) {
    return { ok: false, root, error: extractErr(e) };
  }
}

// LAND a real validate_stat transaction (signed + fee-paid by the funded wallet) —
// the on-chain receipt. Succeeds only if the proof reconciles; the signature IS the
// proof. Returns the tx signature or a classified error.
async function landStat(b: StatBundle): Promise<{ sig?: string; root: string; error?: string }> {
  const { m, root } = statMethod(b);
  try {
    const sig = await (m as { rpc: (o?: unknown) => Promise<string> }).rpc({ commitment: "confirmed" });
    return { sig, root };
  } catch (e) {
    return { root, error: extractErr(e) };
  }
}

// Proof / time-slot mismatches: the root IS posted but our proof doesn't
// reconcile to it (expected on the devnet replay feed). Surfaced as 'unprovable'.
const MISMATCH_ERRORS = ["TimestampMismatch", "TimeSlotMismatch", "InvalidStatProof", "InvalidSubTreeProof", "InvalidFixtureSubTreeProof", "InvalidMainTreeProof"];

function classify(msg: string): string {
  if (/RootNotAvailable/i.test(msg)) return "RootNotAvailable";
  for (const n of MISMATCH_ERRORS) if (new RegExp(n, "i").test(msg)) return n;
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
    // Root IS posted but the proof doesn't reconcile to it. On a real (mainnet)
    // anchored fixture this would be a genuine integrity failure; on the devnet
    // World Cup REPLAY feed it just means that fixture's daily root wasn't committed
    // cleanly (the live-regenerated proof can't match the stale on-chain root). We
    // do NOT brand that 'failed' — failed wrongly implies tampered data and would be
    // unfair to honest players. It's simply not provable on this network.
    if (MISMATCH_ERRORS.includes(vBase.error ?? "") || MISMATCH_ERRORS.includes(vSettle.error ?? "")) {
      return { status: "unprovable", root, valueBase, valueSettle, delta, recomputedYes, detail: `on-chain root doesn't reconcile (${vBase.error ?? vSettle.error}) — devnet replay fixture`, bundles };
    }
    return { status: "failed", root, valueBase, valueSettle, delta, recomputedYes, detail: `view failed (${vBase.error ?? vBase.ok}/${vSettle.error ?? vSettle.ok})`, bundles };
  } catch (e) {
    return { ...empty, detail: classify(String((e as Error)?.message ?? e)) };
  }
}

// Once a bet's window endpoints both reconcile to the on-chain root, the stat
// delta is authoritative truth. The outcome it IMPLIES: a YES call wins iff the
// stat moved in the window; a NO call wins iff it did not. A recorded outcome that
// disagrees was mis-settled (e.g. a live running-max glitch / VAR rollback) and is
// the basis for a claw-back.
export function canonicalOutcome(choice: "YES" | "NO", recomputedYes: boolean): "won" | "lost" {
  return (choice === "YES") === recomputedYes ? "won" : "lost";
}

export type AnchorResult = {
  ok: boolean;
  status: ProofStatus;
  root: string | null;
  baseSig: string | null;
  settleSig: string | null; // the headline receipt (window close)
  valueBase: number | null;
  valueSettle: number | null;
  delta: number | null;
  recomputedYes: boolean | null;
  detail: string;
};

// Whether an on-chain signer is configured (a funded secret key). Anchoring needs
// it; the read-only preflight does not.
export function canAnchor(): boolean {
  return !!SIM_SECRET;
}

// ANCHOR a bet on-chain: land a real validate_stat tx for BOTH window endpoints,
// signed + fee-paid by the funded wallet. The signatures are the immutable proof
// that those exact stats reconcile to the on-chain Merkle root. Anchor's preflight
// simulation rejects a non-reconciling proof BEFORE landing (no SOL spent), so a
// non-verifiable bet returns an error, never a bogus signature.
export async function anchorBet(args: {
  fid: number;
  statKey: number;
  baseTs: number;
  settleTs: number;
}): Promise<AnchorResult> {
  const empty: AnchorResult = { ok: false, status: "pending", root: null, baseSig: null, settleSig: null, valueBase: null, valueSettle: null, delta: null, recomputedYes: null, detail: "" };
  if (!SIM_SECRET) return { ...empty, detail: "no on-chain signer configured (set SOLANA_SIM_PAYER_SECRET)" };
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

    // Land the settle endpoint first (the headline receipt), then the base.
    const settle = await landStat(bSettle);
    const base = await landStat(bBase);
    const root = settle.root;
    const out = { root, valueBase, valueSettle, delta, recomputedYes };

    if (settle.sig && base.sig) {
      return { ...out, ok: true, status: "verified", baseSig: base.sig, settleSig: settle.sig, detail: "anchored on-chain ✓ both endpoints" };
    }
    const err = settle.error ?? base.error;
    if (err === "RootNotAvailable") {
      return { ...empty, ...out, status: "unprovable", detail: "on-chain root not posted yet" };
    }
    if (MISMATCH_ERRORS.includes(err ?? "")) {
      return { ...empty, ...out, status: "unprovable", detail: `on-chain root doesn't reconcile (${err}) — devnet replay fixture` };
    }
    return { ...empty, ...out, baseSig: base.sig ?? null, settleSig: settle.sig ?? null, status: "failed", detail: `anchor failed (${base.error ?? base.sig}/${settle.error ?? settle.sig})` };
  } catch (e) {
    return { ...empty, detail: classify(String((e as Error)?.message ?? e)) };
  }
}
