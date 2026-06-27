// Loads the Solana keypair from the path in TXLINE_KEYPAIR_PATH.
// Supports base58 (Phantom export) and JSON-array (solana-cli) formats.
// Never logs the secret.
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export function loadKeypair() {
  const path = process.env.TXLINE_KEYPAIR_PATH;
  if (!path) {
    throw new Error(
      "TXLINE_KEYPAIR_PATH not set — run scripts with: node --env-file=.env <script>"
    );
  }
  const raw = readFileSync(path, "utf8").trim();
  const bytes = raw.startsWith("[")
    ? Uint8Array.from(JSON.parse(raw))
    : bs58.decode(raw);
  return bytes.length === 64
    ? Keypair.fromSecretKey(bytes)
    : Keypair.fromSeed(bytes);
}
