"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";

type Tier = "safe" | "attack" | "danger" | "high_danger";
type Clock = { Running: boolean; Seconds: number };
type Rec = {
  Action?: string;
  Score?: any;
  Clock?: Clock;
  Participant?: number;
  Participant1Id?: number;
  Participant2Id?: number;
  Ts?: number;
};
type Entry = { fid: number; p1: string; p2: string; iso1: string; iso2: string; minutes: number };
type Prompt = { id: number; sec: number; answered: null | "YES" | "NO" };
type Stub = { id: number; win: boolean; hash: string };

const TIER: Record<Tier, { reach: number; color: string; label: string }> = {
  safe: { reach: 6, color: "#2f5f99", label: "settled" },
  attack: { reach: 16, color: "#f5c800", label: "attacking" },
  danger: { reach: 30, color: "#ff9f43", label: "DANGER" },
  high_danger: { reach: 44, color: "#ff5a67", label: "HIGH DANGER" },
};
const RING = 2 * Math.PI * 26;
const RESOLVE_SEC = 120; // a goal within 2 match-minutes = "goal happened"
const fmtClock = (c?: Clock) =>
  c ? `${String(Math.floor(c.Seconds / 60)).padStart(2, "0")}:${String(c.Seconds % 60).padStart(2, "0")}` : "00:00";
