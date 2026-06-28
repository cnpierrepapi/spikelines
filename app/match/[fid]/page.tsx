"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import { recordBet, addBalance, hasPlayed, markPlayed, getBalance, streakSaveCost, buyStreakSave, isPaid, setPaid as persistPaid } from "@/lib/store";
import { celebrateFrom } from "@/lib/celebrate";
import { type MarketKind, type Side, type Trigger, sideOf, pickMarket, pickWindow, marketMatches, marketQuestion, marketLabel, marketHeader } from "@/lib/markets";

type Tier = "safe" | "attack" | "danger" | "high_danger";
type Clock = { Running: boolean; Seconds: number };
type Rec = {
  Action?: string;
  Score?: any;
  Clock?: Clock;
  Participant?: number;
  Participant1Id?: number;
  Participant2Id?: number;
  Data?: { Participant?: number };
  Ts?: number;
};
type Entry = { fid: number; p1: string; p2: string; iso1: string; iso2: string; minutes: number };
type Prompt = { id: number; sec: number; mins: number; market: MarketKind; side: Side; question: string; answered: null | "YES" | "NO" };
type Bet = { id: number; market: MarketKind; side: Side; mins: number; choice: "YES" | "NO"; deadlineSec: number; status: "open" | "won" | "lost"; label: string };

const TIER: Record<Tier, { reach: number; color: string; label: string }> = {
  safe: { reach: 6, color: "#2f5f99", label: "settled" },
  attack: { reach: 16, color: "#f5c800", label: "attacking" },
  danger: { reach: 30, color: "#ff9f43", label: "DANGER" },
  high_danger: { reach: 44, color: "#ff5a67", label: "HIGH DANGER" },
};
// Actions that open a betting prompt → the trigger the market picker uses.
const TRIGGER: Record<string, Trigger> = {
  high_danger_possession: "high_danger",
  penalty: "high_danger",
  danger_possession: "danger",
  attack_possession: "attack",
  shot: "shot",
  free_kick: "free_kick",
};
const RING = 2 * Math.PI * 26;
const ARCHIVED_REWARD = 5; // SPIKES per correct call on archived matches
const PROMPT_COOLDOWN = 45; // match-seconds between routine prompts
const HIGH_COOLDOWN = 15; // high-danger bypasses the routine cooldown
const STREAK_MILESTONE = 5; // streak length that awards a bonus
const STREAK_BONUS = 25; // archived bonus SPIKES at the milestone (live = 50)
const fmtClock = (c?: Clock) =>
  c ? `${String(Math.floor(c.Seconds / 60)).padStart(2, "0")}:${String(c.Seconds % 60).padStart(2, "0")}` : "00:00";
const tot = (score: any, p: string, k: string) => score?.[p]?.Total?.[k] ?? 0;

