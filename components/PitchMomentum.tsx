"use client";

// Momentum, drawn as a live football pitch on a <canvas> with a small physics
// loop (requestAnimationFrame). Replaces the old momentum bar entirely.
//
// REAL (from TxLINE possession updates): `attacker` (which side is attacking) and
// `tier` (how dangerous → how hard the attack presses). Those two drive where the
// players push and which goal the ball is worked toward.
//
// SIMULATED (cosmetic — TxLINE has no player coordinates): the players' formation,
// their spring motion, and the ball's kick physics. The dots chase and KICK the
// ball; on each possession update the whole shape slides to the attacked side.
import { useEffect, useRef } from "react";

type Tier = "safe" | "attack" | "danger" | "high_danger";
const REACH: Record<Tier, number> = { safe: 0.08, attack: 0.2, danger: 0.34, high_danger: 0.46 };

const TEAM1 = "#5cc8ff"; // defends left goal, attacks right
const TEAM2 = "#ff7a7a"; // defends right goal, attacks left

// Formation for the team defending the LEFT goal (x,y in 0..1 of the pitch). fwd =
// how far up the player commits when their team attacks (GK ~0, forwards ~1).
const FORMATION: { x: number; y: number; fwd: number }[] = [
  { x: 0.05, y: 0.5, fwd: 0.0 },   // keeper
  { x: 0.2, y: 0.24, fwd: 0.35 },  // back four
  { x: 0.16, y: 0.5, fwd: 0.25 },
  { x: 0.2, y: 0.76, fwd: 0.35 },
  { x: 0.36, y: 0.34, fwd: 0.7 },  // midfield
  { x: 0.36, y: 0.66, fwd: 0.7 },
  { x: 0.34, y: 0.5, fwd: 0.6 },
  { x: 0.5, y: 0.4, fwd: 1.0 },    // forwards
  { x: 0.5, y: 0.6, fwd: 1.0 },
  { x: 0.46, y: 0.5, fwd: 0.9 },
];

type Dot = { x: number; y: number; vx: number; vy: number; team: 1 | 2; base: { x: number; y: number; fwd: number }; ph: number };

