// GATE 3 WRITER (self-contained) — commit a fixture's VAR-aware corrected result to
// our own deployed devnet truth-oracle program, cross-linked to TxLINE's mainnet
// daily_scores_roots root. The record is write-once and read back by lib/truth-oracle.ts.
//
//   node scripts/truth-commit.mjs <fid> [<fid> …]     # commit one or more fixtures
//   node scripts/truth-commit.mjs --dry <fid>         # off-chain only (no write)
//
// Reads TxLINE creds from .env.local (TXLINE_API_BASE/JWT/API_TOKEN) and the writer
// wallet (base58 secret) from ../Downloads/env.txt — the funded devnet account that
// signs + pays for the commit. No program deploy: the program is already live.
//
// The reconstruct()/commitment logic is inlined here (plain JS) so this script has no
// cross-product or .ts-import dependency; it mirrors Bootroom's lib/verify-truth +
// lib/truth-commit at ALGO_VERSION 1 (the on-chain program recomputes the commitment
// from the same canonical layout, so writer/verifier/chain agree byte-for-byte).
import { readFileSync } from "node:fs";
import { Connection, PublicKey, Keypair, SystemProgram, TransactionInstruction, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { sha256 } from "@noble/hashes/sha256";

// ── config ──────────────────────────────────────────────────────────────────
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim();
}
const BASE = process.env.TXLINE_API_BASE || "https://txline.txodds.com";
const JWT = process.env.TXLINE_JWT, TOK = process.env.TXLINE_API_TOKEN;
const HDRS = { Authorization: `Bearer ${JWT}`, "X-Api-Token": TOK };

const ALGO_VERSION = 1;
const COMMIT_TAG = "TRUTHv1";
const DAY_MS = 86_400_000;
const TRUTH_ORACLE_PROGRAM = new PublicKey(process.env.TRUTH_ORACLE_PROGRAM_ID || "7eX1xfHXNUvfdud26GuDaEhHdTUddjYhfGgs9a73iMF");
const TXLINE_MAINNET_PROGRAM = new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA");
const devnetConn = new Connection(process.env.TRUTH_ORACLE_RPC || "https://api.devnet.solana.com", "confirmed");
const mainnetConn = new Connection(process.env.TXORACLE_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");

function writerKeypair() {
  // env.txt is 3 raw lines; line 1 = the treasury wallet's base58 64-byte secret
  // (pubkey vRgXLq8h…, funded on devnet). Lines 2/3 are other creds — ignore them.
  const first = readFileSync(new URL("../../Downloads/env.txt", import.meta.url), "utf8")
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
  return Keypair.fromSecretKey(bs58.decode(first));
}

// ── verify-truth (inlined): parse feed → VAR-aware reconstruct ────────────────
function parseUpdates(text) {
  const recs = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { recs.push(JSON.parse(line.slice(5).trim())); } catch { /* skip */ }
  }
  recs.sort((a, b) => (a.Seq ?? 0) - (b.Seq ?? 0));
  return recs;
}

function reconstruct(recs) {
  let finished = false, finalSeq = null;
  let g1 = 0, g2 = 0, lastScoreG1 = null, lastScoreG2 = null, lastScoreSeq = -1, varApplied = false;
  let s1 = 0, s2 = 0;
  for (const x of recs) {
    if (typeof x.Seq === "number") finalSeq = x.Seq;
    if (x.Action === "game_finalised") finished = true;
    if (x.Action === "action_discarded") varApplied = true;
    if (x.Action === "var_end" && x.Data?.Outcome === "Overturned") varApplied = true;
    const sg1 = x.Score?.Participant1?.Total?.Goals;
    const sg2 = x.Score?.Participant2?.Total?.Goals;
    if (x.Score?.Participant1?.Total || x.Score?.Participant2?.Total) {
      const cur1 = sg1 ?? lastScoreG1 ?? 0;
      const cur2 = sg2 ?? lastScoreG2 ?? 0;
      g1 = Math.max(g1, cur1); g2 = Math.max(g2, cur2);
      if ((x.Seq ?? 0) >= lastScoreSeq) { lastScoreSeq = x.Seq ?? 0; lastScoreG1 = cur1; lastScoreG2 = cur2; }
    }
    if (typeof x.Stats?.["1"] === "number") s1 = Math.max(s1, x.Stats["1"]);
    if (typeof x.Stats?.["2"] === "number") s2 = Math.max(s2, x.Stats["2"]);
  }
  if (varApplied && lastScoreG1 != null && lastScoreG2 != null) { g1 = lastScoreG1; g2 = lastScoreG2; }
  const truth = { p1: g1, p2: g2 };
  const anchored = { p1: Math.max(s1, 0), p2: Math.max(s2, 0) };
  const winner = g1 > g2 ? "p1" : g2 > g1 ? "p2" : "draw";
  const diverges = truth.p1 !== anchored.p1 || truth.p2 !== anchored.p2;
  return { finished, truth, anchored, winner, varApplied, diverges, finalSeq };
}

