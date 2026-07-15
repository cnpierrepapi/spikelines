# Spikelines Telegram bot

A long-polling worker (grammY) that runs on the box, not on Vercel. It shares the
web app's pure logic (`../lib/markets.ts`, `../lib/match-feed.ts`) and writes to
the same Foil Supabase project via the service-role key. The Mini App is the
existing site opened inside Telegram.

## Layout
- `src/index.ts` — entry: sets the menu button + command list, starts long-polling.
- `src/bot.ts` — commands (`/start /help /balance /link /top /quiet`) + membership tracking.
- `src/db.ts` — service-role Supabase client + `tg_*` helpers.
- `src/handle.ts` — random handle generator (kept in sync with the web `UsernameGate`).
- `src/env.ts` — env loading.

## Create the bot (BotFather)
1. Open [@BotFather](https://t.me/BotFather) → `/newbot`, pick a name + username, copy the token.
2. `/setprivacy` → your bot → **Disable** (so it can read group messages/commands).
3. `/setjoingroups` → **Enable**.
4. (Optional but recommended) Bot Settings → **Configure Mini App** → set the URL to
   `https://spikelines.vercel.app` so tapping the bot opens the app directly.

## Run on the box
```sh
# on the box, as ec2-user
git clone/pull the repo, then:
cd spikelines-bot            # = this bot/ folder copied to the box
cp .env.example .env         # fill BOT_TOKEN + SUPABASE_SERVICE_ROLE_KEY
npm install
npm start                    # foreground smoke test

# then install as a service (auto-restart + resource caps):
sudo cp spikelines-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now spikelines-bot
sudo systemctl status spikelines-bot
journalctl -u spikelines-bot -f
```

Isolated from lagisalpha: separate dir, own `.env`, own systemd unit with
`MemoryMax=256M` + `CPUQuota=40%` so it can never starve the box.
