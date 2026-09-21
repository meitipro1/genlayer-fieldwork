/**
 * Does a payout from this contract actually reach the payee?
 *
 *   FIELDWORK=0x... node scripts/check-payout.mjs
 *
 * Fieldwork's whole promise is that the worker is paid on the spot, so this is
 * worth measuring rather than assuming. It uses `cancel_task`, which refunds the
 * poster through the same _pay/emit_transfer path a payout uses but needs no
 * photographs and no vision call.
 *
 * Reports three balances so the answer is unambiguous:
 *   poster before/after - did the money arrive?
 *   contract before/after - did the money leave?
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
const fmt = (wei) => `${(Number(wei) / 1e18).toFixed(4)} GEN`;

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  return res.json();
}

async function balance(addr) {
  const r = await rpc("eth_getBalance", [addr, "latest"]);
  try {
    return BigInt(r?.result ?? "0x0");
  } catch {
    return BigInt(0);
  }
}

/** Studio drops connections and rate limits; neither means the probe failed. */
async function retry(fn, label, attempts = 6) {
  let wait = 2500;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.details || e?.message || e);
      const soft =
        /fetch failed|ECONNRESET|Rate limit|slots occupied|Server busy|socket hang up|timeout/i.test(msg);
      if (!soft || i === attempts) throw e;
      process.stdout.write(`(${label} retry ${i}) `);
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 20000);
    }
  }
}

function explain(receipt) {
  const lr =
    receipt?.consensus_data?.leader_receipt ??
    receipt?.consensusData?.leaderReceipt;
  const one = Array.isArray(lr) ? lr[0] : lr;
  const stderr = one?.genvm_result?.stderr ?? one?.genvmResult?.stderr ?? "";
  return {
    execResult: one?.execution_result ?? one?.executionResult,
    reason: one?.error || String(stderr).trim().split("\n").filter(Boolean).pop() || "",
    pending: receipt?.pending_transactions ?? receipt?.pendingTransactions,
  };
}

const GOOD = {
  title: "Payout probe - cancel refunds the poster",
  place: "nowhere",
  test:
    "The bin area is empty. No bags remain against the wall, the ground is "
    + "clear of loose litter, and both bins are upright with their lids closed.",
  pass: "Wall and ground clear, bins upright, lids down, code legible.",
  fail: "Bags moved out of shot rather than removed.",
};

async function main() {
  log(`network   ${chain.name}`);
  log(`contract  ${ADDRESS}\n`);

  const poster = createAccount();
  const client = createClient({ chain, account: poster });
  log(`poster ${poster.address}`);

  await rpc("sim_fundAccount", [poster.address, Number(GEN(500))]);
  await new Promise((r) => setTimeout(r, 6000));

  const reward = 18;
  const feeBps = Number(
    await retry(
      () => client.readContract({ address: ADDRESS, functionName: "fee_bps_value", args: [] }),
      "fee_bps"
    )
  );
  const value = GEN(reward) + (GEN(reward) * BigInt(feeBps)) / BigInt(10000);

  const posterFunded = await balance(poster.address);
  const contractStart = await balance(ADDRESS);
  log(`\nafter funding:`);
  log(`  poster    ${fmt(posterFunded)}`);
  log(`  contract  ${fmt(contractStart)}`);

  if (posterFunded === BigInt(0)) {
    log("\n[!!] poster reads 0 after funding - balances are not observable here,");
    log("     so this probe cannot answer the question on this network.");
  }

  // ---- post (money goes IN to the contract) ----
  log(`\nposting a task for ${reward} GEN + fee ...`);
  const postHash = await retry(() => client.writeContract({
    address: ADDRESS,
    functionName: "post_task",
    args: [GOOD.title, GOOD.place, GOOD.test, GOOD.pass, GOOD.fail, BEFORE, 0, 0, GEN(reward), 0, "", 0, 0],
    value,
  }), "post");
  await retry(() => client.waitForTransactionReceipt({
    hash: postHash,
    status: TransactionStatus.FINALIZED,
    retries: 300,
    interval: 3000,
  }), "post receipt");

  const taskId = Number(
    await retry(
      () => client.readContract({ address: ADDRESS, functionName: "total_tasks", args: [] }),
      "total_tasks"
    )
  ) - 1;
  const posterAfterPost = await balance(poster.address);
  const contractAfterPost = await balance(ADDRESS);
  log(`  task ${taskId} created`);
  log(`  poster    ${fmt(posterFunded)} -> ${fmt(posterAfterPost)}`);
  log(`  contract  ${fmt(contractStart)} -> ${fmt(contractAfterPost)}`);

  const paidIn = contractAfterPost - contractStart;
  log(`  contract gained ${fmt(paidIn)}  ${paidIn > 0 ? "[ok]" : "[!! funding did not arrive]"}`);

  // ---- cancel (money should come BACK OUT to the poster) ----
  log(`\ncancelling task ${taskId} - the contract should refund the poster ...`);
  const cancelHash = await retry(() => client.writeContract({
    address: ADDRESS,
    functionName: "cancel_task",
    args: [taskId],
    value: BigInt(0),
  }), "cancel");
  const receipt = await retry(() => client.waitForTransactionReceipt({
    hash: cancelHash,
    status: TransactionStatus.FINALIZED,
    retries: 300,
    interval: 3000,
  }), "cancel receipt");

  const d = explain(receipt);
  log(`  execution: ${d.execResult ?? "SUCCESS"}${d.reason ? " - " + d.reason.slice(0, 70) : ""}`);
  if (d.pending) {
    log(`  emitted messages: ${JSON.stringify(d.pending).slice(0, 220)}`);
  }

  // give the ledger a moment to apply the emitted transfer
  await new Promise((r) => setTimeout(r, 8000));

  const posterEnd = await balance(poster.address);
  const contractEnd = await balance(ADDRESS);

  log(`\nafter the refund:`);
  log(`  poster    ${fmt(posterAfterPost)} -> ${fmt(posterEnd)}`);
  log(`  contract  ${fmt(contractAfterPost)} -> ${fmt(contractEnd)}`);

  const left = contractAfterPost - contractEnd;
  const arrived = posterEnd - posterAfterPost;

  log("\n" + "=".repeat(60));
  log(`  left the contract:  ${fmt(left)}`);
  log(`  reached the poster: ${fmt(arrived)}`);
  log("=".repeat(60));

  if (left > 0 && arrived > 0) {
    log("\n✓ payouts land. The contract pays and the payee is credited.");
  } else if (left > 0 && arrived === BigInt(0)) {
    log("\n✗ THE PAYOUT DOES NOT LAND ON THIS NETWORK.");
    log("  The contract was debited and the payee was not credited.");
    log("  The contract is behaving correctly - the ledger is not applying");
    log("  the emitted transfer. Any UI that says 'paid' here must say so.");
  } else if (left === BigInt(0)) {
    log("\n? nothing left the contract - check the execution result above.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
