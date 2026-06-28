// Generates the Spikelines technical paper → public/spikelines-litepaper.pdf
//   node scripts/gen-litepaper.mjs
import PDFDocument from "pdfkit";
import { createWriteStream, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: "Spikelines — Technical Paper", Author: "Onenept Studios" } });
doc.pipe(createWriteStream("public/spikelines-litepaper.pdf"));

const NAVY = "#0a1628", GOLD = "#9a7b00", GREY = "#444b57";

const h1 = (t) => doc.moveDown(0.4).fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text(t).moveDown(0.3);
const p = (t) => doc.fillColor(GREY).font("Helvetica").fontSize(10).text(t, { lineGap: 2 }).moveDown(0.3);
const li = (t) => doc.fillColor(GREY).font("Helvetica").fontSize(10).text("•  " + t, { indent: 10, lineGap: 2 });

// Title
doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(26).text("Spikelines");
doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(12).text("Technical Paper");
doc.fillColor(GREY).font("Helvetica").fontSize(9).text("A real-time prediction game on live World Cup data, verified on Solana via TxLINE. Built by Onenept Studios.").moveDown(0.5);
doc.strokeColor("#dddddd").moveTo(56, doc.y).lineTo(539, doc.y).stroke().moveDown(0.5);

h1("1. Overview");
p("Spikelines turns a live football match into a stream of 5-second micro-predictions. When a team builds an attack, the player is asked whether a specific event (goal, corner, or shot for the attacking side; a booking for either) occurs within a short window. Correct calls build a streak and earn SPIKES, the in-app currency. It is the free, viral entry point of a three-product family (Spikelines, Flashcalls, Agenthesis) that share the SPIKES currency.");

h1("2. Game mechanics");
li("Trigger: prompts fire on attacking/danger/high-danger possession and shots, attributed to the attacking side. High-danger bypasses the routine cooldown so a sudden chance always asks.");
li("Markets: goal / corner / shot (side-framed to the attacking team) + booking (either team). Each settles on the relevant cumulative stat delta, or the shot action.");
li("Windows: live calls resolve in 2-4 minutes ~80% of the time; longer windows occasionally.");
li("Modes: Live (real-time, in-play matches) and Archived (full matches replayed from kickoff).");
li("One-shot-per-match: each match is playable once per user, preventing replay-farming of known archived outcomes.");
doc.moveDown(0.3);

h1("3. Scoring & leaderboard");
p("The leaderboard ranks by streak accuracy, not raw winnings. Each played match contributes the ratio of the maximum streak reached to the number of calls made; the score is the sum of those ratios times 100.");
p("Example: Match A — 40 max streak over 80 calls = 50 pts. Match B — 20 max streak over 50 calls = 25 pts. Score = 75.");
p("Anti-farming: a match's points are capped at 35 unless at least 14 calls were made in it, so a few lucky calls on a tiny sample cannot post a high accuracy. Scoring on accuracy (a ratio) rather than volume keeps players who buy more entries from dominating purely by quantity.");

h1("4. SPIKES economy & monetization");
li("SPIKES are earned per correct call (20 archived / 85 live) plus a once-per-run bonus at a 5-streak (25 archived / 50 live), or bought in USDC packs.");
li("SPIKES sink 1 — 'streak-save': when a wrong call would end an active streak, spend SPIKES to keep it. Cost escalates per use each day (25, 50, 125, 150, then capped at 175).");
li("SPIKES sink 2 — 'replay': every match is one-shot, but an already-played archived match can be replayed for 175 SPIKES.");
li("SPIKES never buy a bigger bankroll or better prize odds (equal-footing; everyone plays the same stake). SPIKES packs are 100% revenue; USDC reward pools are funded by a discretionary allocation.");
li("Revenue = SPIKES pack sales. TxLINE API volume is a cost, not a revenue line.");
doc.moveDown(0.3);

h1("5. Architecture");
li("Next.js 16 (App Router) + Tailwind v4 on Vercel; a server-side SSE proxy holds the TxLINE token (no keys in the browser).");
li("TxLINE's push scores stream is heartbeat-only on the free tier, so live state is derived by polling and diffing the scores snapshot; full matches are replayed from the updates sequence (static JSON + a runtime endpoint).");
li("Cumulative stats (goals, corners, cards) are read as a running max because feed records are sparse — this keeps the scoreboard monotonic.");
li("Finished matches move from Live to Archived automatically (detected via the game_finalised action); a recorder banks them before TxLINE drops them from its window.");
doc.moveDown(0.3);

h1("6. TxLINE endpoints used");
li("Guest-start -> Solana wallet-signature -> activate: obtain the API token (Anchor on-chain subscription).");
li("GET /api/fixtures/snapshot — fixtures, team names, kickoff times, finished detection.");
li("GET /api/scores/snapshot/{fixtureId} — live in-play state (polled).");
li("GET /api/scores/updates/{fixtureId} — full kickoff-to-FT sequence (replay + archive).");
doc.moveDown(0.3);

h1("7. Fairness & compliance");
p("Players never wager real money on outcomes and all receive the same play-money stake; purchases buy information, convenience and entries — never a larger share of the prize. Leaderboards are scored on accuracy. Contestants are responsible for gaming/securities compliance in their jurisdiction.");

h1("8. Roadmap");
li("On-chain USDC: real SPIKES packs and the $5 vault (10% rake context), cross-user leaderboard and payouts.");
li("Player-level identity and a verifiable, un-deletable track record (wins and losses) anchored on Solana.");

doc.moveDown(1).fillColor("#999999").fontSize(8).text("Spikelines — Onenept Studios — TxLINE / TxODDS World Cup. This document is informational, not an offer of securities or a solicitation to gamble.", { align: "center" });

doc.end();
console.log("wrote public/spikelines-litepaper.pdf");
