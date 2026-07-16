# Spikelines: Technical Documentation

How the product works end to end, and exactly where TxLINE powers it.

## Core idea

Spikelines is micro-prediction synced to the rhythm of a live match. Instead of a
bet slip you fill in advance, a short YES or NO call fires the moment an attack is
building ("score, corner, or card in the next few minutes?"). You tap, build a
streak, and earn SPIKES. Every call is settled from live TxLINE data and written to
a public ledger that is verified on Solana. It runs as a web app and as a Telegram
bot you can drop into any football group chat, live during a match or as a shared
replay of any of the 104 games.

## Architecture at a glance

```
TxLINE feed  ──poll every 4s──▶  lib/match-feed.ts (one producer, diff to events)
                                        │
                        ┌───────────────┴────────────────┐
                        ▼                                 ▼
        app/api/live-stream/[fid]              bot/src/watcher.ts
        (browser SSE, the web pitch)           (Telegram group calls)
                        │                                 │
                        └──────── settle a call ──────────┘
                                        │
                        POST /api/bets/settle → spk_bets ledger
                                        │
                              on-chain proof (validate_stat)
```

One producer, two consumers. The exact same code derives events for the browser and
for the bot, so the web pitch and the group calls can never drift on how an event is
read from the feed.

## 1. The feed pipeline (`lib/match-feed.ts`)

TxLINE's push stream is heartbeat-only on the free tier (scores are not sampled on
it), so the app polls the scores snapshot every 4 seconds (`MATCH_POLL_MS = 4000`)
and diffs it against a per-fixture state object.

`pollMatchOnce()` does one poll of `GET /api/scores/snapshot/{fixtureId}` and emits
sanitized events. The snapshot returns the latest record per action type, and each
record carries the full cumulative `Score.Total` per team, so a single poll yields
several bettable markets plus possession at once.

Events emitted:

| Event | Meaning | Source in the snapshot |
| --- | --- | --- |
| `score` | current goals both sides | `Score.Total.Goals` per participant |
| `stat` | a goal / corner / yellow / red just landed | delta on `Score.Total.{Goals,Corners,YellowCards,RedCards}` |
| `momentum` | attack pressure tier | `Action` in {safe, attack, danger, high_danger}_possession |
| `chance` | a scoring chance opened (prompt trigger) | `Action` in {high_danger_possession, penalty, danger_possession, attack_possession, shot, free_kick} |
| `event: shot` | a shot (settles the shot market) | `Action = shot` |
| `shootout` | penalty-shootout goals | `Score.Participant*.PE.Goals` |
| `feed` | penalty / VAR / substitution ticker | `Action` in {penalty, var, substitution} |
| `stat: goal_disallowed` | VAR overturn | `Action` in {action_discarded, var_end Outcome=Overturned} |
| `finished` | full time | `Action = game_finalised` |

Two things in the snapshot need care, and both are handled here:

- Sparse records. Any single record's `Score.Total` can omit a stat that has not
  moved, which would read as 0. We take a running max across every record in a poll,
  and keep the per-stat baseline monotonic across polls, so a sparse poll can never
  lower a count.
- Legitimate decreases. A VAR overturn is the only case a score should go down. When
  the feed signals one we trust the latest cumulative total, pull the baseline down to
  it, and emit a disallowed-goal event.

## 2. Prompt timing (why it feels live)

Calls do not fire on a fixed clock. They fire on momentum. When `Action` crosses into
`danger_possession` or `high_danger_possession`, a `chance` event is emitted tagged
with the attacking side, and the client opens a call. `lib/markets.ts` maps the
trigger to a market and a window (`pickMarket`, `pickWindow`): high-danger leans to
goal, attack leans to corner or shot, and so on. This is the single detail that makes
the product read as a live experience rather than a timer: the prompt arrives at the
second the tension on the pitch rises.

## 3. The pitch animation (`components/PitchMomentum.tsx`)

A canvas renders dots and a ball whose motion follows the `momentum` tier from the
feed, with set-piece framing for corners and a goal-into-net beat on a `stat: goal`.
It reads the match clock and freezes when the clock is not running (half-time and
breaks), resuming on the second half, so the animation matches what is actually
happening. This works for any TxLINE stream, not just the World Cup, because it keys
off the clock and possession fields, not anything competition-specific.