const rand = () => Math.random().toString(16).slice(2, 10);
const totalGoals = (score: any, p: string) => score?.[p]?.Total?.Goals ?? 0;
const totalReds = (score: any, p: string) => score?.[p]?.Total?.RedCards ?? 0;

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
  const [stubs, setStubs] = useState<Stub[]>([]);
  const [graduated, setGraduated] = useState(false);

  const recs = useRef<Rec[]>([]);
  const ptr = useRef(0);
  const paused = useRef(false);
  const prev = useRef({ p1g: 0, p2g: 0, p1r: 0, p2r: 0 });
  const secRef = useRef(0);
  const cooldownSec = useRef(0);
  const promptRef = useRef<Prompt | null>(null);
  promptRef.current = prompt;
  const speedRef = useRef(1);
  speedRef.current = speed;
  const p2idRef = useRef<number | undefined>(undefined);
  const watchers = useRef<{ id: number; choice: "YES" | "NO"; deadline: number }[]>([]);

  const resolve = useCallback((win: boolean) => {
    setStubs((s) => [{ id: Date.now() + Math.random(), win, hash: rand() }, ...s].slice(0, 10));
    if (win) {
      setSpotr((v) => v + 250);
      setStreak((k) => k + 1);
    } else {
      setStreak(0);
    }
  }, []);

  useEffect(() => {
    if (streak >= 7) setGraduated(true);
  }, [streak]);

  const answer = useCallback(
    (choice: "YES" | "NO") => {
      const p = promptRef.current;
      if (!p || p.answered) return;
      setPrompt({ ...p, answered: choice });
      watchers.current.push({ id: p.id, choice, deadline: p.sec + RESOLVE_SEC });
      cooldownSec.current = p.sec + 90;
      setTimeout(() => {
        setPrompt((cur) => (cur && cur.id === p.id ? null : cur));
        paused.current = false; // resume replay
      }, 1300);
    },
    []
  );

  // Load match data
  useEffect(() => {
    let on = true;
    Promise.all([
      fetch("/replays/index.json").then((r) => r.json()),
      fetch(`/replays/${fid}.json`).then((r) => r.json()),
    ])
      .then(([idx, data]: [Entry[], Rec[]]) => {
        if (!on) return;
        setEntry(idx.find((e) => e.fid === fid) ?? null);
        recs.current = data;
        p2idRef.current = data.find((r) => r.Participant2Id != null)?.Participant2Id;
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
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

      // momentum
      if (typeof r.Action === "string" && r.Action.endsWith("_possession")) {
        const t = r.Action.replace("_possession", "") as Tier;
        if (TIER[t]) {
          setTier(t);
          setAttacker(r.Participant === p2idRef.current ? 2 : 1);
          if (t === "high_danger" && !promptRef.current && sec >= cooldownSec.current) {
            const p: Prompt = { id: Date.now(), sec, answered: null };
            setPrompt(p);
            paused.current = true; // freeze-frame for the call
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
        }
      }

      // goals / red cards via score deltas
      if (r.Score) {
        const p1g = totalGoals(r.Score, "Participant1");
        const p2g = totalGoals(r.Score, "Participant2");
        const p1r = totalReds(r.Score, "Participant1");
        const p2r = totalReds(r.Score, "Participant2");
        const goal = p1g > prev.current.p1g || p2g > prev.current.p2g;
        prev.current = { p1g, p2g, p1r, p2r };
        setScore({ p1: p1g, p2: p2g });
        if (goal && watchers.current.length) {
          for (const w of watchers.current) resolve(w.choice === "YES");
          watchers.current = [];
        }
      }

      // settle "no goal" calls whose 2-min window has elapsed
      if (watchers.current.length) {
        const expired = watchers.current.filter((w) => sec > w.deadline);
        if (expired.length) {
          for (const w of expired) resolve(w.choice === "NO");
          watchers.current = watchers.current.filter((w) => sec <= w.deadline);
        }
      }
    },
    [resolve]
  );

  // Replay loop
  useEffect(() => {
    if (!loaded || recs.current.length === 0) return;
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
      timer = setTimeout(tick, 200 / speedRef.current);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [loaded, process]);

  const ti = TIER[tier];
  const pos = 50 + (attacker === 2 ? ti.reach : -ti.reach);
  const hot = tier === "high_danger";
  const progress = recs.current.length ? Math.min(100, Math.round((ptr.current / recs.current.length) * 100)) : 0;

  if (loaded && recs.current.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-muted">Couldn&apos;t load this match.</p>
        <Link href="/" className="text-primary font-bold">← back to matches</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md flex flex-col gap-5">
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
            <span className="text-muted text-xs">SPOTR</span>
          </div>
        </div>

        <div className="card-surface rounded-2xl p-4">
          <div className="text-xs uppercase tracking-widest text-muted mb-2">Proofs · verified on-chain</div>
          <div className="flex flex-wrap gap-2">
            {stubs.length === 0 && <span className="text-muted text-sm">your calls will be stamped here — wins and losses, un-deletable.</span>}
            {stubs.map((s) => (
              <div key={s.id} className={`text-[11px] font-mono px-2 py-1 rounded-md border ${s.win ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}`}>
                {s.win ? "✓" : "✕"} {s.hash}
              </div>
            ))}
          </div>
        </div>

        {done && (
          <div className="text-center text-muted text-sm">
            Full time. <Link href="/" className="text-primary font-bold">pick another match →</Link>
          </div>
        )}
      </div>

      {prompt && <PromptCard prompt={prompt} onAnswer={answer} />}

      {graduated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm px-6" onClick={() => setGraduated(false)}>
          <div className="card-surface gold-glow rounded-2xl p-8 max-w-sm text-center animate-pop">
            <div className="text-5xl mb-3">👁️</div>
            <h2 className="text-2xl font-black mb-2">You&apos;ve got the eye</h2>
            <p className="text-muted mb-5">7-streak. <span className="text-primary font-bold">500 SPOTR</span> is yours — claim it in Flashcalls.</p>
            <button className="w-full py-3 rounded-xl bg-primary text-background font-black gold-glow">Claim 500 SPOTR →</button>
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

function PromptCard({ prompt, onAnswer }: { prompt: Prompt; onAnswer: (c: "YES" | "NO") => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const answered = prompt.answered;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 pointer-events-none">
      <div className="w-full max-w-md card-surface danger-glow rounded-2xl p-5 animate-pop pointer-events-auto">
        <div className="flex items-center justify-between mb-4">
          <span className="text-destructive font-black uppercase tracking-wider text-sm">⚡ High danger</span>
          <svg width="56" height="56" viewBox="0 0 56 56" className="-my-2">
            <circle cx="28" cy="28" r="26" fill="none" stroke="#ffffff18" strokeWidth="4" />
            <circle cx="28" cy="28" r="26" fill="none" stroke="#ff5a67" strokeWidth="4" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={armed ? RING : 0} className="countdown-ring" transform="rotate(-90 28 28)" />
          </svg>
        </div>
        <p className="text-xl font-black mb-4 leading-snug">Goal in the next 2 minutes?</p>
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
