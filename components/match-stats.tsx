// Compact match-stats panel shared by the live and archived rooms. It shows ONLY
// the four categories TxLINE anchors on-chain (goals / corners / yellow / red,
// per side) — the exact stats each bet is later proven against via validate_stat.
// Keeping the panel limited to these makes the "everything here is provable"
// promise literally true.

export type SideStats = [number, number]; // [Participant1, Participant2]
export type MatchStatLines = {
  goals: SideStats;
  corners: SideStats;
  yellow: SideStats;
  red: SideStats;
};

const ROWS: [string, string, keyof MatchStatLines][] = [
  ["⚽", "Goals", "goals"],
  ["🚩", "Corners", "corners"],
  ["🟨", "Yellow", "yellow"],
  ["🟥", "Red", "red"],
];

export function MatchStatsPanel({ p1, p2, stats }: { p1: string; p2: string; stats: MatchStatLines }) {
  return (
    <div className="card-surface rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-widest text-muted">Match stats</span>
        <span className="text-[10px] uppercase tracking-wider text-primary/80">⛓ on-chain provable</span>
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted mb-2 px-1">
        <span className="truncate max-w-[42%] font-bold text-foreground">{p1}</span>
        <span className="truncate max-w-[42%] text-right font-bold text-foreground">{p2}</span>
      </div>
      <div className="flex flex-col gap-2">
        {ROWS.map(([icon, label, key]) => {
          const [a, b] = stats[key];
          return (
            <div key={label} className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center text-sm">
              <span className="font-black tabular-nums text-left">{a}</span>
              <span className="text-center text-muted text-xs flex items-center justify-center gap-1.5">
                <span>{icon}</span>
                {label}
              </span>
              <span className="font-black tabular-nums text-right">{b}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
