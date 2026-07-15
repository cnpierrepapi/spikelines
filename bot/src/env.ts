import "dotenv/config";

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export const env = {
  // From BotFather.
  BOT_TOKEN: req("BOT_TOKEN"),
  // Foil service-role key — server-only, bypasses RLS on the tg_ tables.
  SUPABASE_URL: req("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: req("SUPABASE_SERVICE_ROLE_KEY"),
  // The deployed site, opened as the Telegram Mini App + used for deep links.
  MINIAPP_URL: process.env.MINIAPP_URL || "https://spikelines.vercel.app",
};
