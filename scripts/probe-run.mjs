/**
 * Deploy contracts/probe_preflight.py and run it, so a question about what the
 * runner can actually do gets an answer from the runner rather than a guess.
 *
 *   node scripts/probe-run.mjs [url]
 *
 * Studio is gasless, so this costs nothing but a minute.
 */

import dns from "node:dns";

// Studio sits behind Cloudflare on both stacks and its AAAA addresses time out.
// Node tries IPv6 first, so every request burns ~10s and then reports a bare
// "fetch failed" that looks like the chain is down. This must run before any
// client is created, in every entry point that talks to the RPC.
dns.setDefaultResultOrder("ipv4first");

import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { readFileSync } from "node:fs";

const RPC = studionet.rpcUrls.default.http[0];
const URL_TO_TEST =
  process.argv[2] ||
  "https://gateway.pinata.cloud/ipfs/QmPiuq2ec8CRuVLXidgNYbx8VYRhhv8uBobHKQB6BvBU8Y";

const code = readFileSync("contracts/probe_preflight.py");

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  return r.json();
}

async function retry(fn, label, n = 6) {
  let wait = 3000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = String(e?.message ?? e);
      if (i >= n) throw e;
      console.log(`  ${label} attempt ${i} failed (${m.slice(0, 70)}), retrying`);
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 30000);
    }
  }
}

const account = createAccount();
const client = createClient({ chain: studionet, account });
console.log("deployer", account.address);

await rpc("sim_fundAccount", [account.address, 1000]);
await new Promise((r) => setTimeout(r, 4000));

console.log("deploying probe ...");
const hash = await retry(
  () => client.deployContract({ code, args: [], leaderOnly: false }),
  "deploy"
);
const receipt = await retry(
  () =>
    client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.FINALIZED,
      retries: 300,
      interval: 4000,
    }),
  "deploy receipt"
);
const address = receipt?.data?.contract_address ?? receipt?.contract_address;
console.log("probe at", address);

for (const [fn, args] of [
  ["codecs", []],
  ["look", [URL_TO_TEST]],
]) {
  console.log(`\ncalling ${fn}()`);
  const h = await retry(
    () => client.writeContract({ address, functionName: fn, args, value: BigInt(0) }),
    fn
  );
  await retry(
    () =>
      client.waitForTransactionReceipt({
        hash: h,
        status: TransactionStatus.FINALIZED,
        retries: 300,
        interval: 4000,
      }),
    `${fn} receipt`
  );
  const out = await retry(
    () => client.readContract({ address, functionName: "report", args: [] }),
    "report"
  );
  console.log(`--------- ${fn} ---------`);
  console.log(String(out));
}