export default function ReplayMatch() {
  const params = useParams<{ fid: string }>();
  const fid = Number(params.fid);

  const [entry, setEntry] = useState<Entry | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [done, setDone] = useState(false);
  const [speed, setSpeed] = useState(1);

  const [tier, setTier] = useState<Tier>("safe");
  const [attacker, setAttacker] = useState<1 | 2>(1);
  const [clock, setClock] = useState<Clock | undefined>();
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [streak, setStreak] = useState(0);
  const [spotr, setSpotr] = useState(0);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [bets, setBets] = useState<Bet[]>([]);
  const [events, setEvents] = useState<{ id: number; icon: string; label: string; min: number }[]>([]);
  const [justWon, setJustWon] = useState<number[]>([]);
  const [graduated, setGraduated] = useState(false);
  const [blocked, setBlocked] = useState(false); // one-shot: already played this match
  const [saveOffer, setSaveOffer] = useState<{ cost: number; streak: number } | null>(null);
  const [paid, setPaidState] = useState(false); // $5 premium (stat overlay)
  const [stats, setStats] = useState({ s1: 0, s2: 0, poss1: 0, poss2: 0 });

  // Decide on mount only, so marking-as-played mid-game doesn't block the session.
  useEffect(() => {
    if (hasPlayed(fid)) setBlocked(true);
    setPaidState(isPaid());
  }, [fid]);
  // SPIKES shown = the persistent wallet balance (so spends/earns are real).
  useEffect(() => {
    setSpotr(getBalance());
  }, []);

  const recs = useRef<Rec[]>([]);
  const ptr = useRef(0);
  const paused = useRef(false);
  const prev = useRef({ g1: 0, g2: 0, c1: 0, c2: 0, y1: 0, y2: 0, r1: 0, r2: 0 });
  const secRef = useRef(0);
  const cooldownSec = useRef(0);
  const highCooldownSec = useRef(0);
  const promptRef = useRef<Prompt | null>(null);
  promptRef.current = prompt;
  const speedRef = useRef(1);
  speedRef.current = speed;
  const betsRef = useRef<Bet[]>([]);
  const eventsRef = useRef<{ id: number; icon: string; label: string; min: number }[]>([]);
  const entryRef = useRef<Entry | null>(null);
  entryRef.current = entry;
  const streakRef = useRef(0);
  streakRef.current = streak;
  const saveOfferRef = useRef<{ cost: number; streak: number } | null>(null);
  saveOfferRef.current = saveOffer;
  const bonusAwarded = useRef(false);
  const statsRef = useRef({ s1: 0, s2: 0, poss1: 0, poss2: 0 });

  const teamName = useCallback((side: 1 | 2) => (side === 2 ? entryRef.current?.p2 : entryRef.current?.p1) ?? (side === 2 ? "Away" : "Home"), []);

  const applyResult = useCallback((win: boolean) => {
    if (win) {
      setSpotr((v) => v + ARCHIVED_REWARD);
      setStreak((k) => k + 1);
    } else if (streakRef.current > 0 && !saveOfferRef.current) {
      // A wrong call would end the streak → offer to save it (don't reset yet).
      setSaveOffer({ cost: streakSaveCost(), streak: streakRef.current });
      paused.current = true; // freeze the replay for the decision
    }
  }, []);

  const saveStreak = useCallback(() => {
    const r = buyStreakSave();
    if (r.ok) setSpotr((v) => v - r.cost); // streak kept; SPIKES spent
    else setStreak(0); // couldn't afford → streak ends
    setSaveOffer(null);
    paused.current = false;
  }, []);
  const declineStreak = useCallback(() => {
    setStreak(0);
    setSaveOffer(null);
    paused.current = false;
  }, []);

  // Settle open bets: a matching signal settles YES-as-win; elapsed window → NO-win.
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
        recordBet({ id: b.id, match: `${entryRef.current?.p1 ?? "?"}–${entryRef.current?.p2 ?? "?"}`, mins: b.mins, choice: b.choice, status: b.status, reward: win ? ARCHIVED_REWARD : 0, at: Date.now() });
        if (win) {
          addBalance(ARCHIVED_REWARD);
          const id = b.id;
          celebrateFrom(`bet-${id}`);
          setJustWon((j) => [...j, id]);
          setTimeout(() => setJustWon((j) => j.filter((x) => x !== id)), 2400);
        }
        changed = true;
      }
      if (changed) setBets(betsRef.current.slice());
    },
    [applyResult]
  );

  const addEvent = useCallback((icon: string, label: string) => {
    eventsRef.current = [{ id: Date.now() + Math.random(), icon, label, min: Math.floor(secRef.current / 60) }, ...eventsRef.current].slice(0, 12);
    setEvents(eventsRef.current.slice());
  }, []);

  // Streak milestone: actually credit the bonus (was previously never awarded),
  // once per streak run. Reset the flag when the streak breaks.
  useEffect(() => {
    if (streak === 0) {
      bonusAwarded.current = false;
      return;
    }
    if (streak >= STREAK_MILESTONE && !bonusAwarded.current) {
      bonusAwarded.current = true;
      addBalance(STREAK_BONUS);
      setSpotr((v) => v + STREAK_BONUS);
      setGraduated(true);
    }
  }, [streak]);

  const answer = useCallback(
    (choice: "YES" | "NO") => {
      const p = promptRef.current;
      if (!p || p.answered) return;
      setPrompt({ ...p, answered: choice });
      const bet: Bet = { id: p.id, market: p.market, side: p.side, mins: p.mins, choice, deadlineSec: p.sec + p.mins * 60, status: "open", label: marketLabel(p.market, p.side, teamName(p.side === 0 ? 1 : (p.side as 1 | 2)), p.mins) };
      betsRef.current = [bet, ...betsRef.current].slice(0, 12);
      setBets(betsRef.current.slice());
      markPlayed(fid); // first call consumes this match (one-shot-per-match)
      setTimeout(() => {
        setPrompt((cur) => (cur && cur.id === p.id ? null : cur));
        paused.current = false; // resume replay
      }, 1300);
    },
    [teamName, fid]
  );

  // Load match data: prefer the curated static archive, else fall back to the
  // runtime replay endpoint (a finished match that was never pre-recorded).
  useEffect(() => {
    let on = true;
    (async () => {
      const idx: Entry[] = await fetch("/replays/index.json").then((r) => r.json()).catch(() => []);
      let data: Rec[] | null = null;
      let ent: Entry | null = idx.find((e) => e.fid === fid) ?? null;
      const fileRes = await fetch(`/replays/${fid}.json`).catch(() => null);
      if (fileRes && fileRes.ok) {
        data = await fileRes.json();
      } else {
        const j = await fetch(`/api/replay/${fid}`).then((r) => r.json()).catch(() => null);
        if (j && Array.isArray(j.recs) && j.recs.length) {
          data = j.recs;
          ent = ent ?? j.entry ?? null;
        }
      }
      if (!on) return;
      setEntry(ent);
      recs.current = data ?? [];
      setLoaded(true);
    })();
    return () => {
      on = false;
    };
  }, [fid]);

  const process = useCallback(
    (r: Rec) => {
      if (r.Clock) {
        setClock(r.Clock);
        secRef.current = r.Clock.Seconds;
      }
      const sec = secRef.current;

      // meter follows possession
      if (typeof r.Action === "string" && r.Action.endsWith("_possession")) {
        const t = r.Action.replace("_possession", "") as Tier;
        if (TIER[t]) {
          setTier(t);
          setAttacker(sideOf(r.Participant));
          if (sideOf(r.Participant) === 1) statsRef.current.poss1++; else statsRef.current.poss2++;
          setStats({ ...statsRef.current });
        }
      }

      // prompt trigger (attack / danger / high_danger / shot / free_kick).
      // high_danger bypasses the routine cooldown so a sudden chance always asks.
      const trig = TRIGGER[r.Action as string];
      const gate = trig === "high_danger" ? highCooldownSec.current : cooldownSec.current;
      if (trig && !promptRef.current && sec >= gate) {
        const side = sideOf(r.Participant);
        const m = pickMarket(trig, side);
        const mins = pickWindow(m.kind);
        const qSide: 1 | 2 = m.side === 0 ? side : (m.side as 1 | 2);
        const p: Prompt = { id: Date.now(), sec, mins, market: m.kind, side: m.side, question: marketQuestion(m.kind, teamName(qSide), mins), answered: null };
        setPrompt(p);
        paused.current = true; // freeze-frame for the call
        cooldownSec.current = sec + PROMPT_COOLDOWN;
        highCooldownSec.current = sec + HIGH_COOLDOWN;
        setTimeout(() => {
          setPrompt((cur) => {
            if (cur && cur.id === p.id && !cur.answered) {
              paused.current = false;
              return null;
            }
            return cur;
          });
        }, 5000);
      }

      if (r.Action === "shot") { addEvent("👟", `Shot — ${teamName(sideOf(r.Participant))}`); if (sideOf(r.Participant) === 1) statsRef.current.s1++; else statsRef.current.s2++; setStats({ ...statsRef.current }); settle({ kind: "shot", side: sideOf(r.Participant) }); }
      else if (r.Action === "penalty") addEvent("🥅", "Penalty awarded");
      else if (r.Action === "var") addEvent("📺", "VAR review");
      else if (r.Action === "substitution") addEvent("🔄", `Substitution${r.Data?.Participant ? ` — ${teamName(r.Data.Participant === 2 ? 2 : 1)}` : ""}`);

      // goals / cards / corners via cumulative-total deltas
      if (r.Score) {
        // Cumulative stats only increase — never let a record with a partial
        // Score.Total drop the running tally.
        const pc = prev.current;
        const cur = {
          g1: Math.max(pc.g1, tot(r.Score, "Participant1", "Goals")), g2: Math.max(pc.g2, tot(r.Score, "Participant2", "Goals")),
          c1: Math.max(pc.c1, tot(r.Score, "Participant1", "Corners")), c2: Math.max(pc.c2, tot(r.Score, "Participant2", "Corners")),
          y1: Math.max(pc.y1, tot(r.Score, "Participant1", "YellowCards")), y2: Math.max(pc.y2, tot(r.Score, "Participant2", "YellowCards")),
          r1: Math.max(pc.r1, tot(r.Score, "Participant1", "RedCards")), r2: Math.max(pc.r2, tot(r.Score, "Participant2", "RedCards")),
        };
        const n1 = entryRef.current?.p1 ?? "Home";
        const n2 = entryRef.current?.p2 ?? "Away";
        if (cur.g1 > pc.g1) { addEvent("⚽", `Goal — ${n1}`); settle({ kind: "goal", side: 1 }); }
        if (cur.g2 > pc.g2) { addEvent("⚽", `Goal — ${n2}`); settle({ kind: "goal", side: 2 }); }
        if (cur.c1 > pc.c1) { addEvent("🚩", `Corner — ${n1}`); settle({ kind: "corner", side: 1 }); }
        if (cur.c2 > pc.c2) { addEvent("🚩", `Corner — ${n2}`); settle({ kind: "corner", side: 2 }); }
        if (cur.r1 > pc.r1) { addEvent("🟥", `Red card — ${n1}`); settle({ kind: "booking", side: 1 }); }
        if (cur.r2 > pc.r2) { addEvent("🟥", `Red card — ${n2}`); settle({ kind: "booking", side: 2 }); }
        if (cur.y1 > pc.y1) { addEvent("🟨", `Yellow — ${n1}`); settle({ kind: "booking", side: 1 }); }
        if (cur.y2 > pc.y2) { addEvent("🟨", `Yellow — ${n2}`); settle({ kind: "booking", side: 2 }); }
        prev.current = cur;
        setScore({ p1: cur.g1, p2: cur.g2 });
      }

      // settle "no" calls whose window has elapsed
      settle(null);
    },
    [settle, addEvent, teamName]
  );

  // Replay loop
  useEffect(() => {
    if (!loaded || blocked || recs.current.length === 0) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!alive) return;
      if (!paused.current) {
        if (ptr.current >= recs.current.length) {
          setDone(true);
          return;
        }
        process(recs.current[ptr.current]);
        ptr.current++;
      }
      timer = setTimeout(tick, 150 / speedRef.current);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [loaded, blocked, process]);

  const ti = TIER[tier];
  const pos = 50 + (attacker === 2 ? ti.reach : -ti.reach);
  const hot = tier === "high_danger";
  const progress = recs.current.length ? Math.min(100, Math.round((ptr.current / recs.current.length) * 100)) : 0;

  if (blocked) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="text-5xl">✓</div>
        <p className="text-foreground font-bold text-lg">You&apos;ve already played this match.</p>
        <p className="text-muted text-sm max-w-xs">Each match can only be played once — pick another to keep building your streak.</p>
        <Link href="/" className="text-primary font-bold mt-2">← back to matches</Link>
      </div>
    );
  }

  if (loaded && recs.current.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted">Couldn&apos;t load this match.</p>
        <Link href="/" className="text-primary font-bold">← back to matches</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="app-container py-6">
        <div className="lg:grid lg:grid-cols-3 lg:gap-6 max-w-md lg:max-w-none mx-auto">
          <div className="lg:col-span-2 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-muted hover:text-foreground text-sm">← matches</Link>
          <div className="flex items-center gap-2">
            {[1, 2, 4].map((s) => (
              <button key={s} onClick={() => setSpeed(s)} className={`text-xs font-mono px-2 py-1 rounded-md border ${speed === s ? "border-primary text-primary" : "border-white/10 text-muted"}`}>
                {s}×
              </button>
            ))}
          </div>
        </div>

        <div className="card-surface rounded-2xl p-4 flex items-center justify-between">
          <Team name={entry?.p1 ?? "Home"} iso={entry?.iso1} goals={score.p1} active={attacker === 1 && tier !== "safe"} />
          <div className="text-center">
            <div className="text-3xl font-black tabular-nums">
              {score.p1}<span className="text-muted mx-1">–</span>{score.p2}
            </div>
            <div className="text-xs font-mono text-muted mt-1">{fmtClock(clock)}</div>
          </div>
          <Team name={entry?.p2 ?? "Away"} iso={entry?.iso2} goals={score.p2} active={attacker === 2 && tier !== "safe"} right />
        </div>

        <div className={`card-surface rounded-2xl p-5 ${hot ? "danger-glow" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-widest text-muted">Momentum</span>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: ti.color }}>
              {hot && "⚠ "}{ti.label}
            </span>
          </div>
          <div className="relative h-3 rounded-full" style={{ background: "linear-gradient(90deg,#1b4f8c33,#0a1628 50%,#1b4f8c33)" }}>
            <div className={`absolute top-1/2 w-5 h-5 rounded-full transition-all duration-500 ${hot ? "orb-pulse" : ""}`} style={{ left: `${pos}%`, transform: "translate(-50%,-50%)", background: ti.color, boxShadow: `0 0 20px ${ti.color}` }} />
          </div>
          <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full bg-primary/40" style={{ width: `${progress}%` }} />
          </div>
        </div>

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

            <StatsOverlay paid={paid} stats={stats} p1={entry?.p1 ?? "Home"} p2={entry?.p2 ?? "Away"} onUnlock={() => { persistPaid(true); setPaidState(true); }} />

            {done && (
              <div className="text-center text-muted text-sm">
                Full time. <Link href="/" className="text-primary font-bold">pick another match →</Link>
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
                    {b.status === "open" && <span className="text-primary text-xs font-mono shrink-0">⏳ {fmtClock({ Running: true, Seconds: b.deadlineSec })}</span>}
                    {b.status === "won" && <span className="text-success text-xs font-bold shrink-0">✓ +{ARCHIVED_REWARD}</span>}
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
            <p className="text-muted mb-5">{STREAK_MILESTONE}-streak! <span className="text-primary font-bold">+{STREAK_BONUS} SPIKES</span> credited. Ready for sharper calls?</p>
            <a href="https://flashcalls.vercel.app" target="_blank" rel="noopener noreferrer" className="block w-full py-3 rounded-xl bg-primary text-background font-black gold-glow">Try Flashcalls →</a>
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

function StatsOverlay({ paid, stats, p1, p2, onUnlock }: { paid: boolean; stats: { s1: number; s2: number; poss1: number; poss2: number }; p1: string; p2: string; onUnlock: () => void }) {
  if (!paid) {
    return (
      <button onClick={onUnlock} className="card-surface rounded-2xl p-4 w-full text-left hover:border-primary/40 transition">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted mb-1">🔒 Live stats</div>
            <div className="text-sm text-foreground font-bold">Unlock shots, possession &amp; danger read</div>
          </div>
          <span className="px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/50 text-primary text-sm font-black shrink-0">$5</span>
        </div>
      </button>
    );
  }
  const tot = stats.poss1 + stats.poss2;
  const pct1 = tot ? Math.round((stats.poss1 / tot) * 100) : 50;
  return (
    <div className="card-surface rounded-2xl p-4">
      <div className="text-xs uppercase tracking-widest text-muted mb-3">Live stats <span className="text-primary">· premium</span></div>
      <div className="flex items-center justify-between text-3xl font-black tabular-nums mb-1">
        <span>{stats.s1}</span><span className="text-muted text-xs self-center uppercase tracking-widest">shots</span><span>{stats.s2}</span>
      </div>
      <div className="text-[11px] text-muted flex justify-between mb-4"><span>{p1}</span><span>{p2}</span></div>
      <div className="text-xs text-muted mb-1 flex justify-between"><span>possession</span><span>{pct1}% · {100 - pct1}%</span></div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden flex">
        <div className="h-full bg-primary" style={{ width: `${pct1}%` }} />
        <div className="h-full bg-accent" style={{ width: `${100 - pct1}%` }} />
      </div>
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
          <div className="text-center py-3 text-muted font-medium">
            Locked in: <span className={answered === "YES" ? "text-success" : "text-destructive"}>{answered}</span> ✓
          </div>
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
