"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Fixture = { fid: number; p1: string; p2: string; iso1: string; iso2: string; startTime: number; live: boolean };

function kickoff(ms: number) {
  const d = ms - Date.now();
  if (d <= 0) return "now";
  const h = Math.floor(d / 3_600_000);
  const m = Math.ceil((d % 3_600_000) / 60_000);
  if (h >= 24) return `in ${Math.floor(h / 24)}d`;
  return h >= 1 ? `in ${h}h ${m}m` : `in ${m}m`;
}

function Flag({ iso, alt }: { iso: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/flags/${iso}.png`} alt={alt} className="w-7 h-5 rounded-sm object-cover ring-1 ring-white/10" />;
}

export default function UpcomingMatches() {
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);

  useEffect(() => {
    fetch("/api/fixtures")
      .then((r) => r.json())
      .then((d) => setFixtures(d.fixtures ?? []))
      .catch(() => setFixtures([]));
  }, []);

  if (!fixtures || fixtures.length === 0) return null;
  const live = fixtures.filter((f) => f.live);
  const upcoming = fixtures.filter((f) => !f.live).sort((a, b) => a.startTime - b.startTime).slice(0, 6);
  const show = [...live, ...upcoming];
  if (show.length === 0) return null;

  return (
    <section className="mt-14 w-full max-w-2xl">
      <h2 className="text-sm uppercase tracking-[0.2em] text-muted mb-4">Upcoming &amp; live matches</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {show.map((f) => (
          <Link
            key={f.fid}
            href={`/live/${f.fid}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 hover:border-primary/40 transition text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <Flag iso={f.iso1} alt={f.p1} />
              <span className="font-bold truncate">{f.p1} <span className="text-muted font-normal">v</span> {f.p2}</span>
              <Flag iso={f.iso2} alt={f.p2} />
            </span>
            <span className={`text-xs font-bold shrink-0 ${f.live ? "text-destructive" : "text-muted"}`}>
              {f.live ? "● LIVE" : kickoff(f.startTime)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