## 4. Discovery (`app/api/live/route.ts`)

The fixtures snapshot has no live flag, so "live" is derived. We call
`GET /api/fixtures/snapshot`, keep `CompetitionId === 72` (the World Cup), and keep
fixtures whose `StartTime` is within the last 2.5 hours and whose scores feed has not
finalised. Finished matches are persisted to the archive so they can be replayed.

## 5. Settlement and on-chain proof

Calls are held server-side and resolve one of two ways:

- YES when the matching stat lands (`marketMatches` compares the settled market and
  side against the stat delta from the feed).
- NO when the call's window elapses in match time (`deadline_sec`) or the match ends.

On settle, the result is POSTed to `/api/bets/settle` and written to the `spk_bets`
ledger with a device id (`tg:<telegramUserId>` for Telegram players), so web and
Telegram calls land in the same public proof ledger and are verified on Solana via
`validate_stat`. Settlement is identical for live and archived play (archived carries
`mode: "archived"`), so a replay produces real, provable calls too.

## 6. Scoring and the daily reward engine (`supabase/migrations/0003_daily_rewards.sql`)

Each match contributes `(bestStreakInMatch / calls) * 100` to your score, capped at
35 per match unless you made at least 14 calls in it. This rewards accuracy sustained
across many matches and blocks a few lucky calls on a tiny sample from posting a high
number.

A per-day snapshot of each player's cumulative score is stored in `spk_daily`. At end
of day the admin sets a USDC pool and `spk_compute_day` splits it:

- 30% shared equally among the top 10% by that day's score.
- 70% split by improvement share, where improvement is today's score minus
  yesterday's, floored at 0.

Grants are written to `spk_reward_grants` (audit and idempotency) and credited to each
player's withdrawable balance.

## 7. Identity and economy

- Web identity is an anonymous device id in local storage plus a chosen handle, so a
  player can start with no signup.
- Telegram identity is the signed Mini App `initData`, verified with the bot token
  (HMAC with key `WebAppData`), which lets the server trust who a Web App request is
  from with no separate login. Telegram players carry a server-side SPIKES balance in
  `tg_users`.
- SPIKE packs are bought with real USDC and USDC can be withdrawn, both behind
  wallet-signature auth, both kept inside the Mini App (never in chat). SPIKES are
  spent to replay a match for another attempt and to buy a streak-save.

## 8. Telegram (`bot/`)

An isolated long-polling worker (grammY) that shares the web app's pure logic and
writes to the same Supabase project. In a DM it is a one-tap launcher into the Mini
App plus kickoff and streak notifications. In a group it posts a call, everyone taps
inline YES or NO, a live tally updates on the message, it settles from the same feed,
and a per-group leaderboard tracks the room. `/play` runs a shared replay of a
recorded match at any time. It runs on an always-on box (a match lasts about two
hours, past a serverless function limit) under systemd with hard memory and CPU caps.

## TxLINE endpoints used

| Endpoint | Use |
| --- | --- |
| Guest-start then Solana wallet-sig then activate | One-time setup: obtain the durable API token via an Anchor on-chain subscription. This is the sign-up through Solana. |
| `POST /auth/guest/start` | Mint a runtime guest JWT. Cached about 30 days and re-minted before expiry. |
| `GET /api/fixtures/snapshot` | All fixtures. Filtered to `CompetitionId === 72` and a 2.5h kickoff window to derive live matches. |
| `GET /api/scores/snapshot/{fixtureId}` | The in-play core. Cumulative `Score.Total` per participant (Goals, Corners, YellowCards, RedCards, and `PE` for shootouts), `Clock` (Seconds, Running, Period), and `Action` (possession tiers, shot, penalty, free_kick, substitution, var, var_end, action_discarded, game_finalised). |
| `GET /api/scores/updates/{fixtureId}` | The full kickoff-to-full-time sequence, recorded to static JSON so archived matches can be replayed (solo, or in a group with `/play`). |

Auth headers on the data endpoints: `Authorization: Bearer <jwt>` and
`X-Api-Token: <apiToken>`.

## Stack

Next.js (App Router) on Vercel, Supabase (Postgres, service-role RPCs, RLS lockdown),
Solana for wallet auth and on-chain settlement proof, grammY for the Telegram worker
on an EC2 box.
