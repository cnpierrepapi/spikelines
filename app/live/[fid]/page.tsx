"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";

type Tier = "safe" | "attack" | "danger" | "high_danger";
type Clock = { Running: boolean; Seconds: number };
type Prompt = { id: number; sec: number; mins: number; answered: null | "YES" | "NO" };
type Stub = { id: number; win: boolean; hash: string };
type LiveEntry = { fid: number; p1: string; p2: string; iso1: string; iso2: string };

const TIER: Record<Tier, { reach: number; color: string; label: string }> = {
  safe: { reach: 6, color: "#2f5f99", label: "settled" },
  attack: { reach: 16, color: "#f5c800", label: "attacking" },
  danger: { reach: 30, color: "#ff9f43", label: "DANGER" },
  high_danger: { reach: 44, color: "#ff5a67", label: "HIGH DANGER" },
};
const RING = 2 * Math.PI * 26;
const LIVE_REWARD = 100;
const fmtClock = (c?: Clock) => (c ? `${String(Math.floor(c.Seconds / 60)).padStart(2, "0")}:${String(c.Seconds % 60).padStart(2, "0")}` : "00:00");
const rand = () => Math.random().toString(16).slice(2, 10);
function pickWindow() {
  const longs = [7, 8, 9, 10], shorts = [2, 3, 4, 5, 6];
  return Math.random() < 0.7 ? longs[Math.floor(Math.random() * longs.length)] : shorts[Math.floor(Math.random() * shorts.length)];
}

export default function LiveMatch() {
  const params = useParams<{ fid: string }>();
  const fid = Number(params.fid);

  const [entry, setEntry] = useState<LiveEntry | null>(null);
  const [connected, setConnected] = useState(false);
  const [seen, setSeen] = useState(false);
  const [tier, setTier] = useState<Tier>("safe");
  const [attacker, setAttacker] = useState<1 | 2>(1);
  const [clock, setClock] = useState<Clock | undefined>();
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [streak, setStreak] = useState(0);
  const [spotr, setSpotr] = useState(0);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [stubs, setStubs] = useState<Stub[]>([]);

  const promptRef = useRef<Prompt | null>(null);
  promptRef.current = prompt;
  const secRef = useRef(0);
  const cooldownSec = useRef(0);
  const watchers = useRef<{ id: number; choice: "YES" | "NO"; deadline: number }[]>([]);

  const resolve = useCallback((win: boolean) => {
    setStubs((s) => [{ id: Date.now() + Math.random(), win, hash: rand() }, ...s].slice(0, 10));
    if (win) {
      setSpotr((v) => v + LIVE_REWARD);
      setStreak((k) => k + 1);
    } else setStreak(0);
  }, []);

  const settleExpired = useCallback(() => {
    const sec = secRef.current;
    const exp = watchers.current.filter((w) => sec > w.deadline);
    if (exp.length) {
      for (const w of exp) resolve(w.choice === "NO");
      watchers.current = watchers.current.filter((w) => sec <= w.deadline);
    }
  }, [resolve]);

  const answer = useCallback((choice: "YES" | "NO") => {
    const p = promptRef.current;
    if (!p || p.answered) return;
    setPrompt({ ...p, answered: choice });
    watchers.current.push({ id: p.id, choice, deadline: p.sec + p.mins * 60 });
    setTimeout(() => setPrompt((cur) => (cur && cur.id === p.id ? null : cur)), 1300);
  }, []);

  useEffect(() => {
    if (streak >= 7) {
      /* graduation hook — kept subtle on live */
    }
  }, [streak]);

  useEffect(() => {
    fetch("/api/live").then((r) => r.json()).then((d) => setEntry((d.matches ?? []).find((m: LiveEntry) => m.fid === fid) ?? null)).catch(() => {});
  }, [fid]);

  useEffect(() => {
    const es = new EventSource(`/api/live-stream/${fid}`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      let ev: any;
      try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.t === "ready") return;
      setSeen(true);
      if (ev.clock) {
        setClock(ev.clock);
        secRef.current = ev.clock.Seconds;
      }
      if (ev.t === "momentum") {
        setTier(ev.tier);
        setAttacker(ev.participant);
        if (ev.tier === "high_danger" && !promptRef.current && secRef.current >= cooldownSec.current) {
          const p: Prompt = { id: Date.now(), sec: secRef.current, mins: pickWindow(), answered: null };
          setPrompt(p);
          cooldownSec.current = secRef.current + 90;
          setTimeout(() => setPrompt((cur) => (cur && cur.id === p.id && !cur.answered ? null : cur)), 5000);
        }
      } else if (ev.t === "score") {
        setScore(ev.score);
      } else if (ev.t === "goal") {
        setScore(ev.score);
        if (watchers.current.length) {
          for (const w of watchers.current) resolve(w.choice === "YES");
          watchers.current = [];
        }
      }
      settleExpired();
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [fid, resolve, settleExpired]);

  const ti = TIER[tier];
  const pos = 50 + (attacker === 2 ? ti.reach : -ti.reach);
  const hot = tier === "high_danger";

  return (
    <div className="min-h-screen w-full flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-md flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-muted hover:text-foreground text-sm">← matches</Link>
          <span className={`text-xs font-mono px-2 py-1 rounded-full border ${connected ? "text-destructive border-destructive/40" : "text-muted border-white/10"}`}>
            {connected ? "● LIVE" : "connecting…"}
          </span>
        </div>

        <div className="card-surface rounded-2xl p-4 flex items-center justify-between">
          <Team name={entry?.p1 ?? "Home"} iso={entry?.iso1} goals={score.p1} active={attacker === 1 && tier !== "safe"} />
          <div className="text-center">
            <div className="text-3xl font-black tabular-nums">{score.p1}<span className="text-muted mx-1">–</span>{score.p2}</div>
            <div className="text-xs font-mono text-muted mt-1">{fmtClock(clock)}</div>
          </div>
          <Team name={entry?.p2 ?? "Away"} iso={entry?.iso2} goals={score.p2} active={attacker === 2 && tier !== "safe"} right />
        </div>

        <div className={`card-surface rounded-2xl p-5 ${hot ? "danger-glow" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs uppercase tracking-widest text-muted">Momentum</span>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: ti.color }}>{hot && "⚠ "}{ti.label}</span>
          </div>
          <div className="relative h-3 rounded-full" style={{ background: "linear-gradient(90deg,#1b4f8c33,#0a1628 50%,#1b4f8c33)" }}>
            <div className={`absolute top-1/2 w-5 h-5 rounded-full transition-all duration-500 ${hot ? "orb-pulse" : ""}`} style={{ left: `${pos}%`, transform: "translate(-50%,-50%)", background: ti.color, boxShadow: `0 0 20px ${ti.color}` }} />
          </div>
          {!seen && <div className="text-muted text-xs mt-3 text-center">waiting for the match to come alive…</div>}
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

      </div>

      {prompt && <PromptCard prompt={prompt} onAnswer={answer} />}
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
        <p className="text-xl font-black mb-4 leading-snug">Goal in the next {prompt.mins} {prompt.mins === 1 ? "minute" : "minutes"}?</p>
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
