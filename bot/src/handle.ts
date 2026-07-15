// Same football-flavoured handle generator as the web app's UsernameGate, so a
// chat handle reads like a web handle (e.g. "ClinicalPoacher47"). Kept in sync by
// hand — these two word lists must match components/UsernameGate.tsx.
const ADJ = ["Clinical", "Offside", "Silky", "Rapid", "Iron", "Golden", "Counter", "Total", "Deep", "High", "Late", "Long", "Near", "Wired", "Set", "Lofted"];
const NOUN = ["Poacher", "Libero", "Sweeper", "Winger", "Target", "Playmaker", "Striker", "Anchor", "Maestro", "Sniper", "Engine", "Pivot", "Outlet", "Finisher", "Keeper", "Wall"];

export function randomHandle(): string {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(ADJ)}${pick(NOUN)}${10 + Math.floor(Math.random() * 90)}`;
}
