// Tiny client-side store for the shared user balance + bet history (localStorage).
// Stands in for the cross-product account until the real backend exists.
export type StoredBet = {
  id: number;
  match: string;
  mins: number;
  choice: "YES" | "NO";
  status: "won" | "lost";
  reward: number;
  at: number;
};

const BETS_KEY = "spikes_bets";
const BAL_KEY = "spikes_balance";

export function getBalance(): number {
  if (typeof window === "undefined") return 0;
  return Number(localStorage.getItem(BAL_KEY) || 0);
}
export function addBalance(n: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(BAL_KEY, String(getBalance() + n));
}
export function getBets(): StoredBet[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(BETS_KEY) || "[]");
  } catch {
    return [];
  }
}
export function recordBet(b: StoredBet) {
  if (typeof window === "undefined") return;
  localStorage.setItem(BETS_KEY, JSON.stringify([b, ...getBets()].slice(0, 50)));
}
