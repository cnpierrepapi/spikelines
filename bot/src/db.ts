import { createClient } from "@supabase/supabase-js";
import { env } from "./env.ts";
import { randomHandle } from "./handle.ts";

// Service-role client: bypasses RLS on the tg_ tables. Server-only key — this
// process runs on the box, never in a browser.
export const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type TgUser = {
  tg_id: number;
  handle: string;
  username: string | null;
  first_name: string | null;
  spikes: number;
  wallet: string | null;
  streak: number;
  best_streak: number;
  calls: number;
  correct: number;
};

export async function getUser(tgId: number): Promise<TgUser | null> {
  const { data, error } = await supa.from("tg_users").select("*").eq("tg_id", tgId).maybeSingle();
  if (error) throw error;
  return (data as TgUser) ?? null;
}

// Create the player on first contact (starts at 0 SPIKES, matching the web app —
// SPIKES are earned by playing, not granted). Idempotent: returns the existing row
// if they've started before, only refreshing their Telegram display fields.
export async function ensureUser(tgId: number, opts: { username?: string; firstName?: string }): Promise<TgUser> {
  const existing = await getUser(tgId);
  if (existing) {
    await supa.from("tg_users")
      .update({ username: opts.username ?? existing.username, first_name: opts.firstName ?? existing.first_name, updated_at: new Date().toISOString() })
      .eq("tg_id", tgId);
    return existing;
  }
  const { data, error } = await supa.from("tg_users")
    .insert({ tg_id: tgId, handle: randomHandle(), username: opts.username ?? null, first_name: opts.firstName ?? null, spikes: 0 })
    .select("*").single();
  if (error) throw error;
  return data as TgUser;
}

// Register / refresh a chat the bot serves (DM or group) so the watcher knows
// where to fan calls out. active=true on every touch; a later my_chat_member
// "kicked" update will flip it false.
export async function upsertChat(chatId: number, type: string, title: string | null): Promise<void> {
  const { error } = await supa.from("tg_chats")
    .upsert({ chat_id: chatId, type, title, active: true, updated_at: new Date().toISOString() }, { onConflict: "chat_id" });
  if (error) throw error;
}

export async function setChatActive(chatId: number, active: boolean): Promise<void> {
  await supa.from("tg_chats").update({ active, updated_at: new Date().toISOString() }).eq("chat_id", chatId);
}

export async function setChatQuiet(chatId: number, quiet: boolean): Promise<void> {
  await supa.from("tg_chats").update({ quiet, updated_at: new Date().toISOString() }).eq("chat_id", chatId);
}

// Per-group leaderboard rows, ranked. Empty until the group has played calls.
export async function groupTop(chatId: number, limit = 10): Promise<{ tg_id: number; correct: number; total: number; streak: number }[]> {
  const { data, error } = await supa.from("tg_group_scores")
    .select("tg_id, correct, total, streak")
    .eq("chat_id", chatId)
    .order("correct", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as any[]) ?? [];
}
