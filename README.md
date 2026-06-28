# Spikelines

**Feel the match.** A real-time "what happens next?" micro-prediction game built on live World Cup data, cryptographically verified on Solana via [TxLINE](https://txline.txodds.com). Part of the **SPOTR** family.

🔗 **Live:** https://spikelines.vercel.app

---

## What it is

As a team builds an attack, a quick call fires — *will they score, win a corner, or get a shot away (or will someone get booked) before the window closes?* Tap **YES / NO**, build a streak, earn **SPIKES**. Every resolution is settled against TxLINE's World Cup feed, anchored on Solana, so outcomes can't be faked.

It's the free, viral top of the SPOTR funnel: a 7-streak graduates you into **Flashcalls** with bonus credits.

## How it works

- **Momentum meter** sways with live possession tiers (safe → attack → danger → high danger).
- **Side-framed micro-markets** open on attacking pressure: goal / corner / shot for the attacking team, plus bookings — each settled on that team's stat delta within a short window.
- **Two modes:**
  - **Live** — currently in-play matches, streamed in real time (100 SPIKES / correct).
  - **Archived** — full matches replayed from kickoff (5 SPIKES / correct).
- **Highlights feed** — goals, shots, corners, cards, penalties, VAR and subs as they happen.
- Matches move from **Live → Archived automatically at full time**.

## Architecture

- **Next.js 16** (App Router) + **Tailwind v4**, deployed on Vercel.
- **Server-side SSE proxy** holds the TxLINE API token (no keys in the browser).
- TxLINE's push *scores* stream is heartbeat-only on the free tier, so live state is derived by **polling + diffing the scores snapshot**; full matches are replayed from the **updates** sequence (static JSON + a runtime endpoint).
- Cumulative stats are read as a **running max** (feed records are sparse), keeping the scoreboard monotonic.

## TxLINE endpoints used

| Endpoint | Use |
|---|---|
| Guest-start → Solana wallet-sig → **activate** | Obtain the API token (Anchor on-chain subscription at setup) |
| `GET /api/fixtures/snapshot` | Fixtures, team names, kickoff times, finished-match detection |
| `GET /api/scores/snapshot/{fid}` | Live in-play state (polled by the live SSE proxy) |
| `GET /api/scores/updates/{fid}` | Full kickoff-to-FT sequence (replay + runtime archive) |

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000
```

Server env (set in Vercel): `TXLINE_API_BASE`, `TXLINE_JWT`, `TXLINE_API_TOKEN`.

---

Built by [Onenept Studios](https://onenept.com) for the TxLINE / TxODDS World Cup hackathon.
