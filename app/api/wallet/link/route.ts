// Verifies wallet ownership: the user signed our nonce with their wallet key.
// Two checks: (1) the nonce is one we issued and hasn't expired (HMAC + exp),
// (2) the signature is valid for that address over the canonical message. No
// "paste an address" trust — only a real signature links a payout wallet.
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { signNonce } from "../nonce/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Must match lib/wallet.ts ownershipMessage().
function ownershipMessage(address: string, nonce: string): string {
  return `Spikelines — verify wallet ownership to receive rewards.\n\nWallet: ${address}\nNonce: ${nonce}`;
}

export async function POST(req: Request) {
  let body: { address?: string; nonce?: string; signature?: string };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const { address, nonce, signature } = body;
  if (!address || !nonce || !signature) return Response.json({ ok: false, error: "missing fields" }, { status: 400 });

  // 1) Nonce integrity + freshness.
  const parts = nonce.split(".");
  if (parts.length !== 3) return Response.json({ ok: false, error: "bad nonce" }, { status: 400 });
  const [rand, expStr, mac] = parts;
  if (signNonce(`${rand}.${expStr}`) !== mac) return Response.json({ ok: false, error: "nonce tampered" }, { status: 400 });
  if (Date.now() > Number(expStr)) return Response.json({ ok: false, error: "nonce expired" }, { status: 400 });

  // 2) Signature verifies for this address.
  let pubkeyBytes: Uint8Array;
  try { pubkeyBytes = new PublicKey(address).toBytes(); } catch { return Response.json({ ok: false, error: "bad address" }, { status: 400 }); }
  let sigBytes: Uint8Array;
  try { sigBytes = bs58.decode(signature); } catch { return Response.json({ ok: false, error: "bad signature" }, { status: 400 }); }
  const msgBytes = new TextEncoder().encode(ownershipMessage(address, nonce));

  const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pubkeyBytes);
  if (!valid) return Response.json({ ok: false, error: "signature does not match wallet" }, { status: 401 });

  return Response.json({ ok: true, address });
}
