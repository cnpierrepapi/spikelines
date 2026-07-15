"use client";

// Momentum, drawn as a football pitch instead of a bar.
//
// REAL (from TxLINE possession updates): which side is attacking (`attacker`) and
// how dangerous it is (`tier` → how far the play pushes upfield). The ball leans
// toward the goal being attacked, and the attacking team's shape pushes up.
//
// SIMULATED (cosmetic only — TxLINE doesn't give player coordinates): the dots'
// formation, their idle bob, and the ball's vertical drift. Nothing here invents
// match facts; it just animates the one real signal we have.

type Tier = "safe" | "attack" | "danger" | "high_danger";

const REACH: Record<Tier, number> = { safe: 6, attack: 16, danger: 30, high_danger: 44 };

// Base formation for the team that defends the LEFT goal (attacks right), in pitch
// coords x:0(left)–100(right), y:0(top)–100(bottom). ~5 outfield + keeper.
const BASE_L: { x: number; y: number; fwd: number }[] = [
  { x: 5, y: 50, fwd: 0 },    // GK
  { x: 22, y: 26, fwd: 0.3 }, // back line
  { x: 20, y: 74, fwd: 0.3 },
  { x: 38, y: 50, fwd: 0.7 }, // midfield
  { x: 46, y: 32, fwd: 1 },   // forwards
  { x: 46, y: 68, fwd: 1 },
];

const TEAM1_COLOR = "#5cc8ff"; // defends left, attacks right
const TEAM2_COLOR = "#ff7a7a"; // defends right, attacks left

function Flag({ iso, className }: { iso?: string; className?: string }) {
  if (!iso) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/flags/${iso}.png`} alt="" className={className} />;
}

export default function PitchMomentum({
  tier, attacker, iso1, iso2, label, color, hot, progress,
}: {
  tier: Tier;
  attacker: 1 | 2;
  iso1?: string;
  iso2?: string;
  label: string;
  color: string;
  hot: boolean;
  progress?: number; // optional replay-progress bar (archived room)
}) {
  const reach = REACH[tier] ?? 6;
  const push = reach / 44; // 0..1 intensity
  const attackingRight = attacker === 1; // team1 attacks the right goal

  // Ball leans toward the attacked goal; team1 attacking → right (x>50).
  const ballX = 50 + (attackingRight ? reach : -reach);

  // Horizontal shift for a dot: advance toward the opponent goal when its team is
  // attacking (scaled by how forward the player is), retreat slightly when defending.
  const shiftFor = (isTeam1: boolean, fwd: number) => {
    const dir = isTeam1 ? 1 : -1; // team1 advances right
    const attacking = isTeam1 === attackingRight;
    return attacking ? dir * push * 30 * fwd : -dir * push * 9 * fwd;
  };

  const dot = (isTeam1: boolean, i: number, b: { x: number; y: number; fwd: number }) => {
    const baseX = isTeam1 ? b.x : 100 - b.x;
    const left = Math.max(2, Math.min(98, baseX + shiftFor(isTeam1, b.fwd)));
    return (
      <span
        key={`${isTeam1 ? "a" : "b"}${i}`}
        className="pitch-dot"
        style={{
          left: `${left}%`,
          top: `${b.y}%`,
          background: isTeam1 ? TEAM1_COLOR : TEAM2_COLOR,
          animationDelay: `${(i * 0.37).toFixed(2)}s`,
        }}
      />
    );
  };

  return (
    <div className={`card-surface rounded-2xl p-4 ${hot ? "danger-glow" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-widest text-muted">Momentum</span>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>
          {hot && "⚠ "}{label}
        </span>
      </div>

      <div className="pitch-wrap" style={{ boxShadow: hot ? `inset 0 0 40px ${color}55` : undefined }}>
        {/* pitch markings */}
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
          <g stroke="rgba(255,255,255,0.16)" strokeWidth="0.4" fill="none">
            <rect x="1" y="1" width="98" height="58" />
            <line x1="50" y1="1" x2="50" y2="59" />
            <circle cx="50" cy="30" r="9" />
            <rect x="1" y="16" width="14" height="28" />
            <rect x="85" y="16" width="14" height="28" />
            <rect x="1" y="24" width="5" height="12" />
            <rect x="94" y="24" width="5" height="12" />
          </g>
          <circle cx="50" cy="30" r="0.9" fill="rgba(255,255,255,0.35)" />
        </svg>

        {/* which goal each team defends */}
        <div className="pitch-end left"><Flag iso={iso1} className="pitch-flag" /></div>
        <div className="pitch-end right"><Flag iso={iso2} className="pitch-flag" /></div>

        {/* players (simulated positions, real push direction) */}
        {BASE_L.map((b, i) => dot(true, i, b))}
        {BASE_L.map((b, i) => dot(false, i, b))}

        {/* the ball — horizontal position is the real momentum signal */}
        <span
          className={`pitch-ball ${hot ? "orb-pulse" : ""}`}
          style={{ left: `${ballX}%`, background: color, boxShadow: `0 0 16px ${color}, 0 0 4px #fff` }}
        />
      </div>

      {typeof progress === "number" && (
        <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full bg-primary/40" style={{ width: `${progress}%` }} />
        </div>
      )}

      <style jsx>{`
        .pitch-wrap {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          border-radius: 0.9rem;
          overflow: hidden;
          background:
            repeating-linear-gradient(90deg, #0f3d24 0 12.5%, #0d3721 12.5% 25%),
            linear-gradient(180deg, #124a2b, #0c3620);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .pitch-dot {
          position: absolute;
          width: 3.4%;
          aspect-ratio: 1;
          border-radius: 9999px;
          transform: translate(-50%, -50%);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.25) inset;
          transition: left 0.7s cubic-bezier(0.22, 1, 0.36, 1), top 0.7s cubic-bezier(0.22, 1, 0.36, 1);
          animation: pitchbob 2.6s ease-in-out infinite alternate;
        }
        .pitch-ball {
          position: absolute;
          top: 50%;
          width: 3.6%;
          aspect-ratio: 1;
          border-radius: 9999px;
          transform: translate(-50%, -50%);
          transition: left 0.6s cubic-bezier(0.22, 1, 0.36, 1);
          animation: balldrift 2.1s ease-in-out infinite alternate;
          z-index: 2;
        }
        .pitch-end {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          opacity: 0.85;
          z-index: 1;
        }
        .pitch-end.left { left: 1.5%; }
        .pitch-end.right { right: 1.5%; }
        .pitch-flag {
          width: 22px;
          height: 16px;
          object-fit: cover;
          border-radius: 2px;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
        }
        @keyframes pitchbob {
          from { margin-top: -2px; }
          to { margin-top: 2px; }
        }
        @keyframes balldrift {
          from { margin-top: -7px; }
          to { margin-top: 7px; }
        }
      `}</style>
    </div>
  );
}
