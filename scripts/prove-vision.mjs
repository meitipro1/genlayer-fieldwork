/**
 * Answer the one question that can sink this product:
 * does gl.nondet.exec_prompt(images=[...]) actually execute on this network?
 *
 *   node scripts/prove-vision.mjs [imageUrl]
 *
 * Deploys the probe once and then walks three steps, so a failure says which
 * part broke rather than just "INVALID_IMAGE":
 *   1. fetch_only - are the bytes reaching the contract a real image?
 *   2. describe_text - vision with the default text response format
 *   3. describe_json - vision with response_format='json'
 *
 * Studio is gasless, so this uses an account generated in memory and thrown
 * away. Nothing is stored and no faucet is needed. For the real Fieldwork
 * contract use a named CLI account, because the deployer becomes the owner.
 */

import dns from "node:dns";

// Studio sits behind Cloudflare on both stacks and its AAAA addresses time out.
// Node tries IPv6 first, so every request burns ~10s and then reports a bare
// "fetch failed" that looks like the chain is down. This must run before any
// client is created, in every entry point that talks to the RPC.
dns.setDefaultResultOrder("ipv4first");

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studionet, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const NETWORK = process.env.GENLAYER_NETWORK || "studionet";
const chain = NETWORK === "bradbury" ? testnetBradbury : studionet;
const RPC = chain.rpcUrls.default.http[0];

// Content addressed, and measured to work end to end on this network: the
// gateway serves it to a node, and the model reads it and describes it.
//
// Two traps sit behind that sentence. Wikimedia answers 403 to a plain client
// and the error page reaches the model as if it were a photograph. And a JPEG
// with no JFIF header (magic ffd8ffdb rather than ffd8ffe0) is read happily by
// Pillow and rejected by the model. Both surface only as INVALID_IMAGE, so a
// default image for this script has to be one that is known good.
const IMAGE =
  process.argv[2] ||
  "https://gateway.pinata.cloud/ipfs/QmPiuq2ec8CRuVLXidgNYbx8VYRhhv8uBobHKQB6BvBU8Y";

const log = (...a) => console.log(...a);

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  return res.json();
}

async function getContractCode(address) {
  // Studio wants a bare address string; Bradbury wants an object.
  const shape = NETWORK === "bradbury" ? [{ address }] : [address];
  return rpc("gen_getContractCode", shape);
}

/** The real reason a transaction failed. `error` is empty on Studio. */
function explain(receipt) {
  const lr =
    receipt?.consensus_data?.leader_receipt ??
    receipt?.consensusData?.leaderReceipt;
  const one = Array.isArray(lr) ? lr[0] : lr;
  const stderr = one?.genvm_result?.stderr ?? one?.genvmResult?.stderr ?? "";
  return {
    execResult: one?.execution_result ?? one?.executionResult,
    stderr,
    // the last line is the actual exception
    last: String(stderr).trim().split("\n").filter(Boolean).pop() || "",
  };
}

async function callMethod(client, address, functionName, args) {
  const hash = await client.writeContract({
    address,
    functionName,
    args,
    value: BigInt(0),
  });
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries: 300,
    interval: 3000,
  });
  const detail = explain(receipt);
  const ok =
    !detail.execResult ||
    String(detail.execResult).toUpperCase() === "SUCCESS";
  let value = null;
  if (ok) {
    value = await client.readContract({ address, functionName: "answer", args: [] });
  }
  return { ok, value, detail, hash };
}

async function main() {
  log(`network   ${chain.name}  (chainId ${chain.id})`);
  log(`rpc       ${RPC}`);
  log(`image     ${IMAGE}\n`);

  const health = await rpc("eth_blockNumber", []);
  if (!health?.result) {
    console.error("RPC not answering:", JSON.stringify(health));
    process.exit(1);
  }
  log(`[ok] rpc alive, block ${parseInt(health.result, 16)}`);
  const gp = await rpc("eth_gasPrice", []);
  log(`[ok] gasPrice ${gp?.result}${gp?.result === "0x0" ? "  (gasless)" : ""}`);

  const account = createAccount();
  log(`[ok] ephemeral account ${account.address}`);

  const client = createClient({ chain, account });

  // Reuse an already deployed probe when given one, so trying another image
  // does not cost a deploy.
  let address = process.env.PROBE_ADDRESS || "";

  if (!address) {
    const code = readFileSync(join(ROOT, "contracts", "vision_probe.py"), "utf8");
    log("\ndeploying contracts/vision_probe.py ...");
    const deployHash = await client.deployContract({ code, args: [] });
    log(`     tx ${deployHash}`);

    const deployReceipt = await client.waitForTransactionReceipt({
      hash: deployHash,
      status: TransactionStatus.FINALIZED,
      retries: 200,
      interval: 3000,
    });

    address =
      deployReceipt?.data?.contract_address ??
      deployReceipt?.contract_address ??
      deployReceipt?.contractAddress;
    if (!address) {
      console.error(JSON.stringify(explain(deployReceipt), null, 2));
      process.exit(1);
    }
    log(`[ok] deployed at ${address}`);
  } else {
    log(`[ok] reusing probe at ${address}`);
  }

  const codeCheck = await getContractCode(address);
  if (!codeCheck?.result) {
    console.error(JSON.stringify(codeCheck, null, 2));
    console.error(
      "\n✗ code not readable at that address. On Bradbury this is the known " +
        "network bug: deploy reports success but the code is gone."
    );
    process.exit(1);
  }
  log(`[ok] contract code readable (${String(codeCheck.result).length} chars)`);

  // 1. what did the contract actually receive?
  log("\n[1/3] fetch_only - what bytes reached the contract");
  const fetched = await callMethod(client, address, "fetch_only", [IMAGE]);
  if (!fetched.ok) {
    log(`      FAILED: ${fetched.detail.last}`);
  } else {
    log(`      ${fetched.value}`);
    if (!String(fetched.value).includes("kind=jpeg") &&
        !String(fetched.value).includes("kind=png")) {
      log("      ⚠ these are not image bytes - the host returned something else");
    }
  }

  // 2. vision, text mode
  log("\n[2/3] describe_text - exec_prompt(images=[...]) default format");
  const asText = await callMethod(client, address, "describe_text", [IMAGE]);
  log(asText.ok ? `      model saw: ${asText.value}` : `      FAILED: ${asText.detail.last}`);

  // 3. vision, json mode
  log("\n[3/3] describe_json - exec_prompt(images=[...], response_format='json')");
  const asJson = await callMethod(client, address, "describe_json", [IMAGE]);
  log(asJson.ok ? `      model saw: ${asJson.value}` : `      FAILED: ${asJson.detail.last}`);

  log("\n" + "=".repeat(62));
  log(`  fetch          ${fetched.ok ? "ok" : "FAILED"}`);
  log(`  vision text    ${asText.ok ? "ok" : "FAILED"}`);
  log(`  vision json    ${asJson.ok ? "ok" : "FAILED"}`);
  log("=".repeat(62));
  log(`  probe address  ${address}`);

  if (asText.ok || asJson.ok) {
    log("\n✓ image input works on this network.");
    if (!asJson.ok) {
      log("  but response_format='json' does NOT work with images - ");
      log("  fieldwork.py must use text mode and parse the reply itself.");
    }
  } else {
    log("\n✗ image input does not work on this network.");
    log("  Neither format succeeded. Check whether the configured model");
    log("  supports vision at all.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
