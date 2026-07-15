"use client";

// Non-intrusive match-event notifications: goals, corners, cards. They stack at
// the top of the screen (the betting prompt owns the bottom + a higher z-index),
// are click-through, and each auto-dismisses. The call stays the main event.

export type ToastKind = "goal" | "corner" | "yellow" | "red";
export type Toast = { id: number; icon: string; label: string; kind: ToastKind };

const TONE: Record<ToastKind, string> = {
  goal: "border-primary/50",
  corner: "border-trust/50",
  yellow: "border-[#f5c800]/50",
  red: "border-destructive/50",
};

export function EventToasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed inset-x-0 top-3 z-30 flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-in card-surface rounded-full pl-3 pr-5 py-2 flex items-center gap-2 border ${TONE[t.kind]} shadow-lg`}
        >
          <span className="text-lg leading-none">{t.icon}</span>
          <span className="text-sm font-bold text-foreground whitespace-nowrap">{t.label}</span>
        </div>
      ))}
    </div>
  );
}
