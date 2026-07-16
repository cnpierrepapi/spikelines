import { InlineKeyboard } from "grammy";
import { bot } from "./instance.ts";
import { env } from "./env.ts";
import { notifiableUsers, claimMatchNotif, insertStreakSave } from "./db.ts";
import { streakSaveCost } from "./config.ts";
import type { LiveMatch } from "./txline.ts";

// DM every opted-in player when a match goes live: a one-tap launch into the Mini
// App, personalised with their streak. Announced once per match (claimMatchNotif),
// paced gently to stay under Telegram's send rate.
export async function announceKickoff(m: LiveMatch): Promise<void> {
  if (!(await claimMatchNotif(m.fid))) return; // already announced (or a restart)
  const users = await notifiableUsers();
  const kb = new InlineKeyboard().webApp("▶ Play this match", env.MINIAPP_URL);
  for (const u of users) {
    const streak = u.streak > 0 ? `\nYour streak: 🔥${u.streak}. Come defend it.` : "";
    try {
      await bot.api.sendMessage(u.tg_id, `⚡ ${m.p1} v ${m.p2} is live.${streak}\n\nTap in and call what happens next.`, { reply_markup: kb });
    } catch {
      // user blocked the bot / never opened a DM — skip
    }
    await new Promise((r) => setTimeout(r, 40)); // ~25/s, under the global limit
  }
}

// A broken streak just cost the player a run. DM them a single-tap chance to buy it
// back with SPIKES (the economy's spend sink). Gated by their notify preference; if
// they've never opened a DM the send throws and we drop it silently.
export async function offerStreakSave(tgId: number, chatId: number, prevStreak: number, notify: boolean): Promise<void> {
  if (!notify) return;
  const cost = streakSaveCost(prevStreak);
  const id = await insertStreakSave(tgId, chatId, prevStreak, cost);
  const kb = new InlineKeyboard().text(`Keep my 🔥${prevStreak} streak · ${cost} SPIKES`, `save:${id}`);
  try {
    await bot.api.sendMessage(
      tgId,
      `That call didn't land, so your 🔥${prevStreak} streak broke. Spend ${cost} SPIKES in the next 5 minutes to keep it alive.`,
      { reply_markup: kb }
    );
  } catch {
    // no DM open with the bot — nothing to offer
  }
}

// Praise a player who just crossed a streak milestone. Pulls them back toward the
// app to keep the run going. Also gated by notify.
export async function dmMilestone(tgId: number, streak: number, notify: boolean): Promise<void> {
  if (!notify) return;
  const kb = new InlineKeyboard().webApp("▶ Keep it going", env.MINIAPP_URL);
  try {
    await bot.api.sendMessage(tgId, `🔥 ${streak} calls in a row. You're on a proper run, don't cool off now.`, { reply_markup: kb });
  } catch {
    // no DM open — skip
  }
}
