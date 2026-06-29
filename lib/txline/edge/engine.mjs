// EDGE ENGINE — detects short-lived betting edges from the TxLINE feed.
//
// It consumes the two TxLINE streams and emits "edges": short-lived, scarce
// betting opportunities grounded in the academic sports-market literature.
//
// Two edge kinds in v1:
//   1. STEAM  — the demargined fair probability for a market moves sharply within
//               a short window (new information / sharp money). Back the move.
//   2. OVERREACTION — right after a real match event (goal / red card, detected by
//               score deltas), the fair line swings beyond a threshold. The
//               literature says markets OVERREACT to surprise → fade it.
//
// The fair probability is taken straight from TxLINE's 'TXLineStablePriceDemargined'
// book: prob = 1 / (Prices[i] / 1000) (already no-vig; the two sides sum to ~1).
// That number IS the "edge measure".
import { EventEmitter } from "node:events";

const DEFAULTS = {
  steamThreshold: 0.04, // 4 percentage-point fair-prob move…
  steamWindowMs: 60_000, // …within 60s = a steam move
  overreactionThreshold: 0.08, // 8pp swing…
  overreactionWindowMs: 120_000, // …within 2min of a match event = overreaction
  historyMs: 180_000, // keep 3min of per-market history
  edgeTtlMs: 45_000, // an edge stays "open" 45s (scarcity)
  edgeFillLimit: 5_000, // max fake-USD stake per edge (scarcity)
  edgeCooldownMs: 90_000, // don't re-fire the same market+kind within this
};

// Match events worth reacting to, detected via score deltas (robust to Action naming).
const STAT_EVENTS = ["Goals", "RedCards"]; // YellowCards/Corners = lower impact (v1 ignores)

