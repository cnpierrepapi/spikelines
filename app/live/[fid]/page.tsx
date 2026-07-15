"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import { recordBet, addBalance, markPlayed, getBalance, streakSaveCost, buyStreakSave, recordGameStats, getLiveRoom, saveLiveRoom, EMPTY_STATS, type MatchStats } from "@/lib/store";
import { celebrateFrom } from "@/lib/celebrate";
import { settleBet } from "@/lib/remote";
import { MatchStatsPanel } from "@/components/match-stats";
import PitchMomentum from "@/components/PitchMomentum";
import { type MarketKind, type Side, type Trigger, pickMarket, pickWindow, marketMatches, marketQuestion, marketLabel, marketHeader } from "@/lib/markets";

type Tier = "safe" | "attack" | "danger" | "high_danger";
type Clock = { Running: boolean; Seconds: number };
type Prompt = { id: number; sec: number; mins: number; market: MarketKind; side: Side; question: string; answered: null | "YES" | "NO" };
type Bet = { id: number; market: MarketKind; side: Side; mins: number; choice: "YES" | "NO"; deadlineSec: number; status: "open" | "won" | "lost"; label: string; baseTs: number };
type LiveEntry = { fid: number; p1: string; p2: string; iso1: string; iso2: string };
type Evt = { id: number; icon: string; label: string; min: number };

