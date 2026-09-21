/**
 * Deploy the current contract and replay the exact post_task that failed, so
 * the fix is proven against the real call rather than against a test double.
 *
 *   node scripts/verify-fix.mjs [before_url]
 *
 * Uses a throwaway account: this proves behaviour, it does not produce the
 * deployment you keep. Deploy the one you keep from /deploy with your own
 * wallet, so your address owns it.
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
const BEFORE =
  process.argv[2] ||
  "https://gateway.pinata.cloud/ipfs/QmPiuq2ec8CRuVLXidgNYbx8VYRhhv8uBobHKQB6BvBU8Y";

const GEN = (n) => BigInt(n) * BigInt(10) ** BigInt(18);
const code = readFileSync("contracts/fieldwork.py");

const TASK = {
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
      if (i >= n) throw e;
      console.log(
        `  ${label} attempt ${i} failed (${String(e?.message ?? e).slice(0, 60)}), retrying`
      );
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 30000);
    }
  }
}

/**
 * The refusal sentence, out of whichever shape the node used.
 *
 * Studio uses BOTH: some refusals arrive as `{status:"rollback", payload:"..."}`
 * and others as base64 with a one byte tag in front. Measured on the same
 * contract minutes apart. Handling only one of them prints mojibake and makes a
 * correct refusal look like a broken script, so check the object first.
 */
function refusalText(round) {
  const res = round?.result;
  if (!res) return "";
  if (typeof res === "object") return String(res.payload ?? res.data ?? "");
  try {
    return Buffer.from(String(res), "base64")
      .toString("utf8")
      .slice(1)
      .replace(/[^\x20-\x7e\n]/g, "")
      .trim();
  } catch {
    return "";
  }
}

function verdict(receipt) {
  const lr =
    receipt?.consensus_data?.leader_receipt ?? receipt?.consensusData?.leaderReceipt;
  const rounds = Array.isArray(lr) ? lr : lr ? [lr] : [];
  const r0 = rounds[0] ?? {};
  const exec = r0.execution_result ?? r0.executionResult;
  // `result` is a refusal sentence only on ERROR. On SUCCESS it is the return
  // value in GenVM's own encoding, and reading that as text prints mojibake.
  let msg = "";
  if (String(exec).toUpperCase() !== "SUCCESS") msg = refusalText(r0);
  return { exec, msg, stderr: (r0.genvm_result ?? {}).stderr ?? "" };
}

const account = createAccount();
const client = createClient({ chain: studionet, account });
console.log("deployer  ", account.address);
console.log("before url", BEFORE, "\n");

await rpc("sim_fundAccount", [account.address, 5000]);
await new Promise((r) => setTimeout(r, 4000));

console.log("deploying the current contract ...");
const dh = await retry(
  () => client.deployContract({ code, args: [0], leaderOnly: false }),
  "deploy"
);
const dr = await retry(
  () =>
    client.waitForTransactionReceipt({
      hash: dh,
      status: TransactionStatus.FINALIZED,
      retries: 300,
      interval: 4000,
    }),
  "deploy receipt"
);
const address = dr?.data?.contract_address ?? dr?.contract_address;
console.log("deployed at", address, "\n");

console.log("calling post_task with the photograph that was refused ...");
const h = await retry(
  () =>
    client.writeContract({
      address,
      functionName: "post_task",
      args: [
        TASK.title,
        TASK.place,
        TASK.test,
        TASK.pass,
        TASK.fail,
        BEFORE,
        51505100,
        -122600,
        GEN(18),
        1,
        "",
        0,
      ],
      value: GEN(18),
    }),
  "post_task"
);
console.log("tx", h);

const receipt = await retry(
  () =>
    client.waitForTransactionReceipt({
      hash: h,
      status: TransactionStatus.FINALIZED,
      retries: 300,
      interval: 4000,
    }),
  "post receipt"
);

const v = verdict(receipt);
console.log("\nexecution_result:", v.exec);
if (v.msg) console.log("message         :", v.msg);
if (String(v.stderr).trim()) console.log("stderr          :", String(v.stderr).trim().slice(-400));

if (String(v.exec).toUpperCase() === "SUCCESS") {
  const total = await retry(
    () => client.readContract({ address, functionName: "total_tasks", args: [] }),
    "total_tasks"
  );
  const before = await retry(
    () => client.readContract({ address, functionName: "before_url_of", args: [0] }),
    "before_url_of"
  );
  const status = await retry(
    () => client.readContract({ address, functionName: "status_of", args: [0] }),
    "status_of"
  );
  console.log("\ntotal_tasks   :", String(total));
  console.log("status_of(0)  :", String(status));
  console.log("before_url_of :", String(before));
  console.log("\n=> the task was posted and funded. The fix works.");
} else {
  console.log("\n=> still refused. The message above is why.");
  process.exit(1);
}
