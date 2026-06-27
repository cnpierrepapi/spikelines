// Returns the subset of fixture ids whose scores feed has finalised (full time).
// At FT the per-fixture scores snapshot carries a `game_finalised` action — that
// is what moves a match out of "Live" and into "Archived" automatically.
export async function finishedFids(base: string, jwt: string, apiToken: string, fids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
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
        if (recs.some((x) => x.Action === "game_finalised")) out.add(fid);
      } catch {}
    })
  );
  return out;
}
