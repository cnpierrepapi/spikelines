"use client";

// First-visit identity. Instead of prompting, we auto-assign a random football-
// flavoured handle, claim it server-side (case-insensitive unique) and seed the
// player's leaderboard row — all silently. The component renders nothing; the
// lobby is never gated behind a modal. Kept as a component with the same contract
// as the old prompt (default export + optional onReady) so /play doesn't change.
import { useEffect, useRef } from "react";
import { getUsername, setUsername } from "@/lib/store";
import { claimUsername } from "@/lib/remote";
import { randomHandle as randomName } from "@/lib/handle";

export default function UsernameGate({ onReady }: { onReady?: (name: string) => void }) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const existing = getUsername();
    if (existing) { onReady?.(existing); return; }

    // Assign locally first so the app works immediately even if the backend is
    // down, then best-effort claim it (retrying once if that handle is taken).
    (async () => {
      let name = randomName();
      setUsername(name);
      onReady?.(name);
      try {
        let res = await claimUsername(name);
        if (res.error === "username_taken") {
          name = randomName();
          res = await claimUsername(name);
          if (res.ok || res.error === "backend not configured") setUsername(name);
        }
      } catch {
        // ignore — the local name already stands in
      }
    })();
  }, [onReady]);

  return null;
}
