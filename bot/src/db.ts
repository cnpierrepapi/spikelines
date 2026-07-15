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

// ── calls ───────────────────────────────────────────────────────────
export type TgCall = {
  id: number; chat_id: number; message_id: number | null; fixture_id: number;
  match: string; market: string; side: 1 | 2; team: string; mins: number;
  open_sec: number; deadline_sec: number; base_ts: number | null; settle_ts: number | null;
  closes_at: string; status: string; result: string | null; mode: string;
};

export async function activeGroups(): Promise<{ chat_id: number }[]> {
  const { data, error } = await supa.from("tg_chats")
    .select("chat_id").eq("active", true).eq("quiet", false).in("type", ["group", "supergroup"]);
  if (error) throw error;
  return (data as any[]) ?? [];
}

// A chat can't get a new call while one is still live, nor within the cooldown of
// the last one — the two together keep a group from being flooded.
export async function hasBlockingCall(chatId: number, cooldownMs: number): Promise<boolean> {
  const { data, error } = await supa.from("tg_calls")
    .select("status, created_at").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  const last = (data as any[])?.[0];
  if (!last) return false;
  if (last.status === "open" || last.status === "locked") return true;
  return last.created_at > new Date(Date.now() - cooldownMs).toISOString();
}

export async function insertCall(row: Omit<TgCall, "id" | "message_id" | "settle_ts" | "result"> & { status: string }): Promise<number> {
  const { data, error } = await supa.from("tg_calls").insert(row).select("id").single();
  if (error) throw error;
  return (data as any).id as number;
}
export async function setCallMessage(id: number, messageId: number): Promise<void> {
  await supa.from("tg_calls").update({ message_id: messageId }).eq("id", id);
}
export async function getCall(id: number): Promise<TgCall | null> {
  const { data } = await supa.from("tg_calls").select("*").eq("id", id).maybeSingle();
  return (data as TgCall) ?? null;
}
export async function openCallsForFixture(fixtureId: number): Promise<TgCall[]> {
  const { data } = await supa.from("tg_calls").select("*").eq("fixture_id", fixtureId).in("status", ["open", "locked"]);
  return (data as TgCall[]) ?? [];
}
export async function markSettled(id: number, result: "yes" | "no", settleTs: number | null): Promise<void> {
  await supa.from("tg_calls").update({ status: "settled", result, settle_ts: settleTs, settled_at: new Date().toISOString() }).eq("id", id);
}

// One answer per user per call; a second tap is ignored (returns false).
export async function recordAnswer(callId: number, tgId: number, choice: "YES" | "NO"): Promise<boolean> {
  const { error } = await supa.from("tg_call_answers").insert({ call_id: callId, tg_id: tgId, choice });
  if (error) {
    if ((error as any).code === "23505") return false; // duplicate PK
    throw error;
  }
  return true;
}
export async function tally(callId: number): Promise<{ yes: number; no: number }> {
  const { data } = await supa.from("tg_call_answers").select("choice").eq("call_id", callId);
  const rows = (data as any[]) ?? [];
  return { yes: rows.filter((r) => r.choice === "YES").length, no: rows.filter((r) => r.choice === "NO").length };
}
export async function answersFor(callId: number): Promise<{ tg_id: number; choice: string }[]> {
  const { data } = await supa.from("tg_call_answers").select("tg_id, choice").eq("call_id", callId);
  return (data as any[]) ?? [];
}
export async function setAnswerOutcome(callId: number, tgId: number, outcome: "won" | "lost", reward: number): Promise<void> {
  await supa.from("tg_call_answers").update({ outcome, reward }).eq("call_id", callId).eq("tg_id", tgId);
}

// Read-modify-write result application. Low concurrency (one settle at a time per
// call); an atomic RPC can replace this later if two calls ever settle a shared
// user in the same tick.
export async function applyUserResult(tgId: number, won: boolean, reward: number): Promise<TgUser | null> {
  const u = await getUser(tgId);
  if (!u) return null;
  const streak = won ? u.streak + 1 : 0;
  const upd = { spikes: u.spikes + reward, calls: u.calls + 1, correct: u.correct + (won ? 1 : 0), streak, best_streak: Math.max(u.best_streak, streak), updated_at: new Date().toISOString() };
  await supa.from("tg_users").update(upd).eq("tg_id", tgId);
  return { ...u, ...upd } as TgUser;
}
// ── notifications + ranking ─────────────────────────────────────────
export async function notifiableUsers(): Promise<{ tg_id: number; handle: string; streak: number }[]> {
  const { data, error } = await supa.from("tg_users").select("tg_id, handle, streak").eq("notify", true);
  if (error) throw error;
  return (data as any[]) ?? [];
}
export async function setUserNotify(tgId: number, on: boolean): Promise<void> {
  await supa.from("tg_users").update({ notify: on, updated_at: new Date().toISOString() }).eq("tg_id", tgId);
}
// Announce a match once: returns true only the first time (insert wins), false if
// it's already been announced (duplicate PK) — so restarts don't re-notify.
export async function claimMatchNotif(fixtureId: number): Promise<boolean> {
  const { error } = await supa.from("tg_match_notifs").insert({ fixture_id: fixtureId });
  if (error) {
    if ((error as any).code === "23505") return false;
    throw error;
  }
  return true;
}
// The caller's 1-based rank in a group (by correct calls), or null if they haven't played.
export async function userRank(chatId: number, tgId: number): Promise<{ rank: number; correct: number; total: number } | null> {
  const { data } = await supa.from("tg_group_scores").select("tg_id, correct, total").eq("chat_id", chatId).order("correct", { ascending: false });
  const rows = (data as any[]) ?? [];
  const i = rows.findIndex((r) => r.tg_id === tgId);
  if (i < 0) return null;
  return { rank: i + 1, correct: rows[i].correct, total: rows[i].total };
}

export async function applyGroupResult(chatId: number, tgId: number, won: boolean): Promise<void> {
  const { data } = await supa.from("tg_group_scores").select("*").eq("chat_id", chatId).eq("tg_id", tgId).maybeSingle();
  const cur = (data as any) ?? { correct: 0, total: 0, streak: 0, best_streak: 0 };
  const streak = won ? cur.streak + 1 : 0;
  await supa.from("tg_group_scores").upsert(
    { chat_id: chatId, tg_id: tgId, correct: cur.correct + (won ? 1 : 0), total: cur.total + 1, streak, best_streak: Math.max(cur.best_streak, streak), updated_at: new Date().toISOString() },
    { onConflict: "chat_id,tg_id" }
  );
}
