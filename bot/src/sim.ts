// Dev harness: fire ONE fake call into every active group, then settle it, so the
// full pipeline (post → tap → tally → settle → payout → group board → proof ledger)
// can be verified without a live World Cup match. Runs alongside the live service
// (it only sends/edits messages; the running service handles the taps via its
// long-poll, since both share the DB).
//
//   npx tsx src/sim.ts        → settles YES (simulates the event happening)
//   npx tsx src/sim.ts no     → settles NO  (simulates the window elapsing)
import { openCall, settleFixtureStat, sweepElapsed } from "./calls.ts";
import { openCallsForFixture } from "./db.ts";

const FID = 999000001; // fake fixture id, won't collide with real TxLINE ids
const mode = process.argv[2] === "no" ? "no" : "yes";

async function main() {
  const match = { fid: FID, p1: "Testonia", p2: "Probaria", iso1: "", iso2: "" };
  await openCall(match, "high_danger", 1, 600, Date.now(), true);
  const calls = await openCallsForFixture(FID);
  if (!calls.length) {
    console.log("No active group got a call. Add the bot to a group and /start there first.");
    process.exit(0);
  }
  console.log(`Fired to ${calls.length} group(s), market=${calls[0].market}. Tap it now; settling (${mode}) in 35s...`);
  await new Promise((r) => setTimeout(r, 35_000));
  if (mode === "no") await sweepElapsed(FID, 999_999, Date.now());
  else await settleFixtureStat(FID, calls[0].market as any, 1, 700, Date.now());
  console.log("Settled. Check the message, /top in the group, and the /proof ledger.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
