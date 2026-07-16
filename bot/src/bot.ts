import { InlineKeyboard, GrammyError } from "grammy";
import { bot } from "./instance.ts";
import { env } from "./env.ts";
import { ensureUser, getUser, upsertChat, setChatActive, setChatQuiet, groupTop, userRank, setUserNotify } from "./db.ts";
import { handleAnswer } from "./calls.ts";
import { startArchivedSession } from "./replay.ts";

const isGroup = (t: string) => t === "group" || t === "supergroup";

// Was this command sent by a group admin? Guards /quiet so a random member can't
// silence the room. DMs are always "self-admin".
async function isAdmin(ctx: any): Promise<boolean> {
  if (!isGroup(ctx.chat?.type)) return true;
  try {
    const m = await ctx.getChatMember(ctx.from.id);
    return m.status === "creator" || m.status === "administrator";
  } catch {
    return false;
  }
}

bot.command("start", async (ctx) => {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !from) return;

  if (isGroup(chat.type)) {
    // Group: register the room. Calls will be posted here during live matches.
    await upsertChat(chat.id, chat.type, (chat as any).title ?? null);
    const kb = new InlineKeyboard().url("Open Spikelines", env.MINIAPP_URL);
    await ctx.reply(
      "Spikelines is live in this group. ⚡\n\n" +
        "When a World Cup match is on, I'll drop quick calls right here. Will they score, win a corner, or pick up a card? Tap YES or NO, build a streak, top the group board.\n\n" +
        "No match on right now? Use /play to replay a past one together. /top for the board, /quiet to pause (admins).",
      { reply_markup: kb }
    );
    return;
  }

  // DM: create the player, then hand straight off to the full Mini App.
  const user = await ensureUser(from.id, { username: from.username, firstName: from.first_name });
  await upsertChat(chat.id, "private", user.handle);
  const kb = new InlineKeyboard().webApp("▶ Open Spikelines", env.MINIAPP_URL);
  await ctx.reply(
    `You're in as ${user.handle}. ⚡\n\n` +
      "Spikelines turns a live match into a game: as an attack builds, a short call fires. Will they score, win a corner, or get a card? Call it right, build a streak, earn SPIKES, all settled on live World Cup data and verified on Solana.\n\n" +
      "Tap below to open the pitch. Add me to your football group chat to play together.",
    { reply_markup: kb }
  );
});

// Archived play in a group: start a shared replay of a recorded match that everyone
// calls together. DM users play archived matches in the Mini App instead.
bot.command("play", async (ctx) => {
  const chat = ctx.chat;
  if (!chat) return;
  if (!isGroup(chat.type)) {
    await ctx.reply(
      "In a group, /play starts a shared replay of a past match that everyone calls together. For solo archived play, open the app.",
      { reply_markup: new InlineKeyboard().webApp("▶ Open Spikelines", env.MINIAPP_URL) }
    );
    return;
  }
  await upsertChat(chat.id, chat.type, (chat as any).title ?? null);
  const msg = await startArchivedSession(chat.id);
  await ctx.reply(msg);
});

bot.command("help", async (ctx) => {
  const dm = !isGroup(ctx.chat?.type ?? "");
  await ctx.reply(
    "Spikelines ⚡ — call what happens next in a live match.\n\n" +
      "/start — open the game" + (dm ? " (launches the app)" : "") + "\n" +
      (dm ? "" : "/play — replay a past match together (any time)\n") +
      "/me — your SPIKES, streak and record\n" +
      "/top — leaderboard" + (dm ? "" : " for this group") + "\n" +
      "/wallet — buy SPIKES, withdraw, connect wallet\n" +
      (dm ? "/mute — turn kickoff alerts off (/unmute on)\n" : "/quiet — pause calls in this group (admins)\n") +
      "\nSPIKE packs and USDC withdrawals live in the app, tap Open Spikelines.",
    isGroup(ctx.chat?.type ?? "")
      ? { reply_markup: new InlineKeyboard().url("Open Spikelines", env.MINIAPP_URL) }
      : { reply_markup: new InlineKeyboard().webApp("▶ Open Spikelines", env.MINIAPP_URL) }
  );
});

bot.command("balance", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const user = (await getUser(from.id)) ?? (await ensureUser(from.id, { username: from.username, firstName: from.first_name }));
  await ctx.reply(`${user.handle}: ${user.spikes.toLocaleString()} SPIKES · 🔥 streak ${user.streak}`);
});

bot.command("link", async (ctx) => {
  if (isGroup(ctx.chat?.type ?? "")) {
    await ctx.reply("DM me /link to connect a wallet privately.");
    return;
  }
  const kb = new InlineKeyboard().webApp("Connect wallet in the app", env.MINIAPP_URL + "/profile");
  await ctx.reply(
    "Connect a Solana wallet to sync your SPIKES and prove your calls on-chain. It opens in the app, your keys never leave your wallet.",
    { reply_markup: kb }
  );
});