// ── truth-commit (inlined): canonical projection, digest, commitment ──────────
function canonicalProjection(recs) {
  const f = (v) => (v === undefined || v === null ? "" : String(v));
  return [...recs]
    .sort((a, b) => (a.Seq ?? 0) - (b.Seq ?? 0))
    .map((x) => [
      f(x.Seq), f(x.Ts), x.Action ?? "", x.Data?.Outcome ?? "", f(x.Clock?.Seconds),
      f(x.Score?.Participant1?.Total?.Goals), f(x.Score?.Participant2?.Total?.Goals),
      f(x.Stats?.["1"]), f(x.Stats?.["2"]),
    ].join("|"))
    .join("\n");
}
const inputDigest = (rawText) => Buffer.from(sha256(Buffer.from(canonicalProjection(parseUpdates(rawText)), "utf8")));
const deriveWinner = (p1, p2) => (p1 > p2 ? 0 : p2 > p1 ? 1 : 2);
const deriveDiverges = (t1, t2, a1, a2) => t1 !== a1 || t2 !== a2;

function commitmentPreimage(fx) {
  const winner = deriveWinner(fx.truthP1, fx.truthP2);
  const diverges = deriveDiverges(fx.truthP1, fx.truthP2, fx.anchoredP1, fx.anchoredP2) ? 1 : 0;
  const head = Buffer.alloc(7 + 2 + 8 + 4);
  Buffer.from(COMMIT_TAG, "utf8").copy(head, 0);
  head.writeUInt16LE(fx.algoVersion, 7);
  head.writeBigInt64LE(fx.fixtureId, 9);
  head.writeUInt32LE(fx.finalSeq, 17);
  const flags = Buffer.from([fx.truthP1, fx.truthP2, fx.anchoredP1, fx.anchoredP2, winner, fx.varApplied ? 1 : 0, diverges]);
  return Buffer.concat([head, fx.inputDigest, flags, fx.txlineRootPda, fx.txlineRootHash]);
}
const commitment = (fx) => Buffer.from(sha256(commitmentPreimage(fx)));

// ── TxLINE mainnet root cross-link ────────────────────────────────────────────
async function statValidation(fid, seq, key) {
  const r = await fetch(`${BASE}/api/scores/stat-validation?fixtureId=${fid}&seq=${seq}&statKey=${key}`, { headers: HDRS, cache: "no-store" });
  if (!r.ok) return null;
  const b = await r.json();
  return b?.statToProve ? b : null;
}
async function readTxlineRoot(fid, finalSeq) {
  const bundle = await statValidation(fid, finalSeq, 1);
  const minTs = bundle?.summary?.updateStats?.minTimestamp;
  if (typeof minTs !== "number") throw new Error("stat-validation unavailable (root not posted yet)");
  const epochDay = Math.floor(minTs / DAY_MS);
  const day = Buffer.alloc(2); day.writeUInt16LE(epochDay, 0);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), day], TXLINE_MAINNET_PROGRAM);
  const info = await mainnetConn.getAccountInfo(pda);
  if (!info) throw new Error(`TxLINE daily_scores_roots PDA ${pda.toBase58()} not found on mainnet (epochDay ${epochDay})`);
  return { pda, hash: Buffer.from(sha256(info.data)), epochDay };
}

