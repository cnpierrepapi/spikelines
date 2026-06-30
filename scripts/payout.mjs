// Reward payout runner — the single wallet script that settles withdrawals.
//
//   node scripts/payout.mjs          # pay every pending payout
//   node scripts/payout.mjs --dry    # show what WOULD be paid, send nothing
//
// Pulls status='pending' rows from spk_payouts, sends devnet USDC from the
// treasury to each player's verified wallet, then marks the row paid (+sig) or
// failed (+error). Idempotent: a paid row is never re-sent. Treasury secret is
// read from .env.local and never leaves this machine.
import fs from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, createTransferCheckedInstruction } from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

// --- minimal .env.local loader (no dotenv dep) ---
const envPath = path.join(process.cwd(), ".env.local");
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const SUPABASE_URL = env.SUPABASE_URL || "https://mohbmvajroqizlfaarjk.supabase.co";
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const RPC = env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
const USDC_MINT = new PublicKey(env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const USDC_DECIMALS = 6;
const DRY = process.argv.includes("--dry");

if (!SERVICE_KEY) { console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }
if (!env.TREASURY_SECRET_KEY) { console.error("Missing TREASURY_SECRET_KEY in .env.local"); process.exit(1); }

const treasury = Keypair.fromSecretKey(bs58.decode(env.TREASURY_SECRET_KEY));
const conn = new Connection(RPC, "confirmed");

const rest = (q, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${q}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
});

async function markPaid(id, signature) {
  await rest(`spk_payouts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "paid", signature, paid_at: new Date().toISOString() }) });
}
async function markFailed(id, error) {
  await rest(`spk_payouts?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "failed", error: String(error).slice(0, 300) }) });
}

async function payOne(row) {
  const recipient = new PublicKey(row.wallet);
  const amount = Math.round(Number(row.usdc) * 10 ** USDC_DECIMALS);
  const src = await getOrCreateAssociatedTokenAccount(conn, treasury, USDC_MINT, treasury.publicKey);
  const dst = await getOrCreateAssociatedTokenAccount(conn, treasury, USDC_MINT, recipient);
  const tx = new Transaction().add(
    createTransferCheckedInstruction(src.address, USDC_MINT, dst.address, treasury.publicKey, amount, USDC_DECIMALS)
  );
  return sendAndConfirmTransaction(conn, tx, [treasury], { commitment: "confirmed" });
}

async function main() {
  console.log(`Treasury: ${treasury.publicKey.toBase58()}  (${DRY ? "DRY RUN" : "LIVE"}) RPC=${RPC}`);
  const pending = await rest("spk_payouts?status=eq.pending&order=created_at.asc&select=id,device_id,wallet,usdc").then((r) => r.json());
  if (!pending.length) { console.log("No pending payouts."); return; }
  console.log(`${pending.length} pending payout(s), total $${pending.reduce((s, r) => s + Number(r.usdc), 0).toFixed(2)} USDC`);

  for (const row of pending) {
    process.stdout.write(`  #${row.id} → ${row.wallet.slice(0, 6)}… $${row.usdc} … `);
    if (DRY) { console.log("(dry)"); continue; }
    try {
      const sig = await payOne(row);
      await markPaid(row.id, sig);
      console.log(`paid ✓ ${sig}`);
    } catch (e) {
      await markFailed(row.id, e?.message || e);
      console.log(`FAILED ✕ ${e?.message || e}`);
    }
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
