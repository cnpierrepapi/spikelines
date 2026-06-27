// TxLINE client config. Cluster-aware: the shipped IDL is mainnet, so devnet
// needs explicit program-id + mint overrides (from documentation/programs/addresses.md).
import { PublicKey } from "@solana/web3.js";

export const CLUSTER = process.env.CLUSTER || "devnet";

const CFG = {
  devnet: {
    rpc: process.env.RPC_URL || "https://api.devnet.solana.com",
    programId: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
    txlineMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
    usdtMint: new PublicKey("ELWTKspHKCnCfCiCiqYw1EDH77k8VCP74dK9qytG2Ujh"),
    apiBase: process.env.API_BASE || "https://txline-dev.txodds.com",
    explorerCluster: "devnet",
  },
  mainnet: {
    rpc: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
    programId: new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
    txlineMint: new PublicKey("Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL"),
    usdtMint: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    apiBase: process.env.API_BASE || "https://txline.txodds.com",
    explorerCluster: "mainnet-beta",
  },
};

if (!CFG[CLUSTER]) throw new Error(`Unknown CLUSTER "${CLUSTER}" (use devnet|mainnet)`);
export const cfg = CFG[CLUSTER];

// Service level → a pricing-matrix rowId. DEVNET has only rowId 1 (0 tokens,
// sampling 0 = real-time, free). MAINNET free WC: 1 = 60s delay, 12 = real-time.
export const SERVICE_LEVEL = Number(process.env.SERVICE_LEVEL || (CLUSTER === "devnet" ? 1 : 12));
export const DURATION_WEEKS = Number(process.env.DURATION_WEEKS || 4);
export const SELECTED_LEAGUES = []; // empty = standard bundle (World Cup + Int Friendlies)
