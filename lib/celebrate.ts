// Confetti burst for a winning bet. Origin defaults to upper-middle, but pass a
// normalized (x, y) — e.g. the winning bet row's screen position — so the user
// can see the celebration come from the exact bet that landed.
import confetti from "canvas-confetti";

export function celebrate(originX = 0.5, originY = 0.35) {
  confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 42,
    gravity: 1.1,
    scalar: 0.9,
    ticks: 180,
    origin: { x: originX, y: originY },
    colors: ["#f5c800", "#25d16b", "#3b82f6", "#ffffff"],
    disableForReducedMotion: true,
  });
}

// Fire confetti from a specific DOM element's centre (the winning bet row).
export function celebrateFrom(elId: string) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(elId);
  const r = el?.getBoundingClientRect();
  if (r && r.width) celebrate((r.left + r.width / 2) / window.innerWidth, (r.top + r.height / 2) / window.innerHeight);
  else celebrate();
}
