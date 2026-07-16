// Verify a Telegram Mini App `initData` string server-side. Telegram signs it with
// the bot token, so a valid HMAC proves the request really came from our bot's Web
// App for that user — no separate login needed. Never trust initDataUnsafe on the
// client; always verify here.
import crypto from "node:crypto";

export type TgInitUser = { id: number; username?: string; first_name?: string };

export function verifyInitData(initData: string, botToken: string, maxAgeSec = 86_400): TgInitUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // data_check_string = "key=value" for every remaining field, sorted by key, \n-joined.
  const dcs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("\n");

  // secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token); then HMAC the dcs with it.
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secret).update(dcs).digest("hex");

  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Reject stale payloads (replay protection).
  const authDate = Number(params.get("auth_date") || 0);
  if (authDate && Date.now() / 1000 - authDate > maxAgeSec) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user || typeof user.id !== "number") return null;
    return { id: user.id, username: user.username, first_name: user.first_name };
  } catch {
    return null;
  }
}
