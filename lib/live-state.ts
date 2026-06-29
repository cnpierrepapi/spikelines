// Per-fixture scores state derived from the scores snapshot. At full time the
// snapshot carries a `game_finalised` action — that is what moves a match out of
// "Live" and into "Archived" automatically.
export type MatchState = { finished: boolean; g1: number; g2: number; minutes: number };

export async function matchStates(base: string, jwt: string, apiToken: string, fids: number[]): Promise<Map<number, MatchState>> {
  const out = new Map<number, MatchState>();
  await Promise.all(
    fids.map(async (fid) => {
      try {
        const sr = await fetch(`${base}/api/scores/snapshot/${fid}`, {
          headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
          cache: "no-store",
        });
        if (!sr.ok) return;
        const sj: any = await sr.json();
        const recs: any[] = Array.isArray(sj) ? sj : [sj];
        let finished = false, g1 = 0, g2 = 0, sec = 0;
        let overturn = false, lastScore: any = null, lastScoreTs = -1;
        for (const x of recs) {
          if (x.Action === "game_finalised") finished = true;
          if (x.Action === "action_discarded") overturn = true;
          if (x.Action === "var_end" && x.Data?.Outcome === "Overturned") overturn = true;
          if (x.Score) {
            g1 = Math.max(g1, x.Score?.Participant1?.Total?.Goals ?? 0);
            g2 = Math.max(g2, x.Score?.Participant2?.Total?.Goals ?? 0);
            if (x.Score?.Participant1?.Total && x.Ts > lastScoreTs) { lastScore = x.Score; lastScoreTs = x.Ts; }
          }
          if (x.Clock?.Seconds) sec = Math.max(sec, x.Clock.Seconds);
        }
        // VAR overturn is the one legitimate score decrease — trust the latest
        // cumulative Total over the running max (which latches on the zombie goal).
        if (overturn && lastScore) {
          g1 = lastScore.Participant1?.Total?.Goals ?? g1;
          g2 = lastScore.Participant2?.Total?.Goals ?? g2;
        }
        out.set(fid, { finished, g1, g2, minutes: Math.round(sec / 60) });
      } catch {}
    })
  );
  return out;
}

export async function finishedFids(base: string, jwt: string, apiToken: string, fids: number[]): Promise<Set<number>> {
  const states = await matchStates(base, jwt, apiToken, fids);
  return new Set([...states].filter(([, s]) => s.finished).map(([fid]) => fid));
}
