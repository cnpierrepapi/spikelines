// Telegram Mini App identity. The Web App posts its signed initData; we verify it
// with the bot token, then return (creating on first open) that Telegram user's
// server-side profile — handle + SPIKES balance + wallet — so the app shows the
// same identity and balance the player has in chat.
import { verifyInitData } from "@/lib/telegram-initdata";
import { randomHandle } from "@/lib/handle";
import { supaGet, supaUpsert, supaReady } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { tg_id: number; handle: string; spikes: number; wallet: string | null };

export async function POST(request: Request) {
  if (!supaReady()) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
  const { initData } = await request.json().catch(() => ({ initData: "" }));
  const u = verifyInitData(initData, token);
  if (!u) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const rows = await supaGet<Row[]>(`tg_users?tg_id=eq.${u.id}&select=tg_id,handle,spikes,wallet`);
  let row = rows?.[0];
  if (!row) {
    const created = await supaUpsert<Row[]>(
      "tg_users",
      { tg_id: u.id, handle: randomHandle(), username: u.username ?? null, first_name: u.first_name ?? null, spikes: 0 },
      { onConflict: "tg_id" }
    );
    row = Array.isArray(created) ? created[0] : (created as unknown as Row);
  }
  return Response.json({ ok: true, tg_id: row.tg_id, handle: row.handle, spikes: row.spikes, wallet: row.wallet ?? null });
}
