import { Bot } from "grammy";
import { env } from "./env.ts";

// The single Bot instance, in its own module so both the command handlers
// (bot.ts) and the call sender/settler (calls.ts) can import it without a cycle.
export const bot = new Bot(env.BOT_TOKEN);
