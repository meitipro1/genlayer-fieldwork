/**
 * Explain one transaction: did the contract's code actually succeed, and if not
 * what sentence did it refuse with.
 *
 *   node scripts/explain-tx.mjs 0x<hash>
 *
 * Exists because three fields on a GenLayer receipt look like a verdict and only
 * one is. `status` is the transaction's state and `result` is the consensus
 * outcome; both read as success on a call the contract refused outright. The
 * answer is `consensus_data.leader_receipt[i].execution_result`, and the
 * refusal sentence is plain text in `leader_receipt[i].result.payload`.
 */

import dns from "node:dns";

// Studio sits behind Cloudflare on both stacks and its AAAA addresses time out.
// Node tries IPv6 first, so every request burns ~10s and then reports a bare
// "fetch failed" that looks like the chain is down. This must run before any
// client is created, in every entry point that talks to the RPC.
dns.setDefaultResultOrder("ipv4first");

import { studionet, testnetBradbury } from "genlayer-js/chains";

const NETWORK = process.env.GENLAYER_NETWORK || "studionet";
const chain = NETWORK === "bradbury" ? testnetBradbury : studionet;
const RPC = chain.rpcUrls.default.http[0];

const HASH = process.argv[2];
if (!HASH) {
  console.error("usage: node scripts/explain-tx.mjs 0x<hash>");
  process.exit(1);
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  return res.json();
}

const out = await rpc("eth_getTransactionByHash", [HASH]);
const tx = out?.result;

if (!tx) {
  console.log("no transaction under that hash on", NETWORK);
  console.log(JSON.stringify(out, null, 2).slice(0, 800));
  process.exit(1);
}

const line = (k, v) => console.log(`  ${String(k).padEnd(22)} ${v}`);

console.log(`\nnetwork   ${chain.name} (${chain.id})`);
console.log(`hash      ${HASH}\n`);

console.log("transaction");
line("from", tx.from_address ?? tx.from);
line("to", tx.to_address ?? tx.to);
line("type", tx.type);
line("value", tx.value);
line("status", `${tx.status} ${tx.status_name ? `(${tx.status_name})` : ""}`);
if (tx.consensus_data?.leader_receipt) {
  line(
    "consensus result",
    `${tx.result ?? "-"} ${tx.result_name ? `(${tx.result_name})` : ""}`
  );
}

/**
 * What was actually called.
 *
 * `data.calldata` is a base64 GenVM calldata blob. genlayer-js exports
 * `decodeInputData`, but that one expects hex RLP and throws "Invalid byte
 * sequence" on this - wrong transport, not a corrupt transaction. Rather than
 * reimplement the format, pull the readable parts out: the method name is the
 * last string in the blob, tagged `method`, and the arguments are the printable
 * runs before it. Enough to see which overload was called and with how many
 * arguments, which is the whole question when a call is refused for arity.
 */
function readCalldata(b64) {
  const bytes = Buffer.from(b64, "base64");
  const text = bytes.toString("latin1");

  const runs = [];
  let cur = "";
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e) cur += ch;
    else {
      if (cur.length >= 3) runs.push(cur);
      cur = "";
    }
  }
  if (cur.length >= 3) runs.push(cur);

  // The tail reads "...\x06methodLpost_task": the name follows the marker,
  // past a single length byte.
  let method = null;
  const m = /method.(\w+)$/.exec(runs[runs.length - 1] ?? "");
  if (m) {
    method = m[1];
    runs[runs.length - 1] = runs[runs.length - 1].replace(/.?method.\w+$/, "");
  }
  return { method, runs: runs.filter((r) => r && r !== "args") };
}

const data = tx.data ?? {};
if (data.calldata) {
  console.log("\ncall");
  const { method, runs } = readCalldata(data.calldata);
  line("method", method ?? "(could not read)");
  line("readable args", runs.length);
  runs.forEach((a, i) =>
    line(`  ${i}`, a.length > 84 ? a.slice(0, 84) + "..." : a)
  );
} else if (data.contract_code) {
  console.log("\ncall");
  line("method", "(deploy)");
}

const lr = tx.consensus_data?.leader_receipt ?? tx.consensusData?.leaderReceipt;
const rounds = Array.isArray(lr) ? lr : lr ? [lr] : [];

if (rounds.length === 0) {
  console.log("\nno leader receipt yet - the transaction has not been executed");
  process.exit(0);
}

console.log(`\nleader receipt (${rounds.length} round${rounds.length === 1 ? "" : "s"})`);

/**
 * The refusal sentence, wherever this build happens to put it.
 *
 * Studio sends `result` as a **base64 string** with a one byte tag in front, so
 * `result.payload` is undefined and reading it silently prints nothing - which
 * looks exactly like a transaction that failed for no reason. Other builds send
 * `{status, payload}`. Handle both, and strip the tag byte.
 */
function refusalOf(r) {
  const res = r.result;
  if (!res) return "";
  if (typeof res === "object") return String(res.payload ?? res.data ?? "");
  try {
    const text = Buffer.from(String(res), "base64").toString("utf8");
    // Drop the leading tag byte, then anything else unprintable.
    return text
      .slice(1)
      .replace(/[^\x20-\x7e\n]/g, "")
      .trim();
  } catch {
    return "";
  }
}

rounds.forEach((r, i) => {
  const exec = r.execution_result ?? r.executionResult;
  console.log(`\n  round ${i}`);
  line("execution_result", exec);
  line("mode / vote", `${r.mode ?? "?"} / ${r.vote ?? "-"}`);
  {
    const payload = refusalOf(r);
    if (payload) {
      console.log("\n  refusal:");
      payload.split("\n").forEach((l) => console.log("    " + l));
    }
    // The nondet block's own return value, which carries the grader's verdict.
    if (r.eq_outputs) {
      for (const [k, v] of Object.entries(r.eq_outputs)) {
        const text = Buffer.from(String(v), "base64")
          .toString("utf8")
          .replace(/[^\x20-\x7e]+/g, " ")
          .trim();
        if (text) console.log(`\n  nondet output [${k}]:\n    ${text.slice(0, 600)}`);
      }
    }
  }
  const stderr = (r.genvm_result ?? r.genvmResult ?? {}).stderr ?? "";
  if (String(stderr).trim()) {
    console.log("\n  stderr:");
    String(stderr)
      .trim()
      .split("\n")
      .slice(-24)
      .forEach((l) => console.log("    " + l));
  }
  const stdout = (r.genvm_result ?? r.genvmResult ?? {}).stdout ?? "";
  if (String(stdout).trim()) {
    console.log("\n  stdout:");
    String(stdout).trim().split("\n").slice(-12).forEach((l) => console.log("    " + l));
  }
});

const votes = tx.consensus_data?.votes ?? {};
if (Object.keys(votes).length) {
  console.log("\nvotes");
  for (const [addr, v] of Object.entries(votes)) line(addr.slice(0, 10) + "...", v);
}

const exec0 = rounds[rounds.length - 1].execution_result;
console.log(
  `\n=> ${
    String(exec0).toUpperCase() === "SUCCESS"
      ? "the contract's code SUCCEEDED"
      : "the contract REFUSED this call - the sentence above is why"
  }\n`
);
