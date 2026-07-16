import { bot } from "./instance.ts";
import "./bot.ts"; // registers commands + the tap handler
import { startWatching } from "./watcher.ts";
import { env } from "./env.ts";

// Entry point: long-polling worker. No public webhook — the process just holds a
// getUpdates loop, which is why it lives on the always-on box, not on Vercel.
async function main() {
  // Always-available launcher: the chat's menu button opens the Mini App in one
  // tap, in every DM. (The group play stays in-chat; a Mini App is per-user.)
  await bot.api.setChatMenuButton({
    menu_button: { type: "web_app", text: "Play", web_app: { url: env.MINIAPP_URL } },
  });

  // Only the commands we actually handle, shown in the Telegram command menu.
  await bot.api.setMyCommands([
    { command: "start", description: "Open the game" },
    { command: "play", description: "Replay a past match (in a group)" },
    { command: "me", description: "Your stats" },
    { command: "top", description: "Group leaderboard" },
    { command: "wallet", description: "Buy SPIKES / withdraw (in app)" },
    { command: "mute", description: "Mute kickoff alerts" },
    { command: "help", description: "How it works" },
  ]);

  const stop = () => bot.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  // Fire the match watcher alongside the long-poll (it runs its own loop forever).
  startWatching().catch((e) => console.error("watcher crashed:", e));

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => console.log(`spikelines-bot up as @${info.username}`),
  });
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