async function buildFields(fid) {
  const text = await (await fetch(`${BASE}/api/scores/updates/${fid}`, { headers: HDRS, cache: "no-store" })).text();
  const r = reconstruct(parseUpdates(text));
  if (r.finalSeq == null) throw new Error("no final seq in feed");
  const root = await readTxlineRoot(fid, r.finalSeq);
  const fields = {
    algoVersion: ALGO_VERSION, fixtureId: BigInt(fid), finalSeq: r.finalSeq, inputDigest: inputDigest(text),
    truthP1: r.truth.p1, truthP2: r.truth.p2, anchoredP1: r.anchored.p1, anchoredP2: r.anchored.p2,
    varApplied: r.varApplied, txlineRootPda: root.pda.toBuffer(), txlineRootHash: root.hash,
  };
  return { fields, truth: r, root };
}

// ── our devnet program: PDA + commit_truth instruction ────────────────────────
const disc = (s) => Buffer.from(sha256(new TextEncoder().encode(s))).subarray(0, 8);
function recordPda(fid) {
  const fidLe = Buffer.alloc(8); fidLe.writeBigInt64LE(BigInt(fid), 0);
  const verLe = Buffer.alloc(2); verLe.writeUInt16LE(ALGO_VERSION, 0);
  return PublicKey.findProgramAddressSync([Buffer.from("truth"), fidLe, verLe], TRUTH_ORACLE_PROGRAM)[0];
}
function encodeArgs(f) {
  const b = Buffer.alloc(8 + 2 + 4 + 32 + 4 + 1 + 32 + 32); let o = 0;
  b.writeBigInt64LE(f.fixtureId, o); o += 8;
  b.writeUInt16LE(f.algoVersion, o); o += 2;
  b.writeUInt32LE(f.finalSeq, o); o += 4;
  f.inputDigest.copy(b, o); o += 32;
  b[o++] = f.truthP1; b[o++] = f.truthP2; b[o++] = f.anchoredP1; b[o++] = f.anchoredP2;
  b[o++] = f.varApplied ? 1 : 0;
  f.txlineRootPda.copy(b, o); o += 32;
  f.txlineRootHash.copy(b, o); o += 32;
  return b;
}
async function sendCommit(f) {
  const authority = writerKeypair();
  const pda = recordPda(Number(f.fixtureId));
  const data = Buffer.concat([disc("global:commit_truth"), encodeArgs(f)]);
  const ix = new TransactionInstruction({
    programId: TRUTH_ORACLE_PROGRAM,
    keys: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const sig = await sendAndConfirmTransaction(devnetConn, new Transaction().add(ix), [authority], { commitment: "confirmed" });
  return { sig, pda };
}

// ── main ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const fids = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (!fids.length) { console.error("usage: node scripts/truth-commit.mjs [--dry] <fid> [<fid> …]"); process.exit(1); }

if (!dry) {
  const bal = await devnetConn.getBalance(writerKeypair().publicKey);
  console.log(`writer ${writerKeypair().publicKey.toBase58()} — devnet ${(bal / 1e9).toFixed(4)} SOL`);
  if (bal === 0) { console.error("ABORT: writer has 0 devnet SOL"); process.exit(1); }
}

for (const fid of fids) {
  try {
    const { fields, truth, root } = await buildFields(fid);
    console.log(`\nfid ${fid}: TRUTH ${fields.truthP1}-${fields.truthP2} (${truth.winner}) | ANCHORED ${fields.anchoredP1}-${fields.anchoredP2} | diverges=${truth.diverges} var=${truth.varApplied}`);
    console.log(`  root(mainnet day ${root.epochDay}) ${root.pda.toBase58().slice(0, 12)}… commitment ${commitment(fields).toString("hex").slice(0, 24)}…`);
    const pda = recordPda(fid);
    const existing = await devnetConn.getAccountInfo(pda);
    if (existing) { console.log(`  record already exists at ${pda.toBase58()} (write-once) — skip`); continue; }
    if (dry) { console.log(`  [dry] would commit → ${pda.toBase58()}`); continue; }
    const { sig } = await sendCommit(fields);
    console.log(`  ✅ landed ${sig}`);
    console.log(`     tx     https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    console.log(`     record https://explorer.solana.com/address/${pda.toBase58()}?cluster=devnet`);
  } catch (e) {
    console.error(`  ✗ ${fid}: ${String(e?.message ?? e).slice(0, 160)}`);
  }
}
