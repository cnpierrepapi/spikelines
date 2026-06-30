// Issues a short-lived, tamper-proof nonce for the wallet-ownership handshake.
// Stateless: the nonce carries its own expiry + an HMAC signed with a server
// secret, so /api/wallet/link can verify we issued it without a DB round-trip.
import { createHmac, randomBytes } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTL_MS = 5 * 60 * 1000; // 5 minutes to connect + sign

export function nonceSecret(): string {
  return process.env.WALLET_NONCE_SECRET || "spikelines-dev-nonce-secret-change-me";
}
export function signNonce(body: string): string {
  return createHmac("sha256", nonceSecret()).update(body).digest("base64url");
}

export async function GET() {
  const rand = randomBytes(16).toString("base64url");
  const exp = Date.now() + TTL_MS;
  const body = `${rand}.${exp}`;
  const nonce = `${body}.${signNonce(body)}`;
  return Response.json({ nonce });
}
