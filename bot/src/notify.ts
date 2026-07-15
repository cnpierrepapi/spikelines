import { InlineKeyboard } from "grammy";
import { bot } from "./instance.ts";
import { env } from "./env.ts";
import { notifiableUsers, claimMatchNotif } from "./db.ts";
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
