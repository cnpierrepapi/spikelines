// High-level TxLINE client: handles subscribe -> activate -> token cache, and
// exposes scores/odds streams. The single module the app sits on top of.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection } from "@solana/web3.js";
import nacl from "tweetnacl";
import { loadKeypair } from "./wallet.mjs";
import { guestStart, activate } from "./auth.mjs";
import { subscribe } from "./subscribe.mjs";
import { openStream } from "./stream.mjs";
import { cfg, CLUSTER, SELECTED_LEAGUES } from "./config.mjs";

const CACHE = `.txline-cache.${CLUSTER}.json`;

async function ensureDevnetFunds(keypair) {
  if (CLUSTER !== "devnet") return;
  const conn = new Connection(cfg.rpc, "confirmed");
  const bal = await conn.getBalance(keypair.publicKey);
  if (bal >= 0.05e9) return;
  try {
    const sig = await conn.requestAirdrop(keypair.publicKey, 1e9);
    await conn.confirmTransaction(sig, "confirmed");
    console.log("Airdropped 1 devnet SOL.");
  } catch {
    console.warn(
      `Airdrop failed (devnet faucet rate-limited). Fund manually at https://faucet.solana.com — address: ${keypair.publicKey.toBase58()}`
    );
  }
}

export async function getApiToken({ force = false } = {}) {
  if (!force && existsSync(CACHE)) {
    const c = JSON.parse(readFileSync(CACHE, "utf8"));
    // JWT lasts 30 days; refresh well before that.
    const ageDays = (Date.now() - (c.ts || 0)) / 86_400_000;
    if (c.apiToken && c.jwt && ageDays < 25) return c;
  }

  const keypair = loadKeypair();
  await ensureDevnetFunds(keypair);

  const jwt = await guestStart();
  const txSig = await subscribe(keypair);

  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const sigBytes = nacl.sign.detached(new TextEncoder().encode(messageString), keypair.secretKey);
  const walletSignature = Buffer.from(sigBytes).toString("base64");

  const apiToken = await activate({ txSig, walletSignature, leagues: SELECTED_LEAGUES, jwt });

  const out = { jwt, apiToken, txSig, cluster: CLUSTER, ts: Date.now() };
  writeFileSync(CACHE, JSON.stringify(out, null, 2));
  return out;
}

export async function streamScores(onEvent) {
  const { jwt, apiToken } = await getApiToken();
  return openStream("/api/scores/stream", { jwt, apiToken, onEvent });
}

export async function streamOdds(onEvent) {
  const { jwt, apiToken } = await getApiToken();
  return openStream("/api/odds/stream", { jwt, apiToken, onEvent });
}
