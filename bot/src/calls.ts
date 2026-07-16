import { InlineKeyboard } from "grammy";
import { bot } from "./instance.ts";
import { env } from "./env.ts";
import { GROUP_REWARD, ARCHIVED_REWARD, DECISION_WINDOW_MS, CALL_COOLDOWN_MS, STREAK_SAVE_MIN, STREAK_MILESTONES } from "./config.ts";
import { offerStreakSave, dmMilestone } from "./notify.ts";
import {
  activeGroups, hasBlockingCall, insertCall, setCallMessage, getCall, recordAnswer, tally,
  openCallsForFixture, markSettled, answersFor, setAnswerOutcome, applyUserResult, applyGroupResult,
  ensureUser, type TgCall,
} from "./db.ts";
import { sessionActive } from "./sessions.ts";
import { pickMarket, pickWindow, marketMatches, marketQuestion, marketHeader, type Trigger, type MarketKind } from "../../lib/markets.ts";
import type { LiveMatch } from "./txline.ts";

const RESULT_WORD: Record<string, string> = { goal: "goal", corner: "corner", yellow: "yellow card", red: "red card" };

function keyboard(id: number, yes: number, no: number): InlineKeyboard {
  return new InlineKeyboard().text(`YES 👍 ${yes || ""}`.trim(), `ans:${id}:YES`).text(`NO 👎 ${no || ""}`.trim(), `ans:${id}:NO`);
}
function callText(team: string, market: MarketKind, mins: number): string {
  const h = marketHeader(market);
  return `${h.icon} ${h.text}\n${marketQuestion(market, team, mins)}\n\n⏱ tap within 30s`;
}

// Create + post ONE call to a single chat; returns the full row (with id +
// message_id). Used by both the live fan-out and an archived replay session.
export async function postCall(o: {
  chatId: number; fid: number; match: string; market: MarketKind; side: 1 | 2; team: string;
  mins: number; matchSec: number; baseTs: number | null; mode: "live" | "archived";
}): Promise<TgCall | null> {
  const closes_at = new Date(Date.now() + DECISION_WINDOW_MS).toISOString();
  const deadline_sec = o.matchSec + o.mins * 60;
  const id = await insertCall({
    chat_id: o.chatId, fixture_id: o.fid, match: o.match, market: o.market, side: o.side, team: o.team,
    mins: o.mins, open_sec: o.matchSec, deadline_sec, base_ts: o.baseTs, closes_at, status: "open", mode: o.mode,
  });
  let message_id: number | null = null;
  try {
    const sent = await bot.api.sendMessage(o.chatId, callText(o.team, o.market, o.mins), { reply_markup: keyboard(id, 0, 0) });
    message_id = sent.message_id;
    await setCallMessage(id, message_id);
  } catch (e) {
    console.error("postCall send", o.chatId, e);
  }
  return { id, message_id, chat_id: o.chatId, fixture_id: o.fid, match: o.match, market: o.market, side: o.side, team: o.team, mins: o.mins, open_sec: o.matchSec, deadline_sec, base_ts: o.baseTs, settle_ts: null, closes_at, status: "open", result: null, mode: o.mode };
}

// LIVE: one market per chance, posted to every active non-quiet group (skipping any
// that's mid archived-session). No calls while the clock is stopped.
export async function openCall(m: LiveMatch, trigger: Trigger, side: 1 | 2, matchSec: number, baseTs: number, running: boolean): Promise<void> {
  if (!running) return;
  const market = pickMarket(trigger, side);
  const mins = pickWindow(market.kind, true);
  const team = side === 2 ? m.p2 : m.p1;
  const match = `${m.p1}-${m.p2}`;
  for (const g of await activeGroups()) {
    try {
      if (sessionActive(g.chat_id)) continue;
      if (await hasBlockingCall(g.chat_id, CALL_COOLDOWN_MS)) continue;
      await postCall({ chatId: g.chat_id, fid: m.fid, match, market: market.kind, side, team, mins, matchSec, baseTs, mode: "live" });
    } catch (e) {
      console.error("openCall chat", g.chat_id, e);
    }
  }
}

