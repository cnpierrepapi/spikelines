import Link from "next/link";

export const metadata = {
  title: "Spikelines — Litepaper",
  description: "What Spikelines is, in one page.",
};

function Block({ h, children }: { h: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-xs uppercase tracking-widest text-primary font-bold mb-2">{h}</h2>
      <div className="text-muted leading-relaxed">{children}</div>
    </section>
  );
}

export default function Litepaper() {
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-30 nav-blur border-b border-white/[0.06]">
        <div className="app-container flex items-center justify-between py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-primary font-black text-xl tracking-tight">SPIKES</span>
            <span className="text-muted text-sm">· Spikelines</span>
          </Link>
          <Link href="/play" className="text-sm text-muted hover:text-foreground">Play</Link>
        </div>
      </nav>

      <main className="app-container py-10 max-w-2xl">
        <span className="text-xs uppercase tracking-[0.3em] text-muted">Litepaper</span>
        <h1 className="text-4xl font-black mt-2 mb-6">Spikelines</h1>

        <Block h="What it is">
          A real-time &ldquo;what happens next?&rdquo; prediction game on live World Cup data. As a team
          attacks, a 5-second call fires — <span className="text-foreground">score, corner, or card?</span> Tap YES / NO.
        </Block>

        <Block h="The loop">
          Be right → build a <span className="text-foreground">streak</span> → earn <span className="text-primary font-semibold">SPIKES</span> → climb a
          leaderboard ranked by <span className="text-foreground">streak accuracy</span> → top players share a weekly USDC pool.
        </Block>

        <Block h="SPIKES">
          Free to play; every match is one-shot, so the leaderboard can&apos;t be farmed. <span className="text-foreground">SPIKES</span> — earned
          by correct calls or bought in packs — are spent to <span className="text-foreground">save a streak</span> a wrong call would end
          (cost rises each use that day, capped) and to <span className="text-foreground">replay an already-played archived match</span> (175 SPIKES).
          SPIKES never buy a bigger bankroll or better odds.
        </Block>

        <Block h="Why it&apos;s trustworthy">
          Every outcome is settled against TxLINE&apos;s World Cup feed, cryptographically anchored on Solana — wins
          and losses alike are un-deletable and publicly verifiable.
        </Block>

        <div className="mt-10 border-t border-white/10 pt-6">
          <p className="text-muted text-sm mb-4">Want the full mechanics, scoring math, architecture and TxLINE endpoints?</p>
          <a href="/spikelines-litepaper.pdf" download className="inline-block px-6 py-3.5 rounded-xl bg-primary text-background font-black gold-glow">
            Download technical paper (PDF) ↓
          </a>
        </div>
      </main>
    </div>
  );
}
