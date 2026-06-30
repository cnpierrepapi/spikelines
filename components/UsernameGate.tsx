"use client";

// First-visit username prompt on /play. Picks a name, claims it server-side
// (case-insensitive unique), and seeds the player's leaderboard row. Until a
// name is chosen the rest of the lobby is dimmed behind it.
import { useEffect, useState } from "react";
import { getUsername, setUsername } from "@/lib/store";
import { claimUsername } from "@/lib/remote";

const VALID = /^[a-zA-Z0-9_-]{3,20}$/;

export default function UsernameGate({ onReady }: { onReady?: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const existing = getUsername();
    if (existing) onReady?.(existing);
    else setOpen(true);
  }, [onReady]);

  if (!open) return null;

  const submit = async () => {
    const n = name.trim();
    if (!VALID.test(n)) { setErr("3–20 letters, numbers, _ or - only."); return; }
    setBusy(true); setErr("");
    const res = await claimUsername(n);
    setBusy(false);
    if (res.ok) { setUsername(n); setOpen(false); onReady?.(n); }
    else if (res.error === "username_taken") setErr("That name's taken — try another.");
    else if (res.error === "backend not configured") { setUsername(n); setOpen(false); onReady?.(n); } // offline-friendly
    else setErr("Couldn't save that name. Try again.");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm px-6">
      <div className="card-surface gold-glow rounded-2xl p-7 max-w-sm w-full text-center animate-pop">
        <div className="text-4xl mb-3">👁️</div>
        <h2 className="text-2xl font-black mb-1">Pick your name</h2>
        <p className="text-muted text-sm mb-5">This is how you&apos;ll show up on the leaderboard. Choose well.</p>
        <input
          value={name}
          autoFocus
          onChange={(e) => { setName(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. xG_wizard"
          spellCheck={false}
          maxLength={20}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center font-bold focus:border-primary/50 focus:outline-none mb-3"
        />
        {err && <p className="text-destructive text-xs mb-3">{err}</p>}
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="w-full py-3 rounded-xl bg-primary text-background font-black gold-glow active:scale-95 transition disabled:opacity-50"
        >
          {busy ? "Claiming…" : "Start playing →"}
        </button>
      </div>
    </div>
  );
}
