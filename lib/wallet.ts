// Multi-wallet connect + message-sign for Spikelines (Phantom / Solflare /
// Backpack via their injected providers — no heavy wallet-adapter stack).
//
// Two jobs:
//   1. connect() → the user's Solana address (for deposits + payout target).
//   2. signOwnership() → a signature over a server nonce proving the user
//      actually CONTROLS that address (so a payout can't be claimed for a
//      wallet you don't own). Verified server-side with tweetnacl.
import bs58 from "bs58";

export type WalletName = "Phantom" | "Solflare" | "Backpack";

type Provider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  publicKey?: { toString(): string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect?: () => Promise<void>;
  signMessage: (msg: Uint8Array, display?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
};

type W = Window & {
  phantom?: { solana?: Provider };
  solana?: Provider;
  solflare?: Provider;
  backpack?: Provider;
};

// Which wallets are actually installed right now.
export function detectWallets(): WalletName[] {
  if (typeof window === "undefined") return [];
  const w = window as W;
  const out: WalletName[] = [];
  if (w.phantom?.solana?.isPhantom || w.solana?.isPhantom) out.push("Phantom");
  if (w.solflare?.isSolflare) out.push("Solflare");
  if (w.backpack?.isBackpack) out.push("Backpack");
  return out;
}

function providerFor(name: WalletName): Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as W;
  if (name === "Phantom") return w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : undefined);
  if (name === "Solflare") return w.solflare;
  if (name === "Backpack") return w.backpack;
  return undefined;
}

const INSTALL: Record<WalletName, string> = {
  Phantom: "https://phantom.app/download",
  Solflare: "https://solflare.com/download",
  Backpack: "https://backpack.app/download",
};

export type Connected = { name: WalletName; address: string };

// Connect a specific wallet. Throws with a friendly message if it's missing.
export async function connectWallet(name: WalletName): Promise<Connected> {
  const p = providerFor(name);
  if (!p) throw new Error(`${name} isn't installed — get it at ${INSTALL[name]}`);
  const res = await p.connect();
  const address = res.publicKey.toString();
  return { name, address };
}

// Ask the wallet to sign an arbitrary UTF-8 message; returns a base58 signature.
export async function signMessage(name: WalletName, message: string): Promise<string> {
  const p = providerFor(name);
  if (!p) throw new Error(`${name} isn't available`);
  const encoded = new TextEncoder().encode(message);
  const out = await p.signMessage(encoded, "utf8");
  const sig = out instanceof Uint8Array ? out : out.signature;
  return bs58.encode(sig);
}

// Full ownership handshake: fetch a nonce, sign the canonical message, return
// everything the server needs to verify. The signed text is reconstructed
// server-side from {address, nonce}, so it can't be tampered with.
export function ownershipMessage(address: string, nonce: string): string {
  return `Spikelines — verify wallet ownership to receive rewards.\n\nWallet: ${address}\nNonce: ${nonce}`;
}
