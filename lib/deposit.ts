// Client-side USDC deposit for SPIKE packs (devnet). Builds an SPL-token
// transfer from the connected wallet's USDC account to the treasury's, has the
// wallet sign+send it, and returns the signature. The server then verifies that
// signature on-chain before crediting SPIKES — the client is never trusted.
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { USDC_DECIMALS, packBaseUnits, type Pack } from "./packs";
import type { WalletName } from "./wallet";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TREASURY = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || "";

type SendProvider = {
  publicKey?: { toString(): string } | null;
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>;
};

function provider(name: WalletName): SendProvider {
  const w = window as unknown as {
    phantom?: { solana?: SendProvider };
    solana?: SendProvider & { isPhantom?: boolean };
    solflare?: SendProvider;
    backpack?: SendProvider;
  };
  const p = name === "Phantom" ? (w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : undefined))
    : name === "Solflare" ? w.solflare
    : w.backpack;
  if (!p) throw new Error(`${name} isn't available`);
  return p;
}

// Send the pack's USDC to the treasury. Returns the confirmed tx signature.
export async function payForPack(name: WalletName, pack: Pack): Promise<string> {
  if (!TREASURY) throw new Error("treasury not configured");
  const conn = new Connection(RPC, "confirmed");
  const p = provider(name);
  const res = await p.connect();
  const buyer = new PublicKey(res.publicKey.toString());
  const mint = new PublicKey(USDC_MINT);
  const treasury = new PublicKey(TREASURY);

  const buyerAta = await getAssociatedTokenAddress(mint, buyer);
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury);

  const tx = new Transaction();
  // Create the treasury's USDC account on first ever deposit (buyer pays rent).
  try {
    await getAccount(conn, treasuryAta);
  } catch {
    tx.add(createAssociatedTokenAccountInstruction(buyer, treasuryAta, treasury, mint));
  }
  tx.add(
    createTransferCheckedInstruction(buyerAta, mint, treasuryAta, buyer, packBaseUnits(pack), USDC_DECIMALS)
  );
  tx.feePayer = buyer;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;

  const { signature } = await p.signAndSendTransaction(tx);
  await conn.confirmTransaction(signature, "confirmed");
  return signature;
}
