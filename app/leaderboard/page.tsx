"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getGames, leaderboardScore, gamePoints, getBalance, MIN_BETS_FOR_HIGH, LOW_SAMPLE_CAP, type GameStat } from "@/lib/store";

// Seeded rivals so the board reads like a ranking until the real cross-user
// backend lands. The signed-in player is inserted by their real local score.
const RIVALS = [
  { name: "kayfabe", score: 214 },
  { name: "xG_wizard", score: 188 },
  { name: "the_gaffer", score: 161 },
  { name: "ResultMerchant", score: 133 },
  { name: " low_block", score: 97 },
  { name: "stoppage_time", score: 64 },
  { name: "own_goal", score: 38 },
];

export default function Leaderboard() {
  const [games, setGames] = useState<GameStat[]>([]);
  const [score, setScore] = useState(0);
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    const g = getGames();
    setGames(g);
    setScore(leaderboardScore(g));
    setBalance(getBalance());
  }, []);

  const board = [...RIVALS, { name: "You", score, you: true } as { name: string; score: number; you?: boolean }].sort((a, b) => b.score - a.score);
  const myRank = board.findIndex((r) => (r as { you?: boolean }).you) + 1;

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-30 nav-blur border-b border-white/[0.06]">
        <div className="app-container flex items-center justify-between py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-primary font-black text-xl tracking-tight">SPIKES</span>
            <span className="text-muted text-sm">· Spikelines</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/play" className="text-sm text-muted hover:text-foreground">Play</Link>
            <div className="text-sm font-mono px-3 py-1.5 rounded-full border border-white/10">
              <span className="text-primary font-bold">{balance.toLocaleString()}</span> <span className="text-muted">SPIKES</span>
            </div>
          </div>
        </div>
      </nav>

      <main className="app-container py-8 max-w-2xl">
        <h1 className="text-3xl font-black mb-1">Leaderboard</h1>
        <p className="text-muted text-sm mb-2">Ranked by <span className="text-foreground font-semibold">streak accuracy</span> — top performers share the weekly USDC pool.</p>
        <p className="text-muted text-xs mb-6 font-mono">score = Σ (max streak ÷ calls × 100) per match &nbsp;·&nbsp; e.g. 40/80 + 20/50 = 50 + 25 = 75 &nbsp;·&nbsp; matches with &lt;{MIN_BETS_FOR_HIGH} calls cap at {LOW_SAMPLE_CAP} pts</p>

        {/* Your score + per-match breakdown */}
        <div className="card-surface rounded-2xl p-5 mb-6">
          <div className="flex items-baseline justify-between mb-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted mb-1">Your score</div>
              <div className="text-4xl font-black text-primary tabular-nums">{score}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-muted mb-1">Rank</div>
              <div className="text-2xl font-black tabular-nums">#{myRank}</div>
            </div>
          </div>
          {games.length === 0 ? (
            <p className="text-muted text-sm">No matches yet — <Link href="/play" className="text-primary font-bold">play one</Link> to get on the board.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {games.map((g) => {
                const capped = g.bets < MIN_BETS_FOR_HIGH && (g.bets ? (g.maxStreak / g.bets) * 100 : 0) > LOW_SAMPLE_CAP;
                return (
                  <div key={g.fid} className="flex items-center justify-between text-sm">
                    <span className="text-foreground truncate pr-2">{g.match}</span>
                    <span className="text-muted font-mono shrink-0">
                      {g.maxStreak}/{g.bets} → <span className="text-foreground">{Math.round(gamePoints(g))} pts</span>{capped && <span className="text-destructive"> (cap, &lt;{MIN_BETS_FOR_HIGH})</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* The board */}
        <div className="card-surface rounded-2xl p-2">
          {board.map((r, i) => {
            const you = (r as { you?: boolean }).you;
            const reward = i === 0 ? "40%" : i === 1 ? "25%" : i === 2 ? "15%" : i < 5 ? "share" : "";
            return (
              <div key={r.name} className={`flex items-center justify-between px-4 py-3 rounded-xl ${you ? "bg-primary/10 border border-primary/40" : ""}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`font-mono text-sm w-6 ${i < 3 ? "text-primary font-bold" : "text-muted"}`}>{i + 1}</span>
                  <span className={`font-bold truncate ${you ? "text-primary" : "text-foreground"}`}>{r.name}{you && " (you)"}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {reward && <span className="text-success text-[11px] font-bold uppercase tracking-wider">{reward} pool</span>}
                  <span className="font-black tabular-nums">{r.score}</span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-muted text-xs mt-4 text-center">Weekly USDC pool funded by Spikelines · seeded rivals shown until cross-player ranking ships.</p>
      </main>
    </div>
  );
}