// A tap. Records the pick (one per user), refreshes the live tally on the message.
export async function handleAnswer(callId: number, tgId: number, choice: "YES" | "NO", opts: { username?: string; firstName?: string }): Promise<string> {
  const call = await getCall(callId);
  if (!call || call.status !== "open" || Date.now() > new Date(call.closes_at).getTime()) return "This call is closed.";
  await ensureUser(tgId, opts);
  const inserted = await recordAnswer(callId, tgId, choice);
  if (!inserted) return "You already called this one.";
  const t = await tally(callId);
  if (call.message_id) {
    try { await bot.api.editMessageReplyMarkup(call.chat_id, call.message_id, { reply_markup: keyboard(callId, t.yes, t.no) }); } catch {}
  }
  return `Locked in: ${choice} 👍`;
}

// Settle ONE call. Reward + proof mode come from the call itself (live 20 / archived
// 15). Each answer pays out, updates the player + group board, and lands in the same
// public /proof ledger (on-chain verified) via the site API.
export async function settleOne(call: TgCall, result: "yes" | "no", settleTs: number | null): Promise<void> {
  await markSettled(call.id, result, settleTs);
  const answers = await answersFor(call.id);
  const rewardBase = call.mode === "archived" ? ARCHIVED_REWARD : GROUP_REWARD;
  let winners = 0;
  for (const a of answers) {
    const won = (a.choice === "YES") === (result === "yes");
    const reward = won ? rewardBase : 0;
    if (won) winners++;
    await setAnswerOutcome(call.id, a.tg_id, won ? "won" : "lost", reward);
    const res = await applyUserResult(a.tg_id, won, reward);
    await applyGroupResult(call.chat_id, a.tg_id, won);
    postProof(call, a.tg_id, res?.user.handle ?? null, a.choice as "YES" | "NO", won, reward, settleTs).catch(() => {});
    // Economy touch-points: offer to buy back a broken streak, or praise a crossed one.
    if (res) {
      if (!won && res.prevStreak >= STREAK_SAVE_MIN) {
        offerStreakSave(a.tg_id, call.chat_id, res.prevStreak, res.user.notify).catch(() => {});
      } else if (won && STREAK_MILESTONES.includes(res.streak) && res.prevStreak < res.streak) {
        dmMilestone(a.tg_id, res.streak, res.user.notify).catch(() => {});
      }
    }
  }
  const word = RESULT_WORD[call.market] ?? call.market;
  const head = result === "yes" ? `✅ ${call.team} ${word} landed. YES wins.` : `❌ No ${call.team} ${word} in time. NO wins.`;
  const line = answers.length ? `\n${winners}/${answers.length} called it right.` : "";
  if (call.message_id) {
    try { await bot.api.editMessageText(call.chat_id, call.message_id, `${head}${line}`); } catch {}
  }
}

// LIVE fixture-scoped settlement (all groups on the same live match settle together).
export async function settleFixtureStat(fixtureId: number, kind: MarketKind, side: 1 | 2, _matchSec: number, settleTs: number): Promise<void> {
  for (const c of await openCallsForFixture(fixtureId)) {
    if (marketMatches(c.market as MarketKind, c.side, { kind, side })) await settleOne(c, "yes", settleTs);
  }
}
export async function sweepElapsed(fixtureId: number, matchSec: number, settleTs: number): Promise<void> {
  for (const c of await openCallsForFixture(fixtureId)) {
    if (matchSec > c.deadline_sec) await settleOne(c, "no", settleTs);
  }
}
export async function settleAllNo(fixtureId: number, settleTs: number): Promise<void> {
  for (const c of await openCallsForFixture(fixtureId)) await settleOne(c, "no", settleTs);
}

// Land the settled call in the same public proof ledger the web app uses.
async function postProof(call: TgCall, tgId: number, handle: string | null, choice: "YES" | "NO", won: boolean, reward: number, settleTs: number | null): Promise<void> {
  await fetch(`${env.MINIAPP_URL}/api/bets/settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_id: `tg:${tgId}`,
      client_bet_id: `tg-${call.id}`,
      username: handle,
      fixture_id: call.fixture_id,
      match: call.match,
      mode: call.mode,
      market: call.market,
      side: call.side,
      mins: call.mins,
      choice,
      outcome: won ? "won" : "lost",
      reward,
      base_ts: call.base_ts,
      settle_ts: settleTs,
    }),
  } as RequestInit);
}