// SPIKE packs + USDC withdrawals live in the Mini App (never in chat). This just
// deep-links there. DM-only, so the buttons can be Web App launchers.
bot.command("wallet", async (ctx) => {
  if (isGroup(ctx.chat?.type ?? "")) {
    await ctx.reply("DM me /wallet to buy SPIKES or withdraw privately.");
    return;
  }
  const kb = new InlineKeyboard()
    .webApp("💰 Buy SPIKES", env.MINIAPP_URL + "/profile").row()
    .webApp("↗ Withdraw USDC", env.MINIAPP_URL + "/profile").row()
    .webApp("🔗 Connect wallet", env.MINIAPP_URL + "/profile");
  await ctx.reply("Manage your SPIKES and USDC in the app. Packs and withdrawals happen here; your keys never leave your wallet.", { reply_markup: kb });
});

bot.command("top", async (ctx) => {
  const chat = ctx.chat;
  if (!chat) return;
  if (!isGroup(chat.type)) {
    await ctx.reply("Leaderboards are per group. Add me to a football group chat and use /top there.");
    return;
  }
  const rows = await groupTop(chat.id, 10);
  if (!rows.length) {
    await ctx.reply("No calls in this group yet. Play a few during the next live match and the board fills up.");
    return;
  }
  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);
  const lines = await Promise.all(
    rows.map(async (r, i) => {
      const u = await getUser(r.tg_id);
      const name = u?.handle ?? String(r.tg_id);
      return `${medal(i)} ${name} — ${r.correct}/${r.total} · 🔥${r.streak}`;
    })
  );
  // If the caller isn't in the shown top, tell them where they stand.
  let footer = "";
  if (ctx.from && !rows.some((r) => r.tg_id === ctx.from!.id)) {
    const me = await userRank(chat.id, ctx.from.id);
    if (me) footer = `\n\nYou: #${me.rank} — ${me.correct}/${me.total}`;
  }
  await ctx.reply("Group board\n\n" + lines.join("\n") + footer);
});

bot.command("me", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const u = (await getUser(from.id)) ?? (await ensureUser(from.id, { username: from.username, firstName: from.first_name }));
  const acc = u.calls ? Math.round((u.correct / u.calls) * 100) : 0;
  await ctx.reply(
    `${u.handle}\n` +
      `SPIKES: ${u.spikes.toLocaleString()}\n` +
      `Streak: 🔥${u.streak} (best ${u.best_streak})\n` +
      `Calls: ${u.correct}/${u.calls} correct (${acc}%)` +
      (isGroup(ctx.chat?.type ?? "") ? "" : `\n\nWallet: ${u.wallet ? "linked" : "not linked, /link"}`)
  );
});

bot.command("mute", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  await setUserNotify(from.id, false);
  await ctx.reply("Kickoff alerts off. /unmute to turn them back on.");
});
bot.command("unmute", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  await ensureUser(from.id, { username: from.username, firstName: from.first_name });
  await setUserNotify(from.id, true);
  await ctx.reply("Kickoff alerts on. ⚡ I'll ping you when a match goes live.");
});

bot.command("quiet", async (ctx) => {
  const chat = ctx.chat;
  if (!chat || !isGroup(chat.type)) {
    await ctx.reply("That only applies in a group.");
    return;
  }
  if (!(await isAdmin(ctx))) {
    await ctx.reply("Only a group admin can pause calls.");
    return;
  }
  await setChatQuiet(chat.id, true);
  await ctx.reply("Calls paused in this group. Use /unquiet to bring them back.");
});

bot.command("unquiet", async (ctx) => {
  const chat = ctx.chat;
  if (!chat || !isGroup(chat.type)) return;
  if (!(await isAdmin(ctx))) {
    await ctx.reply("Only a group admin can resume calls.");
    return;
  }
  await setChatQuiet(chat.id, false);
  await ctx.reply("Calls resumed. ⚡");
});

// Track membership: register the chat when added to a group, deactivate when the
// bot is removed / blocked so the watcher stops fanning calls to a dead chat.
bot.on("my_chat_member", async (ctx) => {
  const upd = ctx.myChatMember;
  const chat = ctx.chat;
  if (!upd || !chat) return;
  const status = upd.new_chat_member.status;
  if (status === "left" || status === "kicked") {
    await setChatActive(chat.id, false);
    return;
  }
  if (isGroup(chat.type) && (status === "member" || status === "administrator")) {
    await upsertChat(chat.id, chat.type, (chat as any).title ?? null);
    try {
      await ctx.reply("Thanks for adding Spikelines. ⚡ I'll post quick calls here during live World Cup matches. /top for the board, /quiet to pause (admins).");
    } catch {
      // no send permission yet — fine, registration still stands
    }
  }
});

// A YES/NO tap on a group call. callback_data = "ans:<callId>:<YES|NO>".
bot.callbackQuery(/^ans:(\d+):(YES|NO)$/, async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const callId = Number(ctx.match[1]);
  const choice = ctx.match[2] as "YES" | "NO";
  try {
    const text = await handleAnswer(callId, from.id, choice, { username: from.username, firstName: from.first_name });
    await ctx.answerCallbackQuery({ text });
  } catch (e) {
    console.error("answer", e);
    await ctx.answerCallbackQuery({ text: "Something went wrong, try again." });
  }
});

bot.catch((err) => {
  const e = err.error;
  if (e instanceof GrammyError) console.error("grammy error:", e.description);
  else console.error("bot error:", e);
});
