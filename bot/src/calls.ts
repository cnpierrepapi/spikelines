import { InlineKeyboard } from "grammy";
import { bot } from "./instance.ts";
import { env } from "./env.ts";
import { GROUP_REWARD, DECISION_WINDOW_MS, CALL_COOLDOWN_MS } from "./config.ts";
import {
  activeGroups, hasBlockingCall, insertCall, setCallMessage, getCall, recordAnswer, tally,
  openCallsForFixture, markSettled, answersFor, setAnswerOutcome, applyUserResult, applyGroupResult,
  ensureUser, getUser, type TgCall,
} from "./db.ts";
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

// A scoring chance / dangerous possession fired: pick ONE market for it, then post
// the same call to every active, non-quiet group (each gets its own message + tally
// + cooldown). No calls while the clock is stopped (half-time / breaks).
export async function openCall(m: LiveMatch, trigger: Trigger, side: 1 | 2, matchSec: number, baseTs: number, running: boolean): Promise<void> {
  if (!running) return;
  const market = pickMarket(trigger, side);
  const mins = pickWindow(market.kind, true);
  const team = side === 2 ? m.p2 : m.p1;
  const match = `${m.p1}-${m.p2}`;
  const groups = await activeGroups();
  for (const g of groups) {
    try {
      if (await hasBlockingCall(g.chat_id, CALL_COOLDOWN_MS)) continue;
      const id = await insertCall({
        chat_id: g.chat_id, fixture_id: m.fid, match, market: market.kind, side, team, mins,
        open_sec: matchSec, deadline_sec: matchSec + mins * 60, base_ts: baseTs,
        closes_at: new Date(Date.now() + DECISION_WINDOW_MS).toISOString(), status: "open",
      });
      const sent = await bot.api.sendMessage(g.chat_id, callText(team, market.kind, mins), { reply_markup: keyboard(id, 0, 0) });
      await setCallMessage(id, sent.message_id);
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

// Settlement. A matching stat settles YES; an elapsed window settles NO; full time
// settles every still-open call NO. Each answer pays out, updates the player + group
// board, and lands in the public /proof ledger (on-chain verified) via the site API.
async function settle(call: TgCall, result: "yes" | "no", settleTs: number | null): Promise<void> {
  await markSettled(call.id, result, settleTs);
  const answers = await answersFor(call.id);
  let winners = 0;
  for (const a of answers) {
    const won = (a.choice === "YES") === (result === "yes");
    const reward = won ? GROUP_REWARD : 0;
    if (won) winners++;
    await setAnswerOutcome(call.id, a.tg_id, won ? "won" : "lost", reward);
    const user = await applyUserResult(a.tg_id, won, reward);
    await applyGroupResult(call.chat_id, a.tg_id, won);
    postProof(call, a.tg_id, user?.handle ?? null, a.choice as "YES" | "NO", won, reward, settleTs).catch(() => {});
  }
  const word = RESULT_WORD[call.market] ?? call.market;
  const head = result === "yes" ? `✅ ${call.team} ${word} landed. YES wins.` : `❌ No ${call.team} ${word} in time. NO wins.`;
  const line = answers.length ? `\n${winners}/${answers.length} called it right.` : "";
  if (call.message_id) {
    try { await bot.api.editMessageText(call.chat_id, call.message_id, `${head}${line}`); } catch {}
  }
}

export async function settleFixtureStat(fixtureId: number, kind: MarketKind, side: 1 | 2, _matchSec: number, settleTs: number): Promise<void> {
  const calls = await openCallsForFixture(fixtureId);
  for (const c of calls) {
    if (marketMatches(c.market as MarketKind, c.side, { kind, side })) await settle(c, "yes", settleTs);
  }
}
export async function sweepElapsed(fixtureId: number, matchSec: number, settleTs: number): Promise<void> {
  const calls = await openCallsForFixture(fixtureId);
  for (const c of calls) {
    if (matchSec > c.deadline_sec) await settle(c, "no", settleTs);
  }
}
export async function settleAllNo(fixtureId: number, settleTs: number): Promise<void> {
  const calls = await openCallsForFixture(fixtureId);
  for (const c of calls) await settle(c, "no", settleTs);
}

// Land the settled call in the same public proof ledger the web app uses, so a
// group bet is on-chain verifiable exactly like an app bet.
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
      mode: "live",
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
