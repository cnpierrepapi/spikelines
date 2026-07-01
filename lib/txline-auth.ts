// Shared TxLINE guest-JWT minting for the game data feed. The durable credential
// is the apiToken; the guest JWT expires in ~30 days, so a STATIC env JWT silently
// breaks the whole feed when it lapses (or when someone deletes it — that's exactly
// what broke fixtures/live/archived on Jul 1; see feedback_data_feed_change_impact).
// Mint it per request instead, module-cached while the serverless instance stays
// warm so we're not hitting guest/start on every call.
let cached: { jwt: string; exp: number } | null = null;

export async function mintJwt(base?: string): Promise<string | null> {
  if (!base) return null;
  const now = Date.now();
  if (cached && cached.exp > now) return cached.jwt;
  try {
    const jwt = (await (await fetch(`${base}/auth/guest/start`, { method: "POST" })).json())?.token;
    if (!jwt) return cached?.jwt ?? null;
    cached = { jwt, exp: now + 20 * 86_400_000 }; // token lasts ~30d; refresh well before
    return jwt;
  } catch {
    return cached?.jwt ?? null; // network blip → reuse last good token if we have one
  }
}
