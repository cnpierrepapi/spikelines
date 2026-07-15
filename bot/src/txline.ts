import { mintJwt } from "../../lib/txline-auth.ts";

// Discovery reuses the deployed /api/live endpoint (which already applies the
// CompetitionId filter + drops finished matches), so the bot has one source of
// truth for "what's live" and no World-Cup-specific logic of its own.
export type LiveMatch = { fid: number; p1: string; p2: string; iso1: string; iso2: string };

const MINIAPP_URL = process.env.MINIAPP_URL || "https://spikelines.vercel.app";

export async function getLiveMatches(): Promise<LiveMatch[]> {
  try {
    const r = await fetch(`${MINIAPP_URL}/api/live`, { cache: "no-store" } as RequestInit);
    const j: any = await r.json();
    return Array.isArray(j?.matches) ? j.matches : [];
  } catch {
    return [];
  }
}

// Credentials the shared match feed (pollMatchOnce) needs to poll TxLINE directly.
export function txlineBase(): string | undefined {
  return process.env.TXLINE_API_BASE;
}
export function txlineToken(): string | undefined {
  return process.env.TXLINE_API_TOKEN;
}
export async function txlineJwt(): Promise<string | null> {
  return mintJwt(process.env.TXLINE_API_BASE);
}
