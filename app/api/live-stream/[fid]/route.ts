// Proxies the mainnet TxLINE live scores stream for ONE fixture to the browser
// as sanitized game events. Uses a server-held apiToken (env) — no keypair.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POSS: Record<string, string> = {
  safe_possession: "safe",
  attack_possession: "attack",
  danger_possession: "danger",
  high_danger_possession: "high_danger",
};
const g = (s: any, p: string) => s?.[p]?.Total?.Goals ?? 0;
const r_ = (s: any, p: string) => s?.[p]?.Total?.RedCards ?? 0;

export async function GET(request: Request, ctx: { params: Promise<{ fid: string }> }) {
  const { fid: fidStr } = await ctx.params;
  const fid = Number(fidStr);
  const base = process.env.TXLINE_API_BASE;
  const jwt = process.env.TXLINE_JWT;
  const apiToken = process.env.TXLINE_API_TOKEN;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
        } catch {}
      };
      if (!base || !jwt || !apiToken) {
        send({ t: "error", msg: "live not configured" });
        try { controller.close(); } catch {}
        return;
      }
      send({ t: "ready" });

      const upstream = new AbortController();
      request.signal.addEventListener("abort", () => upstream.abort());
      const prev = { p1g: 0, p2g: 0, p1r: 0, p2r: 0 };

      try {
        const res = await fetch(`${base}/api/scores/stream`, {
          headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken, Accept: "text/event-stream", "Cache-Control": "no-cache" },
          signal: upstream.signal,
        });
        if (!res.ok || !res.body) {
          send({ t: "error", msg: `upstream ${res.status}` });
          try { controller.close(); } catch {}
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of block.split("\n")) {
              if (!line.startsWith("data:")) continue;
              let v = line.slice(5);
              if (v.startsWith(" ")) v = v.slice(1);
              let rr: any;
              try { rr = JSON.parse(v); } catch { continue; }
              if (rr.FixtureId !== fid) continue;
              const clock = rr.Clock;
              const tier = POSS[rr.Action as string];
              if (tier) send({ t: "momentum", tier, participant: rr.Participant === rr.Participant2Id ? 2 : 1, clock });
              if (rr.Score) {
                const p1g = g(rr.Score, "Participant1"), p2g = g(rr.Score, "Participant2");
                const p1r = r_(rr.Score, "Participant1"), p2r = r_(rr.Score, "Participant2");
                if (p1g > prev.p1g || p2g > prev.p2g) send({ t: "goal", clock, score: { p1: p1g, p2: p2g } });
                if (p1r > prev.p1r || p2r > prev.p2r) send({ t: "red", clock });
                Object.assign(prev, { p1g, p2g, p1r, p2r });
                send({ t: "score", score: { p1: p1g, p2: p2g }, clock });
              }
            }
          }
        }
      } catch (e) {
        send({ t: "error", msg: String(e) });
      }
      try { controller.close(); } catch {}
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
