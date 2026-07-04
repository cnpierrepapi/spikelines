// INDEPENDENT Merkle recompute — our OWN check gate (Gate 1), no Anchor program, no
// wallet, no RPC, no fee. Given a TxLINE stat-validation bundle, we re-hash the stat
// leaf and walk the raw proof nodes ourselves to reproduce the two Merkle roots
// TxLINE publishes (eventStatRoot and the fixture's eventStatsSubTreeRoot). If ours
// equal theirs, the anchored value is genuinely what TxLINE committed — catching a
// tampered value that validate_stat (Gate 2) alone would take on trust.
//
// Spec reverse-derived empirically from live mainnet fixtures:
//   hash      = SHA-256   (not keccak)
//   stat leaf = sha256( key:u32LE ‖ value:i32LE ‖ period:i32LE )   (borsh ScoreStat)
//   node fold = isRightSibling ? sha256(cur ‖ sib) : sha256(sib ‖ cur)
//
// NOTE: a value=0 stat is proved by a SPARSE-tree ABSENCE proof (sentinel node
// 0x01‖0xFF… padding) whose encoding TxLINE does not publish, so it can't be rebuilt
// from first principles — we mark those `absent` (on-chain-attested via validate_stat
// only), NOT a false ✗. Every scored tally (value ≥ 1) is a present, recomputable
// stat. This is why a match where a side scored 0 (e.g. a 2–0) shows one leg attested
// rather than failed.
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
  absent: boolean; // a value=0 absence proof — on-chain-attested, not recomputable
  leafToEvent: boolean;
  eventToSubtree: boolean;
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

// A value=0 proof uses a sentinel sparse-tree node (first proof hash begins 0x01
// followed by 0xFF padding). Detect it so we report `absent` rather than a false ✗.
function looksAbsent(bundle: StatBundleLike, stat: { value: number }): boolean {
  if (stat.value !== 0) return false;
  const first = bundle.statProof?.[0];
  if (!first) return true;
  const b = toBuf(first.hash);
  return b.length === 32 && b[0] === 0x01 && b[1] === 0xff;
}

export function independentCheck(bundle: StatBundleLike): IndependentCheck {
  const base = { leafToEvent: false, eventToSubtree: false, computedSubtreeRoot: null as string | null };
  const stat = bundle.statToProve ?? bundle.stat_to_prove;
  if (!stat || !bundle.statProof || !bundle.subTreeProof || !bundle.eventStatRoot || !bundle.summary?.eventStatsSubTreeRoot) {
    return { ...base, ok: false, absent: false, detail: "incomplete bundle (missing proof nodes or published roots)" };
  }
  if (looksAbsent(bundle, stat)) {
    return { ...base, ok: false, absent: true, detail: "0-value absence proof — on-chain-attested (validate_stat), not independently recomputable" };
  }
  const computedEvent = fold(statLeaf(stat), bundle.statProof);
  const leafToEvent = computedEvent.equals(toBuf(bundle.eventStatRoot));
  const computedSub = fold(computedEvent, bundle.subTreeProof);
  const eventToSubtree = computedSub.equals(toBuf(bundle.summary.eventStatsSubTreeRoot));
  const ok = leafToEvent && eventToSubtree;
  return {
    ok,
    absent: false,
    leafToEvent,
    eventToSubtree,
    computedSubtreeRoot: computedSub.toString("hex"),
    detail: ok
      ? "independent sha256 recompute ✓ (value reconciles to TxLINE's committed sub-tree)"
      : `independent recompute mismatch (leaf→event ${leafToEvent}, event→subtree ${eventToSubtree})`,
  };
}

// Combine the two window endpoints of a Spikelines bet into one verdict. A leg whose
// value is 0 is an absence proof → attested (not recomputable), which must NOT count
// as a mismatch. So `ok` means "no genuine recompute failure" (present legs reconcile
// and absent legs are attested), and `absent` flags that at least one leg was a 0-value
// absence proof — the UI shows that as attested-✓ rather than a red ✗.
export function independentPair(base: StatBundleLike, settle: StatBundleLike) {
  const b = independentCheck(base);
  const s = independentCheck(settle);
  const ok = (b.ok || b.absent) && (s.ok || s.absent);
  const absent = b.absent || s.absent;
  return { ok, absent, base: b, settle: s };
}
