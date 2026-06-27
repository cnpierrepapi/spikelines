"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Entry = {
  fid: number;
  p1: string;
  p2: string;
  iso1: string;
  iso2: string;
  goals: number;
  possession: number;
  minutes: number;
};

export default function Lobby() {
  const [matches, setMatches] = useState<Entry[] | null>(null);
  useEffect(() => {
    fetch("/replays/index.json")
      .then((r) => r.json())
      .then(setMatches)
      .catch(() => setMatches([]));
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-primary font-black text-2xl tracking-tight">SPOTR</span>
          <span className="text-muted">· Spikelines</span>
        </div>
        <p className="text-muted mb-7">Feel the match. Tap the momentum, build a streak — every call proven on-chain.</p>

        <div className="text-xs uppercase tracking-widest text-muted mb-3">Pick a match</div>
        <div className="flex flex-col gap-3">
          {matches === null && <div className="text-muted">loading…</div>}
          {matches?.length === 0 && <div className="text-muted">No replays available yet.</div>}
          {matches?.map((m) => (
            <Link
              key={m.fid}
              href={`/match/${m.fid}`}
              className="card-surface rounded-2xl p-4 flex items-center justify-between hover:border-primary/40 transition group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/flags/${m.iso1}.png`} alt={m.p1} className="w-9 h-7 rounded object-cover ring-1 ring-white/10 shrink-0" />
                <span className="font-bold truncate">{m.p1}</span>
                <span className="text-muted text-xs px-1">v</span>
                <span className="font-bold truncate">{m.p2}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/flags/${m.iso2}.png`} alt={m.p2} className="w-9 h-7 rounded object-cover ring-1 ring-white/10 shrink-0" />
              </div>
              <div className="text-right shrink-0 pl-3">
                {m.goals >= 4 && <div className="text-primary text-xs font-bold">🔥 thriller</div>}
                <div className="text-muted text-[11px]">{m.minutes}&apos; · World Cup</div>
              </div>
            </Link>
          ))}
        </div>

        <p className="text-muted text-xs mt-8 leading-relaxed">
          Replays are pulled from TxLINE&apos;s verifiable World Cup feed and start from kickoff — pick one and watch the momentum build.
        </p>
      </div>
    </div>
  );
}
