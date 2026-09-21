/**
 * End to end exercise of a deployed Fieldwork contract.
 *
 *   FIELDWORK=0x... node scripts/e2e.mjs
 *
 * Covers everything that does not need a human holding a piece of paper:
 *   1. post_task with a gradeable test + before photo -> accepted, funded
 *   2. post_task with a vague acceptance test         -> refused by the LLM gate
 *   3. post_task underfunded                          -> refused deterministically
 *   4. claim                                        -> six character code
 *   5. claim again from the same account            -> refused, already claimed
 *   6. views read back what was written
 *
 * The submit path needs a photograph with the issued code written on paper and
 * held in frame, so it is the one step a script cannot fake. The before frame
 * is not a problem - the poster supplies that, and step 1 does. The vision
 * grading it depends on is proven separately by scripts/prove-vision.mjs.
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
let failures = 0;

function check(ok, label, detail = "") {
  if (!ok) failures++;
  log(`  [${ok ? "ok  " : "FAIL"}] ${label}${detail ? " - " + detail : ""}`);
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
  const err = one?.error || "";
  const last = String(stderr).trim().split("\n").filter(Boolean).pop() || "";
  return {
    execResult: one?.execution_result ?? one?.executionResult,
    reason: err || last,
  };
}

const GOOD = {
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
};

const VAGUE = {
  title: "Tidy up the yard",
  place: "The yard",
  test: "Make sure the area is nice and clean and looks good when you finish.",
  pass: "It looks clean.",
  fail: "It does not look clean.",
};

async function send(client, functionName, args, value = BigInt(0)) {
  try {
    const hash = await client.writeContract({
      address: ADDRESS,
      functionName,
      args,
      value,
    });
    const receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      retries: 300,
      interval: 3000,
    });
    const d = explain(receipt);
    const ok = !d.execResult || String(d.execResult).toUpperCase() === "SUCCESS";
    return { ok, reason: d.reason, hash };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e), hash: null };
  }
}

async function read(client, functionName, args = []) {
  return client.readContract({ address: ADDRESS, functionName, args });
}

async function main() {
  log(`network   ${chain.name} (${chain.id})`);
  log(`contract  ${ADDRESS}\n`);

  const account = createAccount();
  const client = createClient({ chain, account });
  log(`poster/worker ${account.address}`);

  // Studio's programmatic faucet. eth_getBalance still reports 0x0 afterwards
  // because a wallet address always reads 0 there, but the funds are real.
  const funded = await rpc("sim_fundAccount", [account.address, Number(GEN(5000))]);
  log(`funded ${funded?.result ? "ok" : JSON.stringify(funded)}\n`);
  await new Promise((r) => setTimeout(r, 6000));

  const before = Number(await read(client, "total_tasks"));
  log(`total_tasks before  ${before}\n`);

  // ---- 1. a gradeable test, correctly funded ----
  log("1. post_task with a gradeable acceptance test");
  const reward = 18;
  const feeBps = Number(await read(client, "fee_bps_value"));
  const value = GEN(reward) + (GEN(reward) * BigInt(feeBps)) / BigInt(10000);
  const posted = await send(
    client,
    "post_task",
    [GOOD.title, GOOD.place, GOOD.test, GOOD.pass, GOOD.fail, BEFORE, 51505100, -122600, GEN(reward), 0, "", 0, 0],
    value
  );
  check(posted.ok, "accepted and funded", posted.ok ? "" : posted.reason);

  const after = Number(await read(client, "total_tasks"));
  check(after === before + 1, `total_tasks ${before} -> ${after}`);
  const taskId = after - 1;

  if (posted.ok) {
    const title = await read(client, "title_of", [taskId]);
    const status = await read(client, "status_of", [taskId]);
    const storedReward = await read(client, "reward_of", [taskId]);
    check(title === GOOD.title, "title reads back", String(title).slice(0, 40));
    check(status === "open", `status is open`, String(status));
    check(
      BigInt(storedReward) === GEN(reward),
      "reward stored in wei",
      String(storedReward)
    );
    const storedBefore = await read(client, "before_url_of", [taskId]);
    check(
      String(storedBefore) === BEFORE,
      "the poster's before photograph is on the task",
      String(storedBefore).slice(-12)
    );
  }

  // ---- 2. the LLM gate should refuse a vague test ----
  log("\n2. post_task with a vague acceptance test (should be refused)");
  const vague = await send(
    client,
    "post_task",
    [VAGUE.title, VAGUE.place, VAGUE.test, VAGUE.pass, VAGUE.fail, BEFORE, 51505100, -122600, GEN(reward), 0, "", 0, 0],
    value
  );
  check(!vague.ok, "refused by the acceptance test gate", vague.reason.slice(0, 110));
  const afterVague = Number(await read(client, "total_tasks"));
  check(afterVague === after, "no task was created for it");

  // ---- 3. underfunded ----
  log("\n3. post_task without enough value (should be refused)");
  const poor = await send(
    client,
    "post_task",
    [GOOD.title, GOOD.place, GOOD.test, GOOD.pass, GOOD.fail, BEFORE, 51505100, -122600, GEN(reward), 0, "", 0, 0],
    GEN(1)
  );
  check(!poor.ok, "refused for insufficient value", poor.reason.slice(0, 90));

  // ---- 4. claim ----
  if (posted.ok) {
    log("\n4. claim the task");
    const claimed = await send(client, "claim", [taskId]);
    check(claimed.ok, "claim accepted", claimed.ok ? "" : claimed.reason);

    if (claimed.ok) {
      const code = String(await read(client, "challenge_code_of", [taskId]));
      const status = await read(client, "status_of", [taskId]);
      const expires = await read(client, "claim_expires_of", [taskId]);
      const worker = await read(client, "claimed_by", [taskId]);

      check(code.length === 6, `six character code issued: ${code}`);
      check(
        /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/.test(code),
        "code avoids I, L, O, U, 0 and 1"
      );
      check(status === "claimed", "status is claimed", String(status));
      check(String(expires).length === 19, `expiry set: ${expires}`);
      check(
        String(worker).toLowerCase() === account.address.toLowerCase(),
        "claimed_by is the worker"
      );

      // ---- 5. double claim ----
      log("\n5. claim it again (should be refused)");
      const again = await send(client, "claim", [taskId]);
      check(!again.ok, "second claim refused", again.reason.slice(0, 80));
    }
  }

  // ---- 6. a task id that does not exist ----
  log("\n6. read a task that does not exist (should be refused)");
  try {
    await read(client, "status_of", [999999]);
    check(false, "reading a missing task should have failed");
  } catch (e) {
    check(true, "refused cleanly", String(e?.message || e).slice(0, 70));
  }

  log("\n" + "=".repeat(58));
  log(failures === 0 ? "  all end to end checks passed" : `  ${failures} FAILURES`);
  log("=".repeat(58));
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
