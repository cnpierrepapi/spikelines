"use client";

// Runs only inside the Telegram Mini App. Verifies the player via initData, adopts
// their chat identity (handle) + server SPIKES balance on load, and mirrors any
// balance change back to the server so chat and app stay in sync. On plain web this
// is a no-op (no Telegram.WebApp), so nothing changes for browser players.
import { useEffect } from "react";
import { setUsername, setBalance, setBalanceSyncHook } from "@/lib/store";

export default function TelegramBridge() {
  useEffect(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: any } }).Telegram?.WebApp;
    const initData: string | undefined = tg?.initData;
    if (!tg || !initData) return; // not in Telegram

    try { tg.ready(); tg.expand?.(); } catch {}

    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/tg/me", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        const j = await r.json();
        if (active && j?.ok) {
          setUsername(j.handle);
          setBalance(j.spikes); // server balance is authoritative in Telegram
          window.dispatchEvent(new Event("spikes:synced")); // let mounted pages refresh
        }
      } catch {
        // offline / verify failed — fall back to local state silently
      }
    })();

    // Mirror local balance changes to the server (fire-and-forget deltas).
    setBalanceSyncHook((delta) => {
      fetch("/api/tg/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData, delta }),
      }).catch(() => {});
    });

    return () => { active = false; setBalanceSyncHook(null); };
  }, []);

  return null;
}
