import Link from "next/link";

export default function Intro() {
  return (
    <main className="app-container flex flex-1 flex-col items-center justify-center py-24 text-center">
      <span className="text-xs uppercase tracking-[0.3em] text-muted mb-5">Spikelines · TxLINE World Cup</span>
      <h1 className="text-4xl sm:text-6xl font-black leading-[1.05] max-w-3xl">
        Feel the match.<br />
        <span className="text-primary">Call what happens next.</span>
      </h1>
      <p className="text-muted mt-6 max-w-xl text-lg leading-relaxed">
        As a team builds an attack, a 5-second call fires — will they score, win a corner, or get
        a shot away before the window closes? Tap YES / NO, build a streak, earn <span className="text-primary font-semibold">SPIKES</span>,
        and climb the leaderboard. Every outcome is settled on live World Cup data, verified on Solana.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Link href="/play" className="px-7 py-3.5 rounded-xl bg-primary text-background font-black gold-glow text-lg">Start playing →</Link>
        <Link href="/leaderboard" className="px-5 py-3.5 rounded-xl border border-white/10 text-foreground font-bold hover:border-primary/40 transition">Leaderboard</Link>
        <Link href="/litepaper" className="px-5 py-3.5 rounded-xl border border-white/10 text-muted font-bold hover:border-white/30 transition">Litepaper</Link>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-sm font-mono">
        <span className="rounded-full border border-white/10 px-3 py-1.5 text-muted">free to play</span>
        <span className="rounded-full border border-white/10 px-3 py-1.5 text-muted">live + archived matches</span>
        <span className="rounded-full border border-white/10 px-3 py-1.5 text-muted">TxLINE-verified</span>
      </div>
    </main>
  );
}