export class EdgeEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.cfg = { ...DEFAULTS, ...opts };
    this.markets = new Map(); // marketKey -> { meta, history:[{ts,prob}] }
    this.fixtures = new Map(); // fixtureId -> { prevTotals, lastEvent, clock, gameState }
    this.edges = new Map(); // edgeId -> edge
    this._lastFire = new Map(); // `${marketKey}|${kind}` -> ts (cooldown)
    this._seq = 0;
  }

  // ---- ingest -------------------------------------------------------------
  ingestOdds(rec) {
    const now = Number(rec.Ts) || Date.now();
    for (const { side, prob, idx } of this._fairProbs(rec)) {
      const marketKey = `${rec.FixtureId}|${rec.SuperOddsType}|${rec.MarketParameters}|${rec.MarketPeriod}|${side}`;
      let m = this.markets.get(marketKey);
      if (!m) {
        m = {
          meta: {
            fixtureId: rec.FixtureId,
            superOddsType: rec.SuperOddsType,
            marketParameters: rec.MarketParameters,
            marketPeriod: rec.MarketPeriod,
            side,
            sideIndex: idx,
            inRunning: rec.InRunning,
          },
          history: [],
        };
        this.markets.set(marketKey, m);
      }
      m.meta.inRunning = rec.InRunning;
      m.history.push({ ts: now, prob });
      this._trim(m.history, now);

      // STEAM: compare to the prob one window ago.
      const past = this._probAt(m.history, now - this.cfg.steamWindowMs);
      if (past != null) {
        const delta = prob - past;
        if (Math.abs(delta) >= this.cfg.steamThreshold) {
          this._fire("steam", marketKey, m.meta, {
            edgeMeasure: Math.abs(delta),
            fairProb: prob,
            direction: delta > 0 ? "back" : "lay", // prob rising → back this side
            note: `fair prob ${(past * 100).toFixed(1)}%→${(prob * 100).toFixed(1)}% in ≤${this.cfg.steamWindowMs / 1000}s`,
          });
        }
      }

      // OVERREACTION: a recent match event + a big swing since it.
      const fx = this.fixtures.get(rec.FixtureId);
      if (fx?.lastEvent && now - fx.lastEvent.ts <= this.cfg.overreactionWindowMs) {
        const atEvent = this._probAt(m.history, fx.lastEvent.ts);
        if (atEvent != null) {
          const swing = prob - atEvent;
          if (Math.abs(swing) >= this.cfg.overreactionThreshold) {
            this._fire("overreaction", marketKey, m.meta, {
              edgeMeasure: Math.abs(swing),
              fairProb: prob,
              direction: swing > 0 ? "lay" : "back", // FADE the overshoot
              trigger: fx.lastEvent.label,
              note: `${fx.lastEvent.label}: ${(atEvent * 100).toFixed(1)}%→${(prob * 100).toFixed(1)}% — fade the overreaction`,
            });
          }
        }
      }
    }
  }

  ingestScores(rec) {
    const now = Number(rec.Ts) || Date.now();
    const fx = this.fixtures.get(rec.FixtureId) || { prevTotals: {} };
    fx.clock = rec.Clock;
    fx.gameState = rec.GameState;

    // Detect goals / red cards by delta on the period-"Total" score (robust).
    const totals = this._extractTotals(rec.Score);
    for (const part of ["Participant1", "Participant2"]) {
      for (const stat of STAT_EVENTS) {
        const prev = fx.prevTotals?.[part]?.[stat] ?? null;
        const cur = totals[part]?.[stat] ?? 0;
        if (prev != null && cur > prev) {
          const label = `${stat === "Goals" ? "GOAL" : "RED CARD"} (${part})`;
          fx.lastEvent = { stat, part, label, ts: now, action: rec.Action };
          this.emit("matchEvent", {
            fixtureId: rec.FixtureId,
            label,
            stat,
            participant: part,
            clock: rec.Clock,
            ts: now,
          });
        }
      }
    }
    fx.prevTotals = totals;
    this.fixtures.set(rec.FixtureId, fx);
  }

  // ---- edge lifecycle -----------------------------------------------------
  _fire(kind, marketKey, meta, payload) {
    const fireKey = `${marketKey}|${kind}`;
    const now = Date.now();
    const last = this._lastFire.get(fireKey) || 0;
    if (now - last < this.cfg.edgeCooldownMs) return; // de-dupe bursts
    this._lastFire.set(fireKey, now);

    const id = `edge_${++this._seq}`;
    const edge = {
      id,
      kind,
      market: { ...meta },
      conviction: this._tier(payload.edgeMeasure),
      openedAt: now,
      expiresAt: now + this.cfg.edgeTtlMs,
      fillLimit: this.cfg.edgeFillLimit,
      filled: 0,
      status: "open",
      ...payload,
    };
    this.edges.set(id, edge);
    setTimeout(() => this._expire(id), this.cfg.edgeTtlMs).unref?.();
    this.emit("edge", edge);
    return edge;
  }

  _expire(id) {
    const e = this.edges.get(id);
    if (e && e.status === "open") {
      e.status = "expired";
      this.emit("edgeClosed", e);
    }
  }

  // Record a fake-USD stake against an open edge (respects fill limit + expiry).
  stake(edgeId, amount) {
    const e = this.edges.get(edgeId);
    if (!e || e.status !== "open" || Date.now() > e.expiresAt) return { ok: false, reason: "closed" };
    const room = e.fillLimit - e.filled;
    if (room <= 0) return { ok: false, reason: "filled" };
    const accepted = Math.min(amount, room);
    e.filled += accepted;
    if (e.filled >= e.fillLimit) {
      e.status = "filled";
      this.emit("edgeClosed", e);
    }
    return { ok: true, accepted, remaining: e.fillLimit - e.filled };
  }

  openEdges() {
    const now = Date.now();
    return [...this.edges.values()].filter((e) => e.status === "open" && now <= e.expiresAt);
  }

  // ---- helpers ------------------------------------------------------------
  _fairProbs(rec) {
    const names = rec.PriceNames || [];
    const prices = rec.Prices || [];
    const out = [];
    for (let i = 0; i < names.length; i++) {
      const p = Number(prices[i]);
      if (p > 0) out.push({ side: names[i], idx: i, prob: 1 / (p / 1000) });
    }
    return out;
  }

  _extractTotals(score) {
    const pick = (p) => {
      const t = score?.[p]?.Total || {};
      return {
        Goals: t.Goals ?? 0,
        RedCards: t.RedCards ?? 0,
        YellowCards: t.YellowCards ?? 0,
        Corners: t.Corners ?? 0,
      };
    };
    return { Participant1: pick("Participant1"), Participant2: pick("Participant2") };
  }

  _probAt(history, ts) {
    // last sample at or before ts
    let best = null;
    for (const h of history) {
      if (h.ts <= ts) best = h.prob;
      else break;
    }
    return best;
  }

  _trim(history, now) {
    const cutoff = now - this.cfg.historyMs;
    while (history.length && history[0].ts < cutoff) history.shift();
  }

  _tier(measure) {
    if (measure >= 0.1) return "High";
    if (measure >= 0.06) return "Medium";
    return "Low";
  }
}
