"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBalance, getBets, getPlayed, type StoredBet } from "@/lib/store";
import UsernameGate from "@/components/UsernameGate";
import { syncProfile } from "@/lib/remote";

type Archived = { fid: number; p1: string; p2: string; iso1: string; iso2: string; goals: number; minutes: number };
type Live = { fid: number; p1: string; p2: string; iso1: string; iso2: string };
type Fixture = { fid: number; p1: string; p2: string; iso1: string; iso2: string; startTime: number; live: boolean; strength: number };

function Flag({ iso, alt, big }: { iso: string; alt: string; big?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/flags/${iso}.png`} alt={alt} className={`${big ? "w-16 h-12" : "w-9 h-7"} rounded object-cover ring-1 ring-white/10 shrink-0`} />;
}

function kickoff(ms: number) {
  const d = ms - Date.now();
  if (d <= 0) return "now";
  const h = Math.floor(d / 3_600_000);
  if (h < 24) return h < 1 ? `${Math.ceil(d / 60_000)}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function Lobby() {
  const [archived, setArchived] = useState<Archived[] | null>(null);
  const [runtimeArch, setRuntimeArch] = useState<Archived[]>([]);
  const [live, setLive] = useState<Live[] | null>(null);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [balance, setBalance] = useState(0);
  const [recent, setRecent] = useState<StoredBet[]>([]);
  const [played, setPlayed] = useState<number[]>([]);

  useEffect(() => {
    fetch("/replays/index.json").then((r) => r.json()).then(setArchived).catch(() => setArchived([]));
    fetch("/api/archived").then((r) => r.json()).then((d) => setRuntimeArch(d.matches ?? [])).catch(() => setRuntimeArch([]));
    fetch("/api/live").then((r) => r.json()).then((d) => setLive(d.matches ?? [])).catch(() => setLive([]));
    fetch("/api/fixtures").then((r) => r.json()).then((d) => setFixtures(d.fixtures ?? [])).catch(() => setFixtures([]));
    setBalance(getBalance());
    setRecent(getBets().slice(0, 8));
    setPlayed(getPlayed());
    syncProfile(); // push local score/spikes to the leaderboard backend
  }, []);

  // Archived = curated static replays + recently-finished matches (runtime),
  // de-duplicated (static wins).
  const staticFids = new Set((archived ?? []).map((a) => a.fid));
  const allArchived = [...(archived ?? []), ...runtimeArch.filter((m) => !staticFids.has(m.fid))];

  const heroFix = fixtures[0];
  const heroArch = allArchived[0];

  // A finished match lives in Archived — don't also show it as Live.
  const archivedFids = new Set(allArchived.map((a) => a.fid));
  const liveOnly = (live ?? []).filter((m) => !archivedFids.has(m.fid));
  // Upcoming = fixtures that haven't kicked off yet (and aren't already archived
  // or shown as the hero).
  const upcoming = fixtures.filter((f) => !f.live && !archivedFids.has(f.fid) && f.fid !== heroFix?.fid);

  return (
    <div className="min-h-screen">
      <UsernameGate />
      <nav className="sticky top-0 z-30 nav-blur border-b border-white/[0.06]">
        <div className="app-container flex items-center justify-between py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-primary font-black text-xl tracking-tight">SPIKES</span>
            <span className="text-muted text-sm">· Spikelines</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/leaderboard" className="text-sm text-muted hover:text-foreground">Leaderboard</Link>
            <Link href="/profile" className="text-sm text-muted hover:text-foreground">Profile</Link>
            <Link href="/profile" className="text-sm font-mono px-3 py-1.5 rounded-full border border-white/10 hover:border-primary/40 transition">
              <span className="text-primary font-bold">{balance.toLocaleString()}</span> <span className="text-muted">SPIKES</span>
            </Link>
          </div>
        </div>
      </nav>

      <main className="app-container py-6">
        <div className="lg:grid lg:grid-cols-3 lg:gap-8">
          {/* main column */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            {/* HERO */}
            <HeroMatch fix={heroFix} arch={heroArch} />

            {/* LIVE */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs uppercase tracking-widest text-destructive font-bold">● Live</span>
                <span className="text-[11px] text-muted">real-time · 50 SPIKES / correct</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {live === null && <div className="text-muted text-sm">checking…</div>}
                {live !== null && liveOnly.length === 0 && <div className="card-surface rounded-2xl p-4 text-muted text-sm sm:col-span-2">No live matches right now — play an archived one.</div>}
                {liveOnly.map((m) => (
                  <MatchRow key={m.fid} href={`/live/${m.fid}`} m={m} live played={played.includes(m.fid)} />
                ))}
              </div>
            </section>

            {/* UPCOMING */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs uppercase tracking-widest text-primary font-bold">Upcoming</span>
                <span className="text-[11px] text-muted">kicks off soon · 50 SPIKES / correct</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {fixtures.length === 0 && <div className="text-muted text-sm">checking…</div>}
                {fixtures.length > 0 && upcoming.length === 0 && <div className="card-surface rounded-2xl p-4 text-muted text-sm sm:col-span-2">No upcoming matches in the next few days.</div>}
                {upcoming.map((m) => (
                  <MatchRow key={m.fid} href={`/live/${m.fid}`} m={m} sub={`kicks off ${kickoff(m.startTime)}`} played={played.includes(m.fid)} />
                ))}
              </div>
            </section>

            {/* ARCHIVED */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs uppercase tracking-widest text-muted font-bold">Archived</span>
                <span className="text-[11px] text-muted">from kickoff · 15 SPIKES / correct</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {archived === null && <div className="text-muted text-sm">loading…</div>}
                {allArchived.map((m) => (
                  <MatchRow key={m.fid} href={`/match/${m.fid}`} m={m} thriller={m.goals >= 4} sub={`${m.minutes}' · World Cup`} played={played.includes(m.fid)} />
                ))}
              </div>
            </section>
          </div>

          {/* sidebar */}
          <aside className="mt-8 lg:mt-0 lg:col-span-1">
            <div className="lg:sticky lg:top-20 flex flex-col gap-4">
              <div className="card-surface rounded-2xl p-5">
                <div className="text-xs uppercase tracking-widest text-muted mb-3">Your bets</div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-primary font-black text-3xl tabular-nums">{balance.toLocaleString()}</span>
                  <span className="text-muted text-sm">SPIKES</span>
                </div>
                {recent.length === 0 && <p className="text-muted text-sm">no bets yet — pick a match and tap the momentum.</p>}
                <div className="flex flex-col gap-2">
                  {recent.map((b) => (
                    <div key={b.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted truncate pr-2">{b.match} · {b.choice}</span>
                      <span className={b.status === "won" ? "text-success font-bold text-xs" : "text-destructive font-bold text-xs"}>{b.status === "won" ? `+${b.reward}` : "✕"}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card-surface rounded-2xl p-5">
                <div className="text-xs uppercase tracking-widest text-muted mb-2">How it works</div>
                <p className="text-muted text-sm leading-relaxed">When a team <span className="text-primary font-semibold">builds an attack</span>, a quick call fires — will they <span className="text-foreground font-semibold">score, win a corner or get a shot away</span> (or will someone get booked) before the window closes? Tap YES / NO, build a streak. Every match runs on TxLINE&apos;s verifiable World Cup feed, anchored on Solana.</p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function HeroMatch({ fix, arch }: { fix?: Fixture; arch?: Archived }) {
  // Prefer a live/upcoming headline fixture; fall back to the top archived match.
  if (fix) {
    const href = `/live/${fix.fid}`;
    const inner = (
      <div className="relative overflow-hidden rounded-3xl hero-bg border border-white/10 p-8 sm:p-10">
        <div className="absolute inset-x-0 bottom-0 h-24 hero-fade pointer-events-none" />
        <div className="flex items-center justify-between mb-6">
          {fix.live ? (
            <span className="text-destructive text-xs font-black uppercase tracking-wider animate-pulse">● Live now</span>
          ) : (
            <span className="text-primary text-xs font-bold uppercase tracking-wider">kicks off in {kickoff(fix.startTime)}</span>
          )}
          <span className="text-muted text-[11px] uppercase tracking-widest">Headline match</span>
        </div>
        <div className="flex items-center justify-center gap-6 sm:gap-10 mb-7">
          <div className="flex flex-col items-center gap-2 w-28">
            <Flag iso={fix.iso1} alt={fix.p1} big />
            <span className="font-black text-center leading-tight">{fix.p1}</span>
          </div>
          <span className="text-muted font-black text-2xl">VS</span>
          <div className="flex flex-col items-center gap-2 w-28">
            <Flag iso={fix.iso2} alt={fix.p2} big />
            <span className="font-black text-center leading-tight">{fix.p2}</span>
          </div>
        </div>
        <div className="relative z-10 flex justify-center">
          {fix.live ? (
            <span className="px-6 py-3 rounded-xl bg-destructive/20 border border-destructive/50 text-destructive font-black">Watch live →</span>
          ) : (
            <span className="px-6 py-3 rounded-xl bg-primary/15 border border-primary/50 text-primary font-black">View match →</span>
          )}
        </div>
      </div>
    );
    return href ? <Link href={href}>{inner}</Link> : inner;
  }
  if (arch) {
    return (
      <Link href={`/match/${arch.fid}`}>
        <div className="relative overflow-hidden rounded-3xl hero-bg border border-white/10 p-8 sm:p-10">
          <div className="absolute inset-x-0 bottom-0 h-24 hero-fade pointer-events-none" />
          <div className="flex items-center justify-between mb-6">
            <span className="text-primary text-xs font-bold uppercase tracking-wider">Featured replay</span>
            <span className="text-muted text-[11px] uppercase tracking-widest">From kickoff</span>
          </div>
          <div className="flex items-center justify-center gap-6 sm:gap-10 mb-7">
            <div className="flex flex-col items-center gap-2 w-28">
              <Flag iso={arch.iso1} alt={arch.p1} big />
              <span className="font-black text-center leading-tight">{arch.p1}</span>
            </div>
            <span className="text-muted font-black text-2xl">VS</span>
            <div className="flex flex-col items-center gap-2 w-28">
              <Flag iso={arch.iso2} alt={arch.p2} big />
              <span className="font-black text-center leading-tight">{arch.p2}</span>
            </div>
          </div>
          <div className="relative z-10 flex justify-center">
            <span className="px-6 py-3 rounded-xl bg-primary/15 border border-primary/50 text-primary font-black">Play from kickoff →</span>
          </div>
        </div>
      </Link>
    );
  }
  return <div className="rounded-3xl hero-bg border border-white/10 p-10 text-center text-muted">loading matches…</div>;
}

function MatchRow({ href, m, live, thriller, sub, played }: { href: string; m: { p1: string; p2: string; iso1: string; iso2: string }; live?: boolean; thriller?: boolean; sub?: string; played?: boolean }) {
  const body = (
    <>
      <div className="flex items-center gap-2.5 min-w-0">
        <Flag iso={m.iso1} alt={m.p1} />
        <span className="font-bold truncate">{m.p1}</span>
        <span className="text-muted text-xs px-1">v</span>
        <span className="font-bold truncate">{m.p2}</span>
        <Flag iso={m.iso2} alt={m.p2} />
      </div>
      <div className="text-right shrink-0 pl-3">
        {played ? (
          <span className="text-muted text-xs font-bold">✓ played</span>
        ) : (
          <>
            {live && <span className="text-destructive text-xs font-bold animate-pulse">● LIVE</span>}
            {thriller && <div className="text-primary text-xs font-bold">🔥 thriller</div>}
            {sub && <div className="text-muted text-[11px]">{sub}</div>}
          </>
        )}
      </div>
    </>
  );
  // One-shot-per-match: a played match is no longer clickable.
  if (played) {
    return (
      <div className="card-surface rounded-2xl p-4 flex items-center justify-between opacity-50 cursor-not-allowed" title="You've already played this match">
        {body}
      </div>
    );
  }
  return (
    <Link href={href} className={`card-surface rounded-2xl p-4 flex items-center justify-between transition ${live ? "border-destructive/30 hover:border-destructive/60" : "hover:border-primary/40"}`}>
      {body}
    </Link>
  );
}
