// INDEPENDENT Merkle recompute — our OWN check gate, no Anchor program, no wallet,
// no RPC, no fee. Given a TxLINE stat-validation bundle, we re-hash the stat leaf
// and walk the raw proof nodes ourselves to reproduce the two Merkle roots TxLINE
// publishes (eventStatRoot and the fixture's eventStatsSubTreeRoot). If our
// independently-computed roots equal theirs, the stat VALUE genuinely belongs to
// that fixture's committed sub-tree — which is exactly the link `validate_stat`
// alone asks you to take on trust (it proves the sub-tree is on-chain, but trusts
// the API's claim that this value maps to it).
//
// Spec reverse-derived empirically from live mainnet fixtures (18172379, 18179551):
//   hash      = SHA-256  (note: NOT keccak, which most Solana trees use)
//   stat leaf = sha256( key:u32LE ‖ value:i32LE ‖ period:i32LE )   (borsh ScoreStat)
//   node fold = isRightSibling ? sha256(cur ‖ sib) : sha256(sib ‖ cur)
//
// The third level (fixtureSummary → the daily root in the on-chain PDA) is a
// program black box — its leaf encoding + account layout are unpublished, and
// TxLINE's own reference only checks the PDA exists and delegates to the program.
// So that final anchor stays with `validate_stat` (see lib/proof.ts). This module
// is the part we CAN verify from first principles, and we do.
import { sha256 } from "@noble/hashes/sha256";

type ProofNode = { hash: number[] | string; isRightSibling?: boolean; is_right_sibling?: boolean };
type StatBundleLike = {
  statToProve?: { key: number; value: number; period: number };
  stat_to_prove?: { key: number; value: number; period: number };
  eventStatRoot?: number[] | string;
  summary?: { eventStatsSubTreeRoot?: number[] | string };
  statProof?: ProofNode[];
  subTreeProof?: ProofNode[];
};

export type IndependentCheck = {
  ok: boolean; // both levels reconstructed to TxLINE's published roots
  leafToEvent: boolean; // our sha256 fold(stat leaf, statProof) === eventStatRoot
  eventToSubtree: boolean; // our sha256 fold(eventStatRoot, subTreeProof) === eventStatsSubTreeRoot
  computedEventRoot: string | null;
  computedSubtreeRoot: string | null;
  detail: string;
};

const toBuf = (v: number[] | string | undefined): Buffer =>
  v == null ? Buffer.alloc(0) : Array.isArray(v) ? Buffer.from(v) : Buffer.from(v, "base64");
const h = (b: Buffer): Buffer => Buffer.from(sha256(b));

// borsh(ScoreStat): key u32 LE, value i32 LE, period i32 LE
function statLeaf(s: { key: number; value: number; period: number }): Buffer {
  const b = Buffer.alloc(12);
  b.writeUInt32LE(s.key >>> 0, 0);
  b.writeInt32LE(s.value | 0, 4);
  b.writeInt32LE(s.period | 0, 8);
  return h(b);
}

// Walk a leaf hash up through proof nodes to a root, honouring each node's side.
function fold(leaf: Buffer, nodes: ProofNode[]): Buffer {
  let cur = leaf;
  for (const n of nodes) {
    const sib = toBuf(n.hash);
    const right = n.isRightSibling ?? n.is_right_sibling ?? false;
    cur = h(right ? Buffer.concat([cur, sib]) : Buffer.concat([sib, cur]));
  }
  return cur;
}

export function independentCheck(bundle: StatBundleLike): IndependentCheck {
  const fail = (detail: string): IndependentCheck => ({
    ok: false, leafToEvent: false, eventToSubtree: false, computedEventRoot: null, computedSubtreeRoot: null, detail,
  });
  const stat = bundle.statToProve ?? bundle.stat_to_prove;
  if (!stat || !bundle.statProof || !bundle.subTreeProof || !bundle.eventStatRoot || !bundle.summary?.eventStatsSubTreeRoot) {
    return fail("incomplete bundle (missing proof nodes or published roots)");
  }
  const computedEvent = fold(statLeaf(stat), bundle.statProof);
  const leafToEvent = computedEvent.equals(toBuf(bundle.eventStatRoot));
  // Fold from OUR computed event root (fully independent); if leafToEvent holds it
  // equals TxLINE's, so a false here isolates which level diverged.
  const computedSub = fold(computedEvent, bundle.subTreeProof);
  const eventToSubtree = computedSub.equals(toBuf(bundle.summary.eventStatsSubTreeRoot));
  const ok = leafToEvent && eventToSubtree;
  return {
    ok,
    leafToEvent,
    eventToSubtree,
    computedEventRoot: computedEvent.toString("hex"),
    computedSubtreeRoot: computedSub.toString("hex"),
    detail: ok
      ? "independent sha256 recompute ✓ (stat value belongs to the committed sub-tree)"
      : `independent recompute mismatch (leaf→event ${leafToEvent}, event→subtree ${eventToSubtree})`,
  };
}

// Combine the two window endpoints of a Spikelines bet into one verdict.
export function independentPair(base: StatBundleLike, settle: StatBundleLike) {
  const b = independentCheck(base);
  const s = independentCheck(settle);
  return { ok: b.ok && s.ok, base: b, settle: s };
}
