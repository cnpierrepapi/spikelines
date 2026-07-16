// Football-flavoured random handles, shared by the web UsernameGate and the server
// (Telegram Mini App identity). e.g. "ClinicalPoacher47". Always matches the handle
// rule /^[a-zA-Z0-9_-]{3,20}$/.
const ADJ = ["Clinical", "Offside", "Silky", "Rapid", "Iron", "Golden", "Counter", "Total", "Deep", "High", "Late", "Long", "Near", "Wired", "Set", "Lofted"];
const NOUN = ["Poacher", "Libero", "Sweeper", "Winger", "Target", "Playmaker", "Striker", "Anchor", "Maestro", "Sniper", "Engine", "Pivot", "Outlet", "Finisher", "Keeper", "Wall"];

export function randomHandle(): string {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(ADJ)}${pick(NOUN)}${10 + Math.floor(Math.random() * 90)}`;
}
