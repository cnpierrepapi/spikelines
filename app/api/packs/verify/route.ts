// Verifies a SPIKE-pack purchase ON-CHAIN before crediting SPIKES. The client
// sends a tx signature; we pull the tx from devnet and confirm a USDC transfer
// of at least the pack price landed in the treasury. The deposit signature is a
// primary key in the ledger, so a replayed signature can never double-credit.
import { Connection } from "@solana/web3.js";
import { packById, packBaseUnits } from "@/lib/packs";
import { supaReady, supaUpsert, supaRpc, supaGet } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC || "https://api.devnet.solana.com";
const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT || "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const TREASURY = process.env.TREASURY_ADDRESS || process.env.NEXT_PUBLIC_TREASURY_ADDRESS || "";

export async function POST(req: Request) {
  let b: { signature?: string; device_id?: string; packId?: string; username?: string; wallet?: string };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const { signature, device_id, packId, username = "", wallet = "" } = b;
  if (!signature || !device_id || !packId) return Response.json({ ok: false, error: "missing fields" }, { status: 400 });
  const pack = packById(packId);
  if (!pack) return Response.json({ ok: false, error: "unknown pack" }, { status: 400 });
  if (!supaReady()) return Response.json({ ok: false, error: "backend not configured" }, { status: 503 });
  if (!TREASURY) return Response.json({ ok: false, error: "treasury not configured" }, { status: 503 });

  // 1) Confirm the on-chain USDC transfer into the treasury.
  const conn = new Connection(RPC, "confirmed");
  const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx || tx.meta?.err) return Response.json({ ok: false, error: "tx not found or failed" }, { status: 400 });
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const treasuryPost = post.find((x) => x.mint === USDC_MINT && x.owner === TREASURY);
  if (!treasuryPost) return Response.json({ ok: false, error: "no USDC transfer to treasury in this tx" }, { status: 400 });
  const preAmt = Number(pre.find((x) => x.mint === USDC_MINT && x.owner === TREASURY)?.uiTokenAmount.amount ?? 0);
  const delta = Number(treasuryPost.uiTokenAmount.amount) - preAmt;
  if (delta < packBaseUnits(pack)) return Response.json({ ok: false, error: "transfer amount below pack price" }, { status: 400 });

  // 2) Idempotent ledger insert — empty result means this signature already
  //    credited, so we must NOT credit again.
  const inserted = await supaUpsert<unknown[]>(
    "spk_deposits",
    { signature, device_id, wallet: wallet || null, usdc: pack.usdc, spikes: pack.spikes },
    { onConflict: "signature", ignoreDuplicates: true }
  );
  if (Array.isArray(inserted) && inserted.length === 0) {
    const rows = await supaGet<{ spikes: number }[]>(`spk_players?device_id=eq.${device_id}&select=spikes`);
    return Response.json({ ok: true, already: true, spikes: pack.spikes, balance: rows[0]?.spikes ?? null });
  }

  // 3) Atomically credit SPIKES, return the new authoritative balance.
  const balance = await supaRpc<number>("spk_credit_spikes", {
    p_device: device_id, p_username: username, p_wallet: wallet, p_spikes: pack.spikes,
  });
  return Response.json({ ok: true, spikes: pack.spikes, balance });
}
