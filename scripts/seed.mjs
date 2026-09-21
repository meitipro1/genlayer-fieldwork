/**
 * Put real records on chain so the site has something to show.
 *
 *   FIELDWORK=0x... node scripts/seed.mjs
 *
 * The launch checklist asks for ten real records before any announcement.
 * Each post runs the acceptance-test gate, so this takes a while - that LLM
 * call is the point, not overhead.
 */

import dns from "node:dns";

// Studio sits behind Cloudflare on both stacks and its AAAA addresses time out.
// Node tries IPv6 first, so every request burns ~10s and then reports a bare
// "fetch failed" that looks like the chain is down. This must run before any
// client is created, in every entry point that talks to the RPC.
dns.setDefaultResultOrder("ipv4first");

import { createAccount, createClient } from "genlayer-js";
import { studionet, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const NETWORK = process.env.GENLAYER_NETWORK || "studionet";
const chain = NETWORK === "bradbury" ? testnetBradbury : studionet;
const RPC = chain.rpcUrls.default.http[0];
const ADDRESS = process.env.FIELDWORK;

if (!ADDRESS) {
  console.error("set FIELDWORK=0x... to the deployed contract address");
  process.exit(1);
}

// A real photograph on IPFS, known good end to end: this gateway serves the
// bytes to a node (ipfs.io and dweb.link both answered 504 for the same CID),
// the file is a JFIF JPEG so the model will read it, and it is large and bright
// enough to clear pre-flight. Whether an image works in a browser says nothing
// about whether a validator can read it.
const BEFORE =
  "https://gateway.pinata.cloud/ipfs/QmPiuq2ec8CRuVLXidgNYbx8VYRhhv8uBobHKQB6BvBU8Y";

const GEN = (n) => BigInt(n) * BigInt(10) ** BigInt(18);
const log = (...a) => console.log(...a);

const TASKS = [
  {
    title: "Clear the bin area behind 14 Mill St",
    place: "Mill St, behind the parade",
    test:
      "The bin area is empty. No bags remain against the wall, the ground is " +
      "clear of loose litter, and both bins are upright with their lids closed.",
    pass:
      "Wall and ground both visible and clear, bins upright, lids down, code " +
      "legible on paper held in frame.",
    fail:
      "Bags moved out of shot rather than removed, or the wall is not visible " +
      "in the after photograph.",
    reward: 18,
    rep: 1,
    lat: 51505100,
    lng: -122600,
  },
  {
    title: "Photograph charger 41 and its display",
    place: "Level 2, Northgate car park",
    test:
      "Charger 41 is shown head on with its screen readable. The screen shows " +
      "a status line, and the charger's unit number is visible in the same frame.",
    pass:
      "Screen readable without glare, unit number 41 visible, code held beside " +
      "the screen.",
    fail: "Screen washed out by sunlight, or the unit number cropped out of frame.",
    reward: 12,
    rep: 0,
    lat: 51512800,
    lng: -131900,
  },
  {
    title: "Confirm shelf display for brand X",
    place: "Aisle 7, Weston Road",
    test:
      "The brand X display stands at the aisle end, fully stocked with no gaps " +
      "in the front row, and the header card is present and straight.",
    pass:
      "Aisle end shown wide enough to see the whole display, front row complete, " +
      "header card straight.",
    fail: "Close crop that hides gaps, or a photograph of a different aisle end.",
    reward: 25,
    rep: 2,
    lat: 51498400,
    lng: -118200,
  },
  {
    title: "Clear fly tipping at the Canal Rd bridge",
    place: "Canal Rd, under the bridge",
    test:
      "The area under the bridge is clear of dumped material. The towpath is " +
      "walkable end to end and nothing is stacked against the bridge wall.",
    pass: "Towpath visible along its length, bridge wall clear, code held in frame.",
    fail:
      "Material pushed to the side rather than removed, or only a partial view " +
      "of the towpath.",
    reward: 30,
    rep: 1,
    lat: 51520300,
    lng: -140500,
  },
  {
    title: "Check the noticeboard at Ashfield Green",
    place: "Ashfield Green, north gate",
    test:
      "The noticeboard is clear of out of date posters, the glass is closed and " +
      "latched, and the current month's sheet is pinned in the top left corner.",
    pass: "Whole board in frame, glass closed, current sheet visible top left.",
    fail: "Angled shot that hides half the board, or glass left open.",
    reward: 10,
    rep: 0,
    lat: 51489900,
    lng: -112700,
  },
];

/**
 * Studio runs eight execution slots and answers -32006
 * "Server busy: all N execution slots occupied" when they are full. Posting a
 * run of tasks hits that reliably, so anything that talks to the chain goes
 * through here.
 */
async function withRetry(fn, label, attempts = 6) {
  let wait = 3000;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.details || e?.message || e);
      const busy = msg.includes("-32006") || /slots occupied|Server busy/i.test(msg);
      if (!busy || i === attempts) throw e;
      process.stdout.write(`(busy, retrying in ${wait / 1000}s) `);
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 20000);
    }
  }
  throw new Error(`${label} gave up`);
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  return res.json();
}

function explain(receipt) {
  const lr =
    receipt?.consensus_data?.leader_receipt ??
    receipt?.consensusData?.leaderReceipt;
  const one = Array.isArray(lr) ? lr[0] : lr;
  const stderr = one?.genvm_result?.stderr ?? one?.genvmResult?.stderr ?? "";
  return {
    execResult: one?.execution_result ?? one?.executionResult,
    reason:
      one?.error || String(stderr).trim().split("\n").filter(Boolean).pop() || "",
  };
}

async function main() {
  log(`network   ${chain.name}`);
  log(`contract  ${ADDRESS}\n`);

  const account = createAccount();
  const client = createClient({ chain, account });
  log(`poster ${account.address}`);
  await rpc("sim_fundAccount", [account.address, Number(GEN(100000))]);
  await new Promise((r) => setTimeout(r, 6000));

  const feeBps = Number(
    await withRetry(
      () =>
        client.readContract({
          address: ADDRESS,
          functionName: "fee_bps_value",
          args: [],
        }),
      "fee_bps_value"
    )
  );

  let ok = 0;
  for (const t of TASKS) {
    const rewardWei = GEN(t.reward);
    const value = rewardWei + (rewardWei * BigInt(feeBps)) / BigInt(10000);
    process.stdout.write(`  posting "${t.title.slice(0, 44)}" ... `);
    try {
      const hash = await withRetry(
        () =>
          client.writeContract({
            address: ADDRESS,
            functionName: "post_task",
            args: [t.title, t.place, t.test, t.pass, t.fail, BEFORE, t.lat, t.lng, rewardWei, t.rep, "", 0, 0],
            value,
          }),
        "post_task"
      );
      const receipt = await withRetry(
        () =>
          client.waitForTransactionReceipt({
            hash,
            status: TransactionStatus.FINALIZED,
            retries: 300,
            interval: 3000,
          }),
        "receipt"
      );
      const d = explain(receipt);
      const good = !d.execResult || String(d.execResult).toUpperCase() === "SUCCESS";
      log(good ? "ok" : `FAILED - ${d.reason.slice(0, 80)}`);
      if (good) ok++;
      await new Promise((r) => setTimeout(r, 2500));
    } catch (e) {
      log(`FAILED - ${String(e?.message || e).slice(0, 80)}`);
    }
  }

  const total = await withRetry(
    () =>
      client.readContract({
        address: ADDRESS,
        functionName: "total_tasks",
        args: [],
      }),
    "total_tasks"
  );
  log(`\n${ok}/${TASKS.length} posted. total_tasks now ${total}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
