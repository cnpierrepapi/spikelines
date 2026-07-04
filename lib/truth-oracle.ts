// GATE 3 (read-only) — OUR own deployed Solana program's on-chain record of the
// VAR-aware corrected match result. Ported from Bootroom, where the writer commits
// one immutable `FixtureTruth` per fixture. Spikelines shares TxLINE's World Cup
// fixture IDs, so the SAME record is readable here by fixtureId — no secret, no DB,
// no write. This is the third, independent anchor beyond Gate 1 (our program-less
// sha256 recompute) and Gate 2 (TxLINE's own mainnet validate_stat).
//
// The record PDA is deterministic from (fixtureId, algoVersion), so we derive it,
// read the account off the program's cluster (devnet), decode the fixed layout, and
// surface a clickable explorer receipt. Distinct program from TxLINE's mainnet
// oracle — deliberately (see Bootroom programs/truth-oracle/README).
import { Connection, PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

// Pins reconstruct()'s algorithm; also part of the PDA seed. Matches Bootroom's
// lib/truth-commit ALGO_VERSION — a bump there yields a fresh record address.
export const ALGO_VERSION = 1;

// Public, non-secret constants (env-overridable). The already-deployed devnet
// program + public RPC mean this works on the live site with no extra env vars.
const PROGRAM_ID = new PublicKey(process.env.TRUTH_ORACLE_PROGRAM_ID || "7eX1xfHXNUvfdud26GuDaEhHdTUddjYhfGgs9a73iMF");
const RPC = process.env.TRUTH_ORACLE_RPC || "https://api.devnet.solana.com";
// The program is on devnet, so explorer links for its accounts/txs need the cluster.
export const TRUTH_ORACLE_CLUSTER = process.env.TRUTH_ORACLE_CLUSTER || "devnet";

export type TruthRecord = {
  recordPda: string;
  commitTx: string | null;
  algoVersion: number;
  finalSeq: number;
  truth: { p1: number; p2: number };
  anchored: { p1: number; p2: number };
  winner: number;
  varApplied: boolean;
  diverges: boolean;
  txlineRootPda: string;
  commitment: string;
  committedAt: number;
  slot: number;
};

const disc = (s: string) => Buffer.from(sha256(new TextEncoder().encode(s))).subarray(0, 8);

export function recordPda(fixtureId: number, algoVersion = ALGO_VERSION): PublicKey {
  const fidLe = Buffer.alloc(8); fidLe.writeBigInt64LE(BigInt(fixtureId), 0);
  const verLe = Buffer.alloc(2); verLe.writeUInt16LE(algoVersion, 0);
  return PublicKey.findProgramAddressSync([Buffer.from("truth"), fidLe, verLe], PROGRAM_ID)[0];
}

// Decode a FixtureTruth account (fixed layout, after the 8-byte Anchor discriminator).
function decode(data: Buffer) {
  let o = 8;
  const skip = (n: number) => { const b = data.subarray(o, o + n); o += n; return b; };
  skip(32); // authority
  const fixtureId = data.readBigInt64LE(o); o += 8;
  const algoVersion = data.readUInt16LE(o); o += 2;
  const finalSeq = data.readUInt32LE(o); o += 4;
  skip(32); // input_digest
  const truthP1 = data[o++], truthP2 = data[o++], anchoredP1 = data[o++], anchoredP2 = data[o++];
  const winner = data[o++], varApplied = data[o++], diverges = data[o++];
  const txlineRootPda = new PublicKey(skip(32));
  skip(32); // txline_root_hash
  const commitment = Buffer.from(skip(32)).toString("hex");
  const committedAt = Number(data.readBigInt64LE(o)); o += 8;
  const slot = Number(data.readBigUInt64LE(o)); o += 8;
  return { fixtureId, algoVersion, finalSeq, truthP1, truthP2, anchoredP1, anchoredP2, winner, varApplied, diverges, txlineRootPda, commitment, committedAt, slot };
}

// Read our on-chain truth record for a fixture, or null if none is committed yet.
export async function readTruthRecord(fixtureId: number): Promise<TruthRecord | null> {
  try {
    const conn = new Connection(RPC, "confirmed");
    const pda = recordPda(fixtureId);
    const info = await conn.getAccountInfo(pda);
    if (!info) return null;
    if (!Buffer.from(info.data.subarray(0, 8)).equals(disc("account:FixtureTruth"))) return null;
    const r = decode(Buffer.from(info.data));
    // Write-once record → the single signature on the PDA is the commit tx.
    let commitTx: string | null = null;
    try {
      const sigs = await conn.getSignaturesForAddress(pda, { limit: 1 });
      commitTx = sigs[0]?.signature ?? null;
    } catch { /* signature lookup is best-effort */ }
    return {
      recordPda: pda.toBase58(),
      commitTx,
      algoVersion: r.algoVersion,
      finalSeq: r.finalSeq,
      truth: { p1: r.truthP1, p2: r.truthP2 },
      anchored: { p1: r.anchoredP1, p2: r.anchoredP2 },
      winner: r.winner,
      varApplied: r.varApplied === 1,
      diverges: r.diverges === 1,
      txlineRootPda: r.txlineRootPda.toBase58(),
      commitment: r.commitment,
      committedAt: r.committedAt,
      slot: r.slot,
    };
  } catch {
    return null;
  }
}

// Batch reader for a set of fixtures (dedupes; best-effort per fixture).
export async function readTruthRecords(fixtureIds: number[]): Promise<Record<number, TruthRecord | null>> {
  const uniq = [...new Set(fixtureIds)];
  const out: Record<number, TruthRecord | null> = {};
  await Promise.all(uniq.map(async (fid) => { out[fid] = await readTruthRecord(fid); }));
  return out;
}

export const TRUTH_ORACLE_PROGRAM = PROGRAM_ID.toBase58();
