// Admin session auth (server-only). An admin proves control of an allow-listed
// wallet by signing a nonce (verified in /api/admin/login); we then issue a
// short-lived HMAC bearer token that the other /api/admin/* routes check. No DB
// session table needed — the token carries its own address + expiry + MAC.
import { createHmac, timingSafeEqual } from "crypto";

const TTL_MS = 2 * 60 * 60 * 1000; // 2h admin session

function secret(): string {
  return process.env.ADMIN_SECRET || process.env.WALLET_NONCE_SECRET || "spikelines-dev-admin-secret-change-me";
}

// Must match the message signed client-side in /admin.
export function adminMessage(address: string, nonce: string): string {
  return `Spikelines ADMIN sign-in.\n\nWallet: ${address}\nNonce: ${nonce}`;
}

// ADMIN_WALLETS = comma-separated pubkeys. Empty → nobody is admin (safe default).
export function isAdminWallet(address: string): boolean {
  const list = (process.env.ADMIN_WALLETS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(address);
}

export function issueToken(address: string): string {
  const body = `${address}.${Date.now() + TTL_MS}`;
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

// Returns the admin address if the token is valid, fresh, and still allow-listed.
export function verifyToken(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [address, expStr, mac] = parts;
  const expected = createHmac("sha256", secret()).update(`${address}.${expStr}`).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() > Number(expStr)) return null;
  if (!isAdminWallet(address)) return null; // revoking access invalidates live tokens
  return address;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
