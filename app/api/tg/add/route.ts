// Write-back for the Telegram Mini App: when a player earns or spends SPIKES while
// playing solo in the app, push the delta to their server balance so chat and app
// stay in sync. Verified by initData (same trust as /api/tg/me). Read-modify-write,
// matching the bot's own settlement path (concurrent solo + group play is rare).
import { verifyInitData } from "@/lib/telegram-initdata";
import { supaGet, supaPatch, supaReady } from "@/lib/supa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!supaReady()) return Response.json({ ok: false, error: "not configured" }, { status: 503 });
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
  const body = await request.json().catch(() => ({}));
  const u = verifyInitData(body?.initData ?? "", token);
  if (!u) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const delta = Math.trunc(Number(body?.delta));
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100_000) {
    return Response.json({ ok: false, error: "bad delta" }, { status: 400 });
  }

  const rows = await supaGet<{ spikes: number }[]>(`tg_users?tg_id=eq.${u.id}&select=spikes`);
  const cur = rows?.[0]?.spikes ?? 0;
  const next = Math.max(0, cur + delta);
  await supaPatch(`tg_users?tg_id=eq.${u.id}`, { spikes: next, updated_at: new Date().toISOString() });
  return Response.json({ ok: true, spikes: next });
}
