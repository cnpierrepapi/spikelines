// TxLINE off-chain auth: guest JWT -> wallet-signed activation -> API token.
import { cfg } from "./config.mjs";

export async function guestStart() {
  const r = await fetch(`${cfg.apiBase}/auth/guest/start`, { method: "POST" });
  if (!r.ok) throw new Error(`guest/start ${r.status}: ${await r.text().catch(() => "")}`);
  const j = await r.json();
  return j.token;
}

export async function activate({ txSig, walletSignature, leagues, jwt }) {
  const r = await fetch(`${cfg.apiBase}/api/token/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ txSig, walletSignature, leagues }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`token/activate ${r.status}: ${text}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return data.token || data;
}
