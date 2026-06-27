"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Entry = { fid: number; p1: string; p2: string; iso1: string; iso2: string; goals: number; minutes: number };
type LiveEntry = { fid: number; p1: string; p2: string; iso1: string; iso2: string };

function Flag({ iso, alt }: { iso: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/flags/${iso}.png`} alt={alt} className="w-9 h-7 rounded object-cover ring-1 ring-white/10 shrink-0" />;
}

export default function Lobby() {
  const [archived, setArchived] = useState<Entry[] | null>(null);
  const [live, setLive] = useState<LiveEntry[] | null>(null);

  useEffect(() => {
    fetch("/replays/index.json").then((r) => r.json()).then(setArchived).catch(() => setArchived([]));
    fetch("/api/live").then((r) => r.json()).then((d) => setLive(d.matches ?? [])).catch(() => setLive([]));
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-primary font-black text-2xl tracking-tight">SPIKES</span>
          <span className="text-muted">· Spikelines</span>
        </div>
        <p className="text-muted mb-7">Feel the match. Tap the momentum, build a streak — every call proven on-chain.</p>

        {/* LIVE */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs uppercase tracking-widest text-destructive font-bold">● Live</span>
          <span className="text-[11px] text-muted">real-time · 100 SPIKES / correct</span>
        </div>
        <div className="flex flex-col gap-3 mb-8">
          {live === null && <div className="text-muted text-sm">checking…</div>}
          {live?.length === 0 && (
            <div className="card-surface rounded-2xl p-4 text-muted text-sm">No live matches right now — dive into an archived one below.</div>
          )}
          {live?.map((m) => (
            <Link key={m.fid} href={`/live/${m.fid}`} className="card-surface rounded-2xl p-4 flex items-center justify-between border-destructive/30 hover:border-destructive/60 transition">
              <div className="flex items-center gap-2.5 min-w-0">
                <Flag iso={m.iso1} alt={m.p1} />
                <span className="font-bold truncate">{m.p1}</span>
                <span className="text-muted text-xs px-1">v</span>
                <span className="font-bold truncate">{m.p2}</span>
                <Flag iso={m.iso2} alt={m.p2} />
              </div>
              <span className="text-destructive text-xs font-bold animate-pulse shrink-0 pl-3">● LIVE</span>
            </Link>
          ))}
        </div>

        {/* ARCHIVED */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs uppercase tracking-widest text-muted font-bold">Archived</span>
          <span className="text-[11px] text-muted">from kickoff · 5 SPIKES / correct</span>
        </div>
        <div className="flex flex-col gap-3">
          {archived === null && <div className="text-muted text-sm">loading…</div>}
          {archived?.length === 0 && <div className="text-muted text-sm">No replays available yet.</div>}
          {archived?.map((m) => (
            <Link key={m.fid} href={`/match/${m.fid}`} className="card-surface rounded-2xl p-4 flex items-center justify-between hover:border-primary/40 transition">
              <div className="flex items-center gap-2.5 min-w-0">
                <Flag iso={m.iso1} alt={m.p1} />
                <span className="font-bold truncate">{m.p1}</span>
                <span className="text-muted text-xs px-1">v</span>
                <span className="font-bold truncate">{m.p2}</span>
                <Flag iso={m.iso2} alt={m.p2} />
              </div>
              <div className="text-right shrink-0 pl-3">
                {m.goals >= 4 && <div className="text-primary text-xs font-bold">🔥 thriller</div>}
                <div className="text-muted text-[11px]">{m.minutes}&apos; · World Cup</div>
              </div>
            </Link>
          ))}
        </div>

        <p className="text-muted text-xs mt-8 leading-relaxed">
          Live + archived data from TxLINE&apos;s verifiable World Cup feed, anchored on Solana.
        </p>
      </div>
    </div>
  );
}