const TIER: Record<Tier, { reach: number; color: string; label: string }> = {
  safe: { reach: 6, color: "#2f5f99", label: "settled" },
  attack: { reach: 16, color: "#f5c800", label: "attacking" },
  danger: { reach: 30, color: "#ff9f43", label: "DANGER" },
  high_danger: { reach: 44, color: "#ff5a67", label: "HIGH DANGER" },
};
const RING = 2 * Math.PI * 26;
const LIVE_REWARD = 50; // SPIKES per correct call on live matches
const PROMPT_WINDOW_MS = 5000; // a fired prompt owns this window (the bet-placement time); data arriving inside it won't spawn another
const STREAK_MILESTONE = 5; // streak length that awards a bonus
const STREAK_BONUS = 50; // live bonus SPIKES at the milestone (archived = 25)
const SAVE_DECIDE_MS = 6000; // live can't pause — auto-decline the streak-save after this
const fmtClock = (sec?: number) => {
  const s = Math.max(0, Math.floor(sec ?? 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function LiveMatch() {
  const params = useParams<{ fid: string }>();
  const fid = Number(params.fid);

  const [entry, setEntry] = useState<LiveEntry | null>(null);
  const [connected, setConnected] = useState(false);
  const [seen, setSeen] = useState(false);
  const [running, setRunning] = useState(false); // match clock running (false = HT/break/stall)
  const [finished, setFinished] = useState(false);
  const [tier, setTier] = useState<Tier>("safe");
  const [attacker, setAttacker] = useState<1 | 2>(1);
  const [displaySec, setDisplaySec] = useState(0); // monotonic, locally-ticked match clock
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [stats, setStats] = useState<MatchStats>(EMPTY_STATS); // cumulative corners + cards per side
  const [shootout, setShootout] = useState<{ p1: number; p2: number } | null>(null); // penalty shootout (PE)
  const [streak, setStreak] = useState(0);
  const [spotr, setSpotr] = useState(0);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [events, setEvents] = useState<Evt[]>([]);
  const [justWon, setJustWon] = useState<number[]>([]);
  const [graduated, setGraduated] = useState(false);
  const [saveOffer, setSaveOffer] = useState<{ cost: number; streak: number } | null>(null);

  // Live matches are always re-enterable: the one-shot lock applies only to the
  // archived replay (/match/[fid]). markPlayed still fires below so the archived
  // version stays one-shot once this match hits full time.
  // SPIKES shown = the persistent wallet balance (so spends/earns are real).
  useEffect(() => {
    setSpotr(getBalance());
  }, []);

  const promptRef = useRef<Prompt | null>(null);
  promptRef.current = prompt;
  const shootoutRef = useRef(false); // once the shootout starts, no more in-play prompts
  shootoutRef.current = !!shootout;
  const secRef = useRef(0);
  const lastTsRef = useRef(0); // newest feed record Ts (ms) from the stream — proof window key
  // Monotonic clock anchor: re-anchored only by a FORWARD server reading, then
  // interpolated locally each second so the ticker keeps moving through poll
  // gaps/dropouts and a stale snapshot can never drag the timer backwards.
  const clockAnchor = useRef({ seconds: 0, running: false, at: Date.now(), init: false });

  // The live clock is DECOUPLED from the TxLINE feed. We sync to the match ONCE
  // (first reading), then the timer free-runs locally — incoming feed data only
  // flips the running/paused state, it never re-anchors (and so never drags) the
  // displayed clock. This is why a data pull no longer disturbs the ticker.
  const applyClock = useCallback((c: Clock) => {
    const a = clockAnchor.current;
    if (!a.init) {
      clockAnchor.current = { seconds: c.Seconds, running: c.Running, at: Date.now(), init: true };
      secRef.current = c.Seconds;
      setDisplaySec(c.Seconds);
      setRunning(c.Running);
      return;
    }
    // Only react to a pause/resume. Re-anchor at the CURRENT displayed second so
    // no paused wall-time is added and the clock doesn't jump when play resumes.
    if (c.Running !== a.running) {
      a.seconds = secRef.current;
      a.at = Date.now();
      a.running = c.Running;
      setRunning(c.Running);
    }
  }, []);

  // Local 1s tick: advance from the anchor while the match clock is running.
  useEffect(() => {
    const id = setInterval(() => {
      const a = clockAnchor.current;
      const sec = a.running ? a.seconds + (Date.now() - a.at) / 1000 : a.seconds;
      secRef.current = Math.floor(sec);
      setDisplaySec(Math.floor(sec));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const lastPromptAt = useRef(0); // wall-clock ms of the last prompt — enforces the 5s bet window between prompts
  const betsRef = useRef<Bet[]>([]);
  const eventsRef = useRef<Evt[]>([]);
  const entryRef = useRef<LiveEntry | null>(null);
  entryRef.current = entry;
  const streakRef = useRef(0);
  streakRef.current = streak;
  const saveOfferRef = useRef<{ cost: number; streak: number } | null>(null);
  saveOfferRef.current = saveOffer;
  const bonusAwarded = useRef(false);
  const gameBetsRef = useRef(0);
  const maxStreakRef = useRef(0);
  // Skip the mount-pass save: hydration's setState hasn't committed yet, so the
  // first persistence run would read stale empty state and clobber the snapshot.
  const persistedOnce = useRef(false);

  const teamName = useCallback((side: 1 | 2) => (side === 2 ? entryRef.current?.p2 : entryRef.current?.p1) ?? (side === 2 ? "Away" : "Home"), []);
  const saveGame = useCallback(() => {
    recordGameStats(fid, `${entryRef.current?.p1 ?? "?"}–${entryRef.current?.p2 ?? "?"}`, maxStreakRef.current, gameBetsRef.current);
  }, [fid]);

  const addEvent = useCallback((icon: string, label: string) => {
    eventsRef.current = [{ id: Date.now() + Math.random(), icon, label, min: Math.floor(secRef.current / 60) }, ...eventsRef.current].slice(0, 12);
    setEvents(eventsRef.current.slice());
  }, []);

  // Tally a provable stat as it lands (goals come from the authoritative score).
  const bumpStat = useCallback((kind: string, side: 1 | 2) => {
    setStats((s) => {
      if (kind === "corner") return side === 1 ? { ...s, c1: s.c1 + 1 } : { ...s, c2: s.c2 + 1 };
      if (kind === "yellow") return side === 1 ? { ...s, y1: s.y1 + 1 } : { ...s, y2: s.y2 + 1 };
      if (kind === "red") return side === 1 ? { ...s, r1: s.r1 + 1 } : { ...s, r2: s.r2 + 1 };
      return s;
    });
  }, []);

  const applyResult = useCallback((win: boolean) => {
    if (win) {
      setSpotr((v) => v + LIVE_REWARD);
      setStreak((k) => k + 1);
    } else if (streakRef.current > 0 && !saveOfferRef.current) {
      setSaveOffer({ cost: streakSaveCost(), streak: streakRef.current });
    }
  }, []);

  const saveStreak = useCallback(() => {
    const r = buyStreakSave();
    if (r.ok) setSpotr((v) => v - r.cost); // streak kept; SPIKES spent
    else setStreak(0); // couldn't afford → streak ends
    setSaveOffer(null);
  }, []);
  const declineStreak = useCallback(() => {
    setStreak(0);
    setSaveOffer(null);
  }, []);

  // Full time: resolve any still-open bet whose window ran past the final whistle
  // (event didn't happen → NO wins / YES loses).
  const finalize = useCallback(() => {
    let changed = false;
    for (const b of betsRef.current) {
      if (b.status !== "open") continue;
      const win = b.choice === "NO";
      b.status = win ? "won" : "lost";
      const matchName = `${entryRef.current?.p1 ?? "?"}–${entryRef.current?.p2 ?? "?"}`;
      recordBet({ id: b.id, match: matchName, mins: b.mins, choice: b.choice, status: b.status, reward: win ? LIVE_REWARD : 0, at: Date.now() });
      settleBet({ client_bet_id: b.id, fixture_id: fid, match: matchName, mode: "live", market: b.market, side: b.side, mins: b.mins, choice: b.choice, outcome: b.status, reward: win ? LIVE_REWARD : 0, base_ts: b.baseTs, settle_ts: lastTsRef.current });
      if (win) {
        addBalance(LIVE_REWARD);
        setSpotr((v) => v + LIVE_REWARD);
        const id = b.id;
        celebrateFrom(`bet-${id}`);
        setJustWon((j) => [...j, id]);
        setTimeout(() => setJustWon((j) => j.filter((x) => x !== id)), 2400);
      }
      changed = true;
    }
    if (changed) setBets(betsRef.current.slice());
  }, [fid]);

  // Live can't pause, so a streak-save offer auto-declines after a short window.
  useEffect(() => {
    if (!saveOffer) return;
    const id = setTimeout(() => declineStreak(), SAVE_DECIDE_MS);
    return () => clearTimeout(id);
  }, [saveOffer, declineStreak]);

  // Settle open bets. A matching signal settles YES-as-win (→ confetti from that
  // bet's row); an elapsed window settles NO-as-win.
  const settle = useCallback(
    (signal: { kind: MarketKind; side: 1 | 2 } | null) => {
      const sec = secRef.current;
      let changed = false;
      for (const b of betsRef.current) {
        if (b.status !== "open") continue;
        let win: boolean | null = null;
        if (signal && marketMatches(b.market, b.side, signal)) win = b.choice === "YES";
        else if (sec > b.deadlineSec) win = b.choice === "NO";
        if (win === null) continue;
        b.status = win ? "won" : "lost";
        applyResult(win);
        const matchName = `${entryRef.current?.p1 ?? "?"}–${entryRef.current?.p2 ?? "?"}`;
        recordBet({ id: b.id, match: matchName, mins: b.mins, choice: b.choice, status: b.status, reward: win ? LIVE_REWARD : 0, at: Date.now() });
        settleBet({ client_bet_id: b.id, fixture_id: fid, match: matchName, mode: "live", market: b.market, side: b.side, mins: b.mins, choice: b.choice, outcome: b.status, reward: win ? LIVE_REWARD : 0, base_ts: b.baseTs, settle_ts: lastTsRef.current });
        if (win) {
          addBalance(LIVE_REWARD);
          const id = b.id;
          celebrateFrom(`bet-${id}`);
          setJustWon((j) => [...j, id]);
          setTimeout(() => setJustWon((j) => j.filter((x) => x !== id)), 2400);
        }
        changed = true;
      }
      if (changed) setBets(betsRef.current.slice());
    },
    [applyResult, fid]
  );

  // Spawn a prompt for an incoming feed signal. Guarantees the bet window: only
  // one prompt at a time, and once one fires it holds the floor for 5s — a second
  // data tick inside that window will NOT replace or stack a prompt, so the player
  // always gets the full bet-placement time on the call they're looking at.
  const firePrompt = useCallback((trigger: Trigger, side: 1 | 2) => {
    if (shootoutRef.current) return; // shootout announced — calls are closed
    if (promptRef.current) return;
    if (Date.now() - lastPromptAt.current < PROMPT_WINDOW_MS) return;
    const m = pickMarket(trigger, side);
    const mins = pickWindow(m.kind, true); // live → shorter 2–4 min windows
    const p: Prompt = { id: Date.now(), sec: secRef.current, mins, market: m.kind, side: m.side, question: marketQuestion(m.kind, teamName(m.side), mins), answered: null };
    lastPromptAt.current = Date.now();
    setPrompt(p);
    setTimeout(() => setPrompt((cur) => (cur && cur.id === p.id && !cur.answered ? null : cur)), PROMPT_WINDOW_MS);
  }, [teamName]);

  const answer = useCallback((choice: "YES" | "NO") => {
    const p = promptRef.current;
    if (!p || p.answered) return;
    setPrompt({ ...p, answered: choice });
    const bet: Bet = { id: p.id, market: p.market, side: p.side, mins: p.mins, choice, deadlineSec: p.sec + p.mins * 60, status: "open", label: marketLabel(p.market, p.side, teamName(p.side), p.mins), baseTs: lastTsRef.current };
    betsRef.current = [bet, ...betsRef.current].slice(0, 12);
    setBets(betsRef.current.slice());
    markPlayed(fid); // first call consumes this match (one-shot-per-match)
    gameBetsRef.current++;
    saveGame();
    setTimeout(() => setPrompt((cur) => (cur && cur.id === p.id ? null : cur)), 1300);
  }, [teamName, fid, saveGame]);

  // Streak milestone: actually credit the bonus, once per streak run.
  useEffect(() => {
    if (streak === 0) {
      bonusAwarded.current = false;
      return;
    }
    if (streak > maxStreakRef.current) {
      maxStreakRef.current = streak;
      saveGame();
    }
    if (streak >= STREAK_MILESTONE && !bonusAwarded.current) {
      bonusAwarded.current = true;
      addBalance(STREAK_BONUS);
      setSpotr((v) => v + STREAK_BONUS);
      setGraduated(true);
    }
  }, [streak, saveGame]);

  // Resolve team names + flags from the fixtures feed (live AND upcoming), so an
  // upcoming match (not in the live-only list) still renders its matchup.
  useEffect(() => {
    fetch("/api/fixtures").then((r) => r.json()).then((d) => setEntry((d.fixtures ?? []).find((m: LiveEntry) => m.fid === fid) ?? null)).catch(() => {});
  }, [fid]);

  // Hydrate the room from the last saved snapshot so a reload keeps the player's
  // streak, bets, events and scoreboard instead of resetting to empty. Feed data
  // (score/clock/momentum) self-heals on reconnect; this restores what doesn't.
  useEffect(() => {
    persistedOnce.current = false; // re-arm the skip-first guard for this fixture
    const snap = getLiveRoom(fid);
    if (!snap) return;
    betsRef.current = (snap.bets as Bet[]) ?? [];
    setBets(betsRef.current.slice());
    eventsRef.current = (snap.events as Evt[]) ?? [];
    setEvents(eventsRef.current.slice());
    setStreak(snap.streak ?? 0);
    streakRef.current = snap.streak ?? 0;
    maxStreakRef.current = snap.maxStreak ?? 0;
    gameBetsRef.current = snap.gameBets ?? 0;
    bonusAwarded.current = !!snap.bonusAwarded;
    setScore(snap.score ?? { p1: 0, p2: 0 });
    if (snap.stats) setStats(snap.stats);
    if (snap.shootout) setShootout(snap.shootout);
    if (snap.finished) setFinished(true);
    if (snap.sec) {
      secRef.current = snap.sec;
      setDisplaySec(snap.sec); // seed the clock so it doesn't flash 00:00 before the first poll
    }
  }, [fid]);

  // Persist the player-derived room state on every change (feed-derived score/sec
  // are captured too, as a reload seed). secRef/refs are read live at write time.
  useEffect(() => {
    if (!persistedOnce.current) {
      persistedOnce.current = true;
      return;
    }
    saveLiveRoom(fid, {
      bets,
      events,
      streak,
      maxStreak: maxStreakRef.current,
      gameBets: gameBetsRef.current,
      bonusAwarded: bonusAwarded.current,
      score,
      stats,
      shootout,
      sec: secRef.current,
      finished,
    });
  }, [fid, bets, events, streak, score, stats, shootout, finished]);

  useEffect(() => {
    const es = new EventSource(`/api/live-stream/${fid}`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      let ev: any;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.t === "ready") return;
      setSeen(true);
      if (ev.clock) applyClock(ev.clock);
      if (typeof ev.ts === "number" && ev.ts > 0) lastTsRef.current = ev.ts;
      if (ev.t === "momentum") {
        setTier(ev.tier);
        setAttacker(ev.participant);
        // Every live data tick is a prompt opportunity — except calm/safe
        // possession, which has no real chance worth betting on. firePrompt's 5s
        // window stops these from stacking.
        if (ev.tier !== "safe") firePrompt(ev.tier as Trigger, ev.participant === 2 ? 2 : 1);
      } else if (ev.t === "chance") {
        // Spike the meter to the attacking side, then offer a side-framed call.
        const trigger: Trigger = ev.trigger ?? "attack";
        const side: 1 | 2 = ev.side === 2 ? 2 : 1;
        setTier(trigger === "free_kick" || trigger === "shot" ? "danger" : (trigger as Tier));
        setAttacker(side);
        firePrompt(trigger, side);
      } else if (ev.t === "score") {
        // Trust the server's score directly — it is the single source of truth and
        // is correction-aware (handles VAR rollbacks). A client-side max would clamp
        // a disallowed goal back up and never let the score come down.
        setScore({ p1: ev.score.p1, p2: ev.score.p2 });
      } else if (ev.t === "shootout") {
        setShootout({ p1: ev.score.p1, p2: ev.score.p2 });
        setPrompt(null); // shootout started — close any open call
      } else if (ev.t === "stat") {
        const side: 1 | 2 = ev.side === 2 ? 2 : 1;
        if (ev.kind === "goal_disallowed") {
          // VAR chalked a goal off — record it honestly; don't settle (the goal
          // market already resolved when the goal first landed).
          addEvent("🚫", `Goal disallowed (VAR) — ${teamName(side)}`);
          settle(null);
          return;
        }
        if (ev.kind === "goal") addEvent("⚽", `Goal — ${teamName(side)}`);
        else if (ev.kind === "corner") addEvent("🚩", `Corner — ${teamName(side)}`);
        else if (ev.kind === "yellow") addEvent("🟨", `Yellow card — ${teamName(side)}`);
        else if (ev.kind === "red") addEvent("🟥", `Red card — ${teamName(side)}`);
        bumpStat(ev.kind, side);
        // Each stat kind is its own provable market (goal/corner/yellow/red).
        settle({ kind: ev.kind as MarketKind, side });
      } else if (ev.t === "event") {
        // Shots are highlights only — not a bettable market (not anchored on-chain).
        if (ev.kind === "shot") addEvent("👟", `Shot — ${teamName(ev.side === 2 ? 2 : 1)}`);
      } else if (ev.t === "feed") {
        if (ev.kind === "penalty") addEvent("🥅", "Penalty awarded");
        else if (ev.kind === "var") addEvent("📺", "VAR review");
        else if (ev.kind === "sub") addEvent("🔄", `Substitution — ${teamName(ev.side === 2 ? 2 : 1)}`);
      } else if (ev.t === "finished") {
        clockAnchor.current.seconds = secRef.current; // freeze the ticker at the current second
        clockAnchor.current.at = Date.now();
        clockAnchor.current.running = false;
        setRunning(false);
        setFinished(true);
        finalize(); // full time — resolve bets parked past FT
      }
      settle(null);
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [fid, settle, teamName, addEvent, bumpStat, finalize, applyClock, firePrompt]);

  const ti = TIER[tier];
  const hot = tier === "high_danger";
  // The feed pauses the clock at the break (Running:false). Surface it so a paused
  // match doesn't look broken — markets only fire while the ball is in play.
  const paused = seen && !running && !finished;
  const pauseLabel = displaySec >= 2640 && displaySec <= 2820 ? "Half-time" : "Play paused";

  return (
    <div className="min-h-screen">
      <main className="app-container py-6">
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 max-w-md lg:max-w-none mx-auto">
          <div className="lg:col-span-2 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <Link href="/play" className="text-muted hover:text-foreground text-sm">← matches</Link>
              <span className={`text-xs font-mono px-2 py-1 rounded-full border ${finished ? "text-muted border-white/10" : paused ? "text-primary border-primary/40" : connected ? "text-destructive border-destructive/40" : "text-muted border-white/10"}`}>
                {finished ? "FULL TIME" : paused ? `⏸ ${pauseLabel.toUpperCase()}` : connected ? "● LIVE" : "connecting…"}
              </span>
            </div>

            <div className="card-surface rounded-2xl p-4 flex items-center justify-between">
              <Team name={entry?.p1 ?? "Home"} iso={entry?.iso1} goals={score.p1} active={attacker === 1 && tier !== "safe"} />
              <div className="text-center">
                <div className="text-3xl font-black tabular-nums">{score.p1}<span className="text-muted mx-1">–</span>{score.p2}</div>
                {shootout ? (
                  <div className="text-[11px] font-bold text-primary mt-1">pens {shootout.p1}–{shootout.p2}</div>
                ) : (
                  <div className="text-xs font-mono text-muted mt-1">{fmtClock(displaySec)}</div>
                )}
              </div>
              <Team name={entry?.p2 ?? "Away"} iso={entry?.iso2} goals={score.p2} active={attacker === 2 && tier !== "safe"} right />
            </div>

            {shootout && (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-3 text-center">
                <p className="text-primary font-bold text-sm">
                  🥅 Penalty shootout — {teamName(1)} {shootout.p1}–{shootout.p2} {teamName(2)}
                  {finished && shootout.p1 !== shootout.p2 && (
                    <span className="text-foreground"> · {teamName(shootout.p1 > shootout.p2 ? 1 : 2)} win</span>
                  )}
                </p>
              </div>
            )}

            {paused && (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-center">
                <p className="text-primary font-bold text-sm">⏸ {pauseLabel} — markets are paused</p>
                <p className="text-muted text-xs mt-1">Calls open again as soon as the ball is back in play. The score stays live.</p>
              </div>
            )}

            <PitchMomentum tier={tier} attacker={attacker} iso1={entry?.iso1} iso2={entry?.iso2} label={ti.label} color={ti.color} hot={hot} score={score} />
            {!seen && <div className="text-muted text-xs -mt-2 text-center">waiting for the match to come alive…</div>}

            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <span className={`text-2xl ${streak > 0 ? "flame" : "opacity-30"}`}>🔥</span>
                <span className="font-black text-xl tabular-nums">{streak}</span>
                <span className="text-muted text-xs">streak</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-primary font-black text-xl tabular-nums">{spotr.toLocaleString()}</span>
                <span className="text-muted text-xs">SPIKES</span>
              </div>
            </div>

            <MatchStatsPanel
              p1={entry?.p1 ?? "Home"}
              p2={entry?.p2 ?? "Away"}
              stats={{ goals: [score.p1, score.p2], corners: [stats.c1, stats.c2], yellow: [stats.y1, stats.y2], red: [stats.r1, stats.r2] }}
            />

            {events.length > 0 && (
              <div className="card-surface rounded-2xl p-4">
                <div className="text-xs uppercase tracking-widest text-muted mb-2">Match events</div>
                <div className="flex flex-col gap-1.5">
                  {events.map((e) => (
                    <div key={e.id} className="flex items-center gap-2 text-sm">
                      <span className="text-muted font-mono text-xs w-8">{e.min}&apos;</span>
                      <span>{e.icon}</span>
                      <span className="text-foreground">{e.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

          <aside className="lg:col-span-1 mt-5 lg:mt-0">
            <div className="lg:sticky lg:top-6 card-surface rounded-2xl p-4">
              <div className="text-xs uppercase tracking-widest text-muted mb-2">Your bets</div>
              {bets.length === 0 && <span className="text-muted text-sm">no bets yet — tap YES / NO when a prompt fires.</span>}
              <div className="flex flex-col gap-2">
                {bets.map((b) => (
                  <div key={b.id} id={`bet-${b.id}`} className={`flex items-center justify-between text-sm gap-2 rounded-lg transition-all duration-300 ${justWon.includes(b.id) ? "bet-won-flash px-2 py-1 -mx-2" : ""}`}>
                    <span className="text-foreground truncate">
                      {b.label} · <span className={b.choice === "YES" ? "text-success font-bold" : "text-destructive font-bold"}>{b.choice}</span>
                    </span>
                    {b.status === "open" && <span className="text-primary text-xs font-mono shrink-0">⏳ {fmtClock(b.deadlineSec)}</span>}
                    {b.status === "won" && <span className="text-success text-xs font-bold shrink-0">✓ +{LIVE_REWARD}</span>}
                    {b.status === "lost" && <span className="text-destructive text-xs font-bold shrink-0">✕ missed</span>}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {prompt && <PromptCard prompt={prompt} onAnswer={answer} />}

      {saveOffer && <SaveStreakCard offer={saveOffer} balance={spotr} onSave={saveStreak} onDecline={declineStreak} />}

      {graduated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm px-6" onClick={() => setGraduated(false)}>
          <div className="card-surface gold-glow rounded-2xl p-8 max-w-sm text-center animate-pop">
            <div className="text-5xl mb-3">👁️</div>
            <h2 className="text-2xl font-black mb-2">You&apos;ve got the eye</h2>
            <p className="text-muted mb-5">{STREAK_MILESTONE}-streak! <span className="text-primary font-bold">+{STREAK_BONUS} SPIKES</span> credited. Keep it rolling.</p>
            <button onClick={() => setGraduated(false)} className="block w-full py-3 rounded-xl bg-primary text-background font-black gold-glow">Keep playing →</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Team({ name, iso, goals, active, right }: { name: string; iso?: string; goals: number; active: boolean; right?: boolean }) {
  return (
    <div className={`flex flex-col ${right ? "items-end" : "items-start"} gap-1.5 w-24`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {iso ? <img src={`/flags/${iso}.png`} alt={name} className="w-9 h-7 rounded object-cover ring-1 ring-white/10" /> : <div className="w-9 h-7 rounded bg-white/10" />}
      <span className={`text-sm font-bold truncate max-w-full ${active ? "text-primary" : "text-foreground"}`}>{name}</span>
      <span className="text-xs text-muted">{goals} goals</span>
    </div>
  );
}

function SaveStreakCard({ offer, balance, onSave, onDecline }: { offer: { cost: number; streak: number }; balance: number; onSave: () => void; onDecline: () => void }) {
  const affordable = balance >= offer.cost;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 pointer-events-none">
      <div className="w-full max-w-md card-surface gold-glow rounded-2xl p-5 animate-pop pointer-events-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-primary font-black uppercase tracking-wider text-sm">🔥 Save your {offer.streak}-streak?</span>
          <span className="text-muted text-xs font-mono">{balance.toLocaleString()} SPIKES</span>
        </div>
        <p className="text-muted text-sm mb-4">A wrong call is about to end your streak. Spend <span className="text-primary font-bold">{offer.cost} SPIKES</span> to keep it alive — <span className="text-foreground">costs more each save today.</span></p>
        <div className="grid grid-cols-2 gap-3">
          <button onClick={onDecline} className="py-3 rounded-xl bg-white/5 border border-white/10 text-muted font-bold active:scale-95 transition">Let it go</button>
          <button onClick={onSave} disabled={!affordable} className={`py-3 rounded-xl font-black active:scale-95 transition ${affordable ? "bg-primary text-background gold-glow" : "bg-white/5 border border-white/10 text-muted cursor-not-allowed"}`}>
            {affordable ? `Save · ${offer.cost}` : "Not enough"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptCard({ prompt, onAnswer }: { prompt: Prompt; onAnswer: (c: "YES" | "NO") => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const head = marketHeader(prompt.market);
  const answered = prompt.answered;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 pointer-events-none">
      <div className="w-full max-w-md card-surface danger-glow rounded-2xl p-5 animate-pop pointer-events-auto">
        <div className="flex items-center justify-between mb-4">
          <span className="text-destructive font-black uppercase tracking-wider text-sm">{head.icon} {head.text}</span>
          <svg width="56" height="56" viewBox="0 0 56 56" className="-my-2">
            <circle cx="28" cy="28" r="26" fill="none" stroke="#ffffff18" strokeWidth="4" />
            <circle cx="28" cy="28" r="26" fill="none" stroke="#ff5a67" strokeWidth="4" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={armed ? RING : 0} className="countdown-ring" transform="rotate(-90 28 28)" />
          </svg>
        </div>
        <p className="text-xl font-black mb-4 leading-snug">{prompt.question}</p>
        {answered ? (
          <div className="text-center py-3 text-muted font-medium">Locked in: <span className={answered === "YES" ? "text-success" : "text-destructive"}>{answered}</span> ✓</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => onAnswer("YES")} className="py-4 rounded-xl bg-success/15 border border-success/50 text-success font-black text-lg active:scale-95 transition">YES 👍</button>
            <button onClick={() => onAnswer("NO")} className="py-4 rounded-xl bg-destructive/15 border border-destructive/50 text-destructive font-black text-lg active:scale-95 transition">NO 👎</button>
          </div>
        )}
      </div>
    </div>
  );
}
