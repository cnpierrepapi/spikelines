// Standalone debug: run the validate_stat view for one real stat and print the
// FULL error (message + program logs + stack), which the app's classify() hides.
import { readFileSync } from "node:fs";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";
const { AnchorProvider, Program, BN } = anchor;

// minimal .env.local loader
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const BASE = process.env.TXLINE_API_BASE || "https://txline-dev.txodds.com";
const JWT = process.env.TXLINE_JWT, TOK = process.env.TXLINE_API_TOKEN;
const PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const RPC = "https://api.devnet.solana.com";

const idl = JSON.parse(readFileSync(new URL("../lib/txline/idl/txoracle.json", import.meta.url), "utf8"));
idl.address = PROGRAM_ID.toBase58();
const vs = idl.instructions.find((i) => i.name === "validate_stat");
if (vs && !vs.returns) vs.returns = "bool";

const fid = 18172280, seq = 815, statKey = 1;
const res = await fetch(`${BASE}/api/scores/stat-validation?fixtureId=${fid}&seq=${seq}&statKey=${statKey}`, {
  headers: { Authorization: `Bearer ${JWT}`, "X-Api-Token": TOK },
});
const b = await res.json();
console.log("stat-validation HTTP", res.status, "value=", b.statToProve?.value, "key=", b.statToProve?.key, "period=", b.statToProve?.period);
console.log("eventStatRoot type:", Array.isArray(b.eventStatRoot) ? `array[${b.eventStatRoot.length}]` : typeof b.eventStatRoot);
console.log("subTreeProof len:", b.subTreeProof?.length, "mainTreeProof len:", b.mainTreeProof?.length, "statProof len:", b.statProof?.length);

const toBytes = (v) => (Array.isArray(v) ? v : Array.from(Buffer.from(v, "base64")));
const toNodes = (ns) => ns.map((n) => ({ hash: toBytes(n.hash), isRightSibling: n.isRightSibling }));

const conn = new Connection(RPC, "confirmed");
const wallet = { publicKey: Keypair.generate().publicKey, signTransaction: async (t) => t, signAllTransactions: async (t) => t };
const provider = new AnchorProvider(conn, wallet, { commitment: "confirmed" });
const program = new Program(idl, provider);

const epochDay = Math.floor(b.summary.updateStats.minTimestamp / 86_400_000);
const day = Buffer.alloc(2); day.writeUInt16LE(epochDay, 0);
const [pda] = PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), day], PROGRAM_ID);
console.log("epochDay", epochDay, "pda", pda.toBase58());
const acct = await conn.getAccountInfo(pda);
console.log("PDA account exists:", !!acct, "owner:", acct?.owner?.toBase58(), "dataLen:", acct?.data?.length);

const statA = { statToProve: { key: b.statToProve.key, value: b.statToProve.value, period: b.statToProve.period }, eventStatRoot: toBytes(b.eventStatRoot), statProof: toNodes(b.statProof) };
const fixtureSummary = { fixtureId: new BN(b.summary.fixtureId), updateStats: { updateCount: b.summary.updateStats.updateCount, minTimestamp: new BN(b.summary.updateStats.minTimestamp), maxTimestamp: new BN(b.summary.updateStats.maxTimestamp) }, eventsSubTreeRoot: toBytes(b.summary.eventStatsSubTreeRoot) };
const predicate = { threshold: b.statToProve.value, comparison: { equalTo: {} } };

try {
  const out = await program.methods
    .validateStat(new BN(b.ts), fixtureSummary, toNodes(b.subTreeProof), toNodes(b.mainTreeProof), predicate, statA, null, null)
    .accounts({ dailyScoresMerkleRoots: pda })
    .view();
  console.log("VIEW RESULT:", out);
} catch (e) {
  console.log("=== VIEW THREW ===");
  console.log("message:", JSON.stringify(e?.message));
  console.log("name:", e?.name);
  console.log("logs:", e?.logs);
  if (e?.simulationResponse) console.log("simResponse:", JSON.stringify(e.simulationResponse).slice(0, 800));
  console.log("stack:", String(e?.stack).slice(0, 600));
}
