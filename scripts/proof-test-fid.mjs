// Usage: node scripts/proof-test-fid.mjs <fixtureId> <statKey>
// Scans a spread of seqs for a fixture and reports validate_stat VIEW results.
import { readFileSync } from "node:fs";
import { Connection, PublicKey, Keypair, ComputeBudgetProgram } from "@solana/web3.js";
import bs58 from "bs58";
import anchor from "@coral-xyz/anchor";
const { AnchorProvider, Program, BN } = anchor;

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim();
}
const BASE = process.env.TXLINE_API_BASE || "https://txline-dev.txodds.com";
const JWT = process.env.TXLINE_JWT, TOK = process.env.TXLINE_API_TOKEN;
const SECRET = readFileSync(new URL("../../Downloads/env.txt", import.meta.url), "utf8").trim();
const PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const headers = { Authorization: `Bearer ${JWT}`, "X-Api-Token": TOK };
const fid = Number(process.argv[2] || 18172280);
const statKey = Number(process.argv[3] || 1);

const updTxt = await (await fetch(`${BASE}/api/scores/updates/${fid}`, { headers })).text();
const seqs = [];
for (const line of updTxt.split("\n")) { if (!line.startsWith("data:")) continue; try { const o = JSON.parse(line.slice(5).trim()); if (typeof o.Seq === "number") seqs.push(o.Seq); } catch {} }
const uniq = [...new Set(seqs)].sort((a, b) => a - b);
if (!uniq.length) { console.log(`fixture ${fid}: NO score updates`); process.exit(0); }
const pick = [0.3, 0.5, 0.7, 0.9, 0.99].map((p) => uniq[Math.floor(uniq.length * p)]);
console.log(`fixture ${fid} statKey ${statKey}: ${uniq.length} recs · seqs ${pick.join(", ")}`);

const idl = JSON.parse(readFileSync(new URL("../lib/txline/idl/txoracle.json", import.meta.url), "utf8"));
idl.address = PROGRAM_ID.toBase58();
const vs = idl.instructions.find((i) => i.name === "validate_stat"); if (vs && !vs.returns) vs.returns = "bool";
const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const sign = (tx) => { try { tx.partialSign(kp); } catch {} return tx; };
const program = new Program(idl, new AnchorProvider(conn, { publicKey: kp.publicKey, signTransaction: async (t) => sign(t), signAllTransactions: async (ts) => ts.map(sign) }, { commitment: "confirmed" }));
const toBytes = (v) => (Array.isArray(v) ? v : Array.from(Buffer.from(v, "base64")));
const toNodes = (ns) => ns.map((n) => ({ hash: toBytes(n.hash), isRightSibling: n.isRightSibling }));

async function viewOne(seq) {
  const b = await (await fetch(`${BASE}/api/scores/stat-validation?fixtureId=${fid}&seq=${seq}&statKey=${statKey}`, { headers })).json();
  if (!b?.statToProve) return console.log(`  seq ${seq}: no statToProve (${JSON.stringify(b).slice(0,80)})`);
  const minTs = b.summary.updateStats.minTimestamp;
  const epochDay = Math.floor(minTs / 86_400_000);
  const day = Buffer.alloc(2); day.writeUInt16LE(epochDay, 0);
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), day], PROGRAM_ID);
  const acct = await conn.getAccountInfo(pda);
  const statA = { statToProve: b.statToProve, eventStatRoot: toBytes(b.eventStatRoot), statProof: toNodes(b.statProof) };
  const fixtureSummary = { fixtureId: new BN(b.summary.fixtureId), updateStats: { updateCount: b.summary.updateStats.updateCount, minTimestamp: new BN(minTs), maxTimestamp: new BN(b.summary.updateStats.maxTimestamp) }, eventsSubTreeRoot: toBytes(b.summary.eventStatsSubTreeRoot) };
  const predicate = { threshold: b.statToProve.value, comparison: { equalTo: {} } };
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  try {
    const out = await program.methods.validateStat(new BN(minTs), fixtureSummary, toNodes(b.subTreeProof), toNodes(b.mainTreeProof), predicate, statA, null, null).accounts({ dailyScoresMerkleRoots: pda }).preInstructions([computeIx]).view();
    console.log(`  seq ${seq}: value=${b.statToProve.value} pda=${acct ? "exists" : "MISSING"} → VIEW=${out} ✅`);
  } catch (e) {
    const log = (e?.simulationResponse?.logs || []).find((l) => /Error Message:|Error Code:/.test(l)) || JSON.stringify(e?.simulationResponse?.err) || e?.message;
    console.log(`  seq ${seq}: value=${b.statToProve.value} pda=${acct ? "exists" : "MISSING"} → ${String(log).replace(/^Program log: /, "").slice(0, 110)}`);
  }
}
for (const s of pick) await viewOne(s);
