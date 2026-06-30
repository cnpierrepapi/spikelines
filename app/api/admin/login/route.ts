// Admin sign-in: verify the wallet is allow-listed AND that it signed our nonce,
// then issue a short-lived admin bearer token. Mirrors /api/wallet/link, but the
// signed message is the ADMIN message and the wallet must be in ADMIN_WALLETS.
import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { signNonce } from "../../wallet/nonce/route";
import { adminMessage, isAdminWallet, issueToken } from "@/lib/adminAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { address?: string; nonce?: string; signature?: string };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const { address, nonce, signature } = b;
  if (!address || !nonce || !signature) return Response.json({ ok: false, error: "missing fields" }, { status: 400 });
  if (!isAdminWallet(address)) return Response.json({ ok: false, error: "not an admin wallet" }, { status: 403 });

  // Nonce integrity + freshness (same scheme as wallet/link).
  const parts = nonce.split(".");
  if (parts.length !== 3) return Response.json({ ok: false, error: "bad nonce" }, { status: 400 });
  const [rand, expStr, mac] = parts;
  if (signNonce(`${rand}.${expStr}`) !== mac) return Response.json({ ok: false, error: "nonce tampered" }, { status: 400 });
  if (Date.now() > Number(expStr)) return Response.json({ ok: false, error: "nonce expired" }, { status: 400 });

  // Signature verifies for this address over the admin message.
  let pubkeyBytes: Uint8Array;
  try { pubkeyBytes = new PublicKey(address).toBytes(); } catch { return Response.json({ ok: false, error: "bad address" }, { status: 400 }); }
  let sigBytes: Uint8Array;
  try { sigBytes = bs58.decode(signature); } catch { return Response.json({ ok: false, error: "bad signature" }, { status: 400 }); }
  const msg = new TextEncoder().encode(adminMessage(address, nonce));
  if (!nacl.sign.detached.verify(msg, sigBytes, pubkeyBytes)) {
    return Response.json({ ok: false, error: "signature does not match wallet" }, { status: 401 });
  }

  return Response.json({ ok: true, token: issueToken(address), address });
}
