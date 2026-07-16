# Spikelines ⚡

**Call what happens next in a live match.**

As a team builds an attack, a short YES or NO call fires: will they score, win a
corner, or pick up a card in the next few minutes? You tap, build a streak, and earn
SPIKES. Every call settles on live [TxLINE](https://txline.txodds.com) data and is
verified on Solana. Play solo on the web or together in any football group chat through
the Telegram bot, live during a match or as a replay of any of the 104 games.

- Live app: https://spikelines.vercel.app
- Telegram: @SpikelinesBot
- Full data flow and endpoints: [TECHNICAL.md](./TECHNICAL.md)

Built for the TxLINE World Cup track. TxLINE is the live input for every score, event,
and possession swing; Solana carries identity and provable settlement.

---

## Why players buy SPIKE packs

Buying SPIKES is not buying a bet on a game. It buys more attempts at the exact number
that sets your share of the prize pool.

Here is the chain, and every link is real in the code:

1. Your score is `(best streak in a match / calls in that match) * 100`, summed over
   the matches you play. It rewards accuracy held across many games.
2. The daily USDC pool pays out on two variables: 30% is shared by the **top 10% by
   score**, and 70% is split by **improvement**, meaning today's score minus
   yesterday's.
3. You get one free play per match. SPIKES let you do the two things that move those
   variables: **replay a match** to take another run at raising its accuracy ratio, and
   **buy a streak-save** to protect your best streak, which is the numerator of your
   score.

So a pack converts directly into leverage on both pool variables: a higher score for
the top-10% slice, and more improvement for the larger 70% slice. It does not buy the
outcome. You still have to call the match correctly, and the anti-farming cap (a match
earns nothing extra unless you make at least 14 calls) means volume alone earns
nothing. Packs buy practice at the skill, and skill is what turns practice into payout.

## Why it is a skill game, not gambling

Spikelines is built on the same mechanic as established skill games, and it is designed
to pass the predominance-of-skill test those games rely on:

- **Outcome is determined by skill.** Reading a live attack and judging whether this
  side is about to score, win a corner, or concede a card is football knowledge, not a
  coin flip. Better players post higher scores consistently.
- **Scoring rewards accuracy, not chance or spend.** The score is a ratio (streak over
  calls), and small samples are capped, so a lucky guess cannot rank and buying more
  attempts cannot rank without genuine accuracy.
- **Free to enter.** Anyone can play every match for free. Money buys extra practice,
  never a result.

This is the same family as the track's own Hi-Lo stats idea, as trivia games like
Trivia Crack, QuizUp and HQ, and as daily-prediction and fantasy formats that are
treated as skill under the predominance test because the player's judgment, not
randomness, drives the result. Spikelines sits squarely in that lineage: a fast,
knowledge-driven prediction game with a provable, on-chain scoreboard.

## Why the business model is the most sustainable

Three compounding advantages:

**Lowest possible barrier to entry.** No signup and no wallet needed to start: a web
player gets an anonymous identity instantly, and a group player is one tap away inside
Telegram, where football fans already gather. Solo or social, the first call is free
and immediate. Nothing kills a fan product faster than a wall before the fun, and there
is none here.

**Leaderboard dynamics built for retention, not just whales.** Because 70% of the pool
pays improvement over yesterday, every player has a reason to come back tomorrow, not
only the person at the top. The top-10% slice adds aspirational status on top. A daily
pool plus a daily-improvement payout is a daily-habit machine, which is the metric that
actually compounds.

**Clipper-led distribution turns gameplay into acquisition.** The animated pitch, the
moment a call fires on a building attack, and a big streak payout are native short-form
content. We run a flat-rate clipper program (pay per posted video, a model already
proven to move volume) to push custom Spikelines play clips across TikTok at a low,
predictable cost per install. Every clip carries a one-tap route into the Telegram bot,
so a viral clip becomes a group of players, not just a view. Gameplay funds its own
growth instead of relying on paid ads.

**Revenue.** USDC SPIKE packs are the primary line, and the pack sink also funds and
grows the reward pool with house margin. On top of that sits a clear B2B path: the
momentum-driven call engine can be white-labelled to any TxLINE operator or broadcaster,
and because it keys off possession and stat fields rather than anything
competition-specific, the same integration scales from these 104 games to any
competition in the feed after the Cup.

---

## How it works (short version)

As a team builds an attack, a side-framed micro-market opens (goal, corner, shot, or a
booking for the attacking team) and settles on that team's stat delta within a short
window. A momentum meter sways with live possession tiers (safe, attack, danger, high
danger) and the pitch animation freezes at half-time and breaks. Two modes: **Live**
in-play matches, and **Archived** full matches replayed from kickoff, in a group with
`/play` or solo. Every resolution is written to a public ledger and verified on Solana,
so outcomes cannot be faked. Matches move from Live to Archived automatically at full
time.

### TxLINE endpoints used

| Endpoint | Use |
|---|---|
| Guest-start then Solana wallet-sig then **activate** | Obtain the durable API token via an Anchor on-chain subscription at setup (this is the sign-up through Solana). |
| `POST /auth/guest/start` | Mint a runtime guest JWT (cached about 30 days, re-minted before expiry). |
| `GET /api/fixtures/snapshot` | Fixtures, team names, kickoff times; filtered to `CompetitionId === 72` and a 2.5h window to derive live matches. |
| `GET /api/scores/snapshot/{fid}` | Live in-play state: cumulative `Score.Total` per side, `Clock`, and `Action` (possession, shot, card, penalty, VAR, finished). Polled every 4s and diffed. |
| `GET /api/scores/updates/{fid}` | Full kickoff-to-full-time sequence, recorded for archived replay. |

Auth headers on the data endpoints: `Authorization: Bearer <jwt>` and
`X-Api-Token: <apiToken>`. See [TECHNICAL.md](./TECHNICAL.md) for the full pipeline.

## Repository layout

- `app/` — Next.js App Router: live and archived match pages, the pitch, leaderboard,
  profile and packs, the admin reward dashboard, and API routes (`live`,
  `live-stream`, `bets/settle`, `rewards`, `tg/*`).
- `lib/` — shared pure logic: `match-feed.ts` (the one feed producer), `markets.ts`
  (trigger to market mapping), `store.ts` (client state and scoring), `txline-auth.ts`.
- `bot/` — the Telegram long-polling worker (grammY), isolated package.
- `supabase/migrations/` — schema: the bet ledger, the daily reward engine, and the
  Telegram tables, all with row-level-security lockdown.

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000
```

Server env (set in Vercel): `TXLINE_API_BASE`, `TXLINE_JWT`, `TXLINE_API_TOKEN`.

---

Built by [Onenept Studios](https://onenept.com) for the TxLINE World Cup track.