export default function PitchMomentum({
  tier, attacker, label, color, hot, progress,
}: {
  tier: Tier;
  attacker: 1 | 2;
  iso1?: string;
  iso2?: string;
  label: string;
  color: string;
  hot: boolean;
  progress?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Live inputs read by the loop without restarting it.
  const state = useRef({ tier, attacker, color, hot });
  state.current = { tier, attacker, color, hot };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Build both teams from the formation (team2 is mirrored across the halfway line).
    const dots: Dot[] = [];
    for (const b of FORMATION) dots.push({ x: b.x, y: b.y, vx: 0, vy: 0, team: 1, base: b, ph: Math.random() * 6.28 });
    for (const b of FORMATION) dots.push({ x: 1 - b.x, y: b.y, vx: 0, vy: 0, team: 2, base: { x: 1 - b.x, y: b.y, fwd: b.fwd }, ph: Math.random() * 6.28 });

    const ball = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
    let kickCd = 0;
    let last = performance.now();
    let raf = 0;
    let t = 0;

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 16.67, 2.2); // frames, capped
      last = now;
      t += dt;
      const { tier: tr, attacker: atk, color: col, hot: isHot } = state.current;
      const reach = REACH[tr] ?? 0.08;
      const attackingRight = atk === 1; // team1 attacks the right goal
      const goalX = attackingRight ? 0.98 : 0.02; // the goal being attacked

      // ── player targets ──────────────────────────────────────────
      for (const d of dots) {
        const teamAttacking = (d.team === 1) === attackingRight;
        const dir = d.team === 1 ? 1 : -1; // team1 pushes right
        // Attacking team commits upfield (scaled by player role + intensity);
        // defending team holds a compact block, sagging slightly toward its own goal.
        const shift = teamAttacking ? dir * reach * (0.4 + d.base.fwd) : -dir * reach * 0.18 * (0.4 + d.base.fwd);
        const tx = Math.max(0.03, Math.min(0.97, d.base.x + shift));
        // idle wander so nobody stands frozen
        const wy = Math.sin(t * 0.04 + d.ph) * 0.012;
        const ty = Math.max(0.08, Math.min(0.92, d.base.y + wy));

        // spring toward target
        d.vx += (tx - d.x) * 0.012 * dt;
        d.vy += (ty - d.y) * 0.012 * dt;

        // the nearest attacker chases the ball
        if (teamAttacking) {
          const bdx = ball.x - d.x, bdy = ball.y - d.y;
          const bd = Math.hypot(bdx, bdy);
          if (bd < 0.28 && d.base.fwd > 0.5) {
            d.vx += (bdx / (bd + 1e-4)) * 0.02 * dt;
            d.vy += (bdy / (bd + 1e-4)) * 0.02 * dt;
          }
        }
        d.vx *= 0.86; d.vy *= 0.86;
        d.x += d.vx * dt; d.y += d.vy * dt;
      }

      // ── ball physics: chased, kicked toward the attacked goal ────
      kickCd -= dt;
      for (const d of dots) {
        const dx = ball.x - d.x, dy = ball.y - d.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.035 && kickCd <= 0) {
          const kicking = (d.team === 1) === attackingRight;
          const tgx = kicking ? goalX : (d.team === 1 ? 0.02 : 0.98);
          const ang = Math.atan2(0.5 + (Math.random() - 0.5) * 0.5 - ball.y, tgx - ball.x);
          const power = 0.012 + reach * 0.02 + Math.random() * 0.006;
          ball.vx = Math.cos(ang) * power;
          ball.vy = Math.sin(ang) * power;
          kickCd = 12 + Math.random() * 10;
        }
      }
      // drift toward the pressured third even without a kick (team pressure)
      ball.vx += ((goalX - ball.x) * 0.0006 * (0.4 + reach)) * dt;
      ball.vx *= 0.97; ball.vy *= 0.97;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      // walls: bounce off touchlines, clear off the goal lines back into play
      if (ball.y < 0.06) { ball.y = 0.06; ball.vy = Math.abs(ball.vy) * 0.6; }
      if (ball.y > 0.94) { ball.y = 0.94; ball.vy = -Math.abs(ball.vy) * 0.6; }
      if (ball.x < 0.04) { ball.x = 0.06; ball.vx = Math.abs(ball.vx) * 0.5 + 0.004; }
      if (ball.x > 0.96) { ball.x = 0.94; ball.vx = -Math.abs(ball.vx) * 0.5 - 0.004; }

      draw(ctx, W, H, dots, ball, col, isHot);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div className={`card-surface rounded-2xl p-4 ${hot ? "danger-glow" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-widest text-muted">Momentum</span>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{hot && "⚠ "}{label}</span>
      </div>
      <canvas ref={canvasRef} className="block w-full rounded-xl" style={{ aspectRatio: "16 / 9" }} />
      {typeof progress === "number" && (
        <div className="mt-3 h-1 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full bg-primary/40" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

// ── rendering (all in canvas pixel space) ─────────────────────────
function draw(ctx: CanvasRenderingContext2D, W: number, H: number, dots: Dot[], ball: { x: number; y: number }, color: string, hot: boolean) {
  ctx.clearRect(0, 0, W, H);

  // turf with mowing stripes
  const stripes = 8;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? "#0d3721" : "#0f3d24";
    ctx.fillRect((i / stripes) * W, 0, W / stripes + 1, H);
  }
  // markings
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = Math.max(1, W * 0.004);
  const pad = W * 0.012;
  ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
  ctx.beginPath(); ctx.moveTo(W / 2, pad); ctx.lineTo(W / 2, H - pad); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, H / 2, H * 0.16, 0, Math.PI * 2); ctx.stroke();
  // penalty boxes
  const boxW = W * 0.13, boxH = H * 0.46;
  ctx.strokeRect(pad, (H - boxH) / 2, boxW, boxH);
  ctx.strokeRect(W - pad - boxW, (H - boxH) / 2, boxW, boxH);

  const rDot = Math.max(3.5, H * 0.032);
  for (const d of dots) {
    const px = d.x * W, py = d.y * H;
    ctx.beginPath();
    ctx.arc(px, py, rDot, 0, Math.PI * 2);
    ctx.fillStyle = d.team === 1 ? TEAM1 : TEAM2;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.stroke();
  }

  // ball
  const bx = ball.x * W, by = ball.y * H, rB = Math.max(3, H * 0.026);
  if (hot) { ctx.shadowColor = color; ctx.shadowBlur = 18; }
  ctx.beginPath();
  ctx.arc(bx, by, rB, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
}
