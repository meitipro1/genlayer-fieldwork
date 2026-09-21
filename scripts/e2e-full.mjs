/**
 * The whole product, on a real chain, with real photographs.
 *
 *   node scripts/e2e-full.mjs
 *
 * Deploys a fresh contract and drives the complete loop:
 *
 *   1. generate a before photograph        (no code in it - none exists yet)
 *   2. upload it to IPFS
 *   3. post_task, funded                   -> the poster's frame is vetted here
 *   4. claim                               -> the contract issues the code
 *   5. generate an after photograph carrying THAT code
 *   6. upload it
 *   7. submit                              -> vision grading, verdict, payment
 *
 * Step 5 is why scripts/e2e.mjs stops at step 4: the code does not exist until
 * the claim lands, so the after frame cannot be prepared in advance. Drawing it
 * on demand is what makes the rest of the loop testable without a person
 * holding a piece of paper.
 *
 * Needs PINATA_JWT (read from .env.local) and python with Pillow.
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
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const RPC = studionet.rpcUrls.default.http[0];
const GEN = (n) => BigInt(n) * BigInt(10) ** BigInt(18);
const log = (...a) => console.log(...a);

let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) failures++;
  log(`  [${ok ? "ok  " : "FAIL"}] ${label}${detail ? "  - " + detail : ""}`);
}

// ---------------------------------------------------------------- env
const env = {};
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    env[line.slice(0, line.indexOf("=")).trim()] = line
      .slice(line.indexOf("=") + 1)
      .trim();
  }
}
const PINATA_JWT = process.env.PINATA_JWT || env.PINATA_JWT || "";
const GATEWAY = process.env.CAS_GATEWAY || env.CAS_GATEWAY || "https://gateway.pinata.cloud";

/**
 * Without a storage credential the loop still runs, on photographs already
 * pinned, and turns into a different but still useful test.
 *
 * The after frame here is deliberately a JPEG with no JFIF header (magic
 * `ffd8ffdb`). Pillow reads it fine and the vision model refuses it with
 * `INVALID_IMAGE` - which used to abort the whole transaction and leave the
 * task stuck as `claimed` with no reason for the worker. So this path is the
 * regression test for that: the run must end in a clean `rejected` with advice,
 * never in a crash.
 *
 * With PINATA_JWT set it becomes the real thing instead: a fresh before frame,
 * an after frame carrying the code this claim issued, and a `paid` verdict.
 */
const CAN_UPLOAD = PINATA_JWT !== "";
const PINNED = {
  before: `${GATEWAY}/ipfs/QmPiuq2ec8CRuVLXidgNYbx8VYRhhv8uBobHKQB6BvBU8Y`,
  after: `${GATEWAY}/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi`,
};

// ---------------------------------------------------------------- helpers
/**
 * Studio drops TLS connections often - `eth_sendRawTransaction` comes back as
 * `fetch failed` / `ECONNRESET` roughly one call in three. Nothing is submitted
 * when that happens, so retrying cannot double a transaction, and ten attempts
 * is the difference between a script that works and one that fails half the
 * time for no reason. Every call to the chain goes through here.
 */
async function retry(fn, label, n = 10) {
  let wait = 2500;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = String(e?.message ?? e);
      if (i >= n) throw e;
      log(`    (${label} attempt ${i}: ${m.split("\n")[0].slice(0, 54)}, retrying)`);
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(Math.round(wait * 1.7), 30000);
    }
  }
}

async function rpc(method, params) {
  return retry(async () => {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    return r.json();
  }, method);
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

/**
 * Only `execution_result` says whether the contract's own code succeeded.
 *
 * Read the round the leader actually ran rather than round 0: later rounds are
 * validators, and one that reports `Validator execution cancelled after quorum`
 * is normal rather than a failure. `result` carries the refusal sentence as
 * base64 with a one byte tag, and only on ERROR - decoding it on a success
 * prints mojibake, which is a misleading way to report a working call.
 */
function verdict(receipt) {
  const lr =
    receipt?.consensus_data?.leader_receipt ?? receipt?.consensusData?.leaderReceipt;
  const rounds = Array.isArray(lr) ? lr : lr ? [lr] : [];
  const leader =
    rounds.find((r) => (r.mode ?? "").toLowerCase() === "leader") ?? rounds[0] ?? {};
  const exec = String(leader.execution_result ?? leader.executionResult ?? "");
  const ok = exec.toUpperCase() === "SUCCESS";
  let msg = "";
  if (!ok) {
    try {
      msg = Buffer.from(String(leader.result ?? ""), "base64")
        .toString("utf8")
        .slice(1)
        .replace(/[^\x20-\x7e]+/g, " ")
        .trim();
    } catch {
      msg = "";
    }
    const se = String((leader.genvm_result ?? {}).stderr ?? "").trim();
    if (se) msg = (msg ? msg + " | " : "") + se.split("\n").slice(-3).join(" ");
  }
  return { ok, exec, msg, rounds };
}

function dumpRounds(rounds) {
  rounds.forEach((r, i) => {
    log(`    round ${i}  mode=${r.mode ?? "?"}  vote=${r.vote ?? "-"}  exec=${r.execution_result}`);
    const se = String((r.genvm_result ?? {}).stderr ?? "").trim();
    if (se) log(`      stderr: ${se.split("\n").slice(-4).join(" / ").slice(0, 300)}`);
    if (r.eq_outputs) {
      for (const [k, v] of Object.entries(r.eq_outputs)) {
        const text = Buffer.from(String(v), "base64")
          .toString("utf8")
          .replace(/[^\x20-\x7e]+/g, " ")
          .trim();
        log(`      eq[${k}]: ${text.slice(0, 280)}`);
      }
    }
  });
}

async function upload(path, name) {
  const bytes = readFileSync(path);
  const form = new FormData();
  form.append("file", new Blob([bytes]), name);
  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: form,
  });
  if (!res.ok) throw new Error(`pinata ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const { IpfsHash } = await res.json();
  return `${GATEWAY}/ipfs/${IpfsHash}`;
}

function drawPhotos(code) {
  execFileSync("python", ["scripts/make_test_photos.py", code], {
    stdio: "pipe",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  return {
    before: `docs/test-photos/before-${code}.jpg`,
    after: `docs/test-photos/after-${code}.jpg`,
  };
}

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

// ---------------------------------------------------------------- run
const poster = createAccount();
const worker = createAccount();
const asPoster = createClient({ chain: studionet, account: poster });
const asWorker = createClient({ chain: studionet, account: worker });

log(`network  ${studionet.name} (${studionet.id})`);
log(`poster   ${poster.address}`);
log(`worker   ${worker.address}\n`);

for (const a of [poster.address, worker.address]) {
  await rpc("sim_fundAccount", [a, 5000]);
}
await new Promise((r) => setTimeout(r, 4000));

// ---- 1 + 2: the poster's frame -------------------------------------------
log(
  CAN_UPLOAD
    ? "1. draw and upload the before photograph"
    : "1. no PINATA_JWT, so using photographs that are already pinned"
);
let beforeUrl;
if (CAN_UPLOAD) {
  // A placeholder code only names the files; the before frame carries no code.
  const seed = drawPhotos("SEED00");
  beforeUrl = await upload(seed.before, "before.jpg");
} else {
  beforeUrl = PINNED.before;
  log("   the after frame is a JPEG the model cannot read, so expect a clean rejection");
}
check(true, "before frame ready", beforeUrl.slice(-14));

// ---- 3: post -------------------------------------------------------------
log("\n2. post_task");
const code0 = readFileSync("contracts/fieldwork.py");
const dh = await retry(
  () => asPoster.deployContract({ code: code0, args: [0], leaderOnly: false }),
  "deploy"
);
const dr = await retry(
  () =>
    asPoster.waitForTransactionReceipt({
      hash: dh,
      status: TransactionStatus.FINALIZED,
      retries: 300,
      interval: 4000,
    }),
  "deploy receipt"
);
const address = dr?.data?.contract_address ?? dr?.contract_address;
log(`   contract ${address}`);

const ph = await retry(
  () =>
    asPoster.writeContract({
      address,
      functionName: "post_task",
      args: [
        TASK.title,
        TASK.place,
        TASK.test,
        TASK.pass,
        TASK.fail,
        beforeUrl,
        51505100,
        -122600,
        GEN(18),
        0,
        CAN_UPLOAD ? "" : "TEST42",
        0,
        // open_minutes: no deadline, so this run exercises the same lifecycle
        // it always did. The deadline path has coverage of its own.
        0,
      ],
      value: GEN(18),
    }),
  "post_task"
);
const pr = await retry(
  () =>
    asPoster.waitForTransactionReceipt({
      hash: ph,
      status: TransactionStatus.FINALIZED,
      retries: 300,
      interval: 4000,
    }),
  "post receipt"
);
const pv = verdict(pr);
check(pv.ok, "task posted and funded", pv.ok ? "" : pv.msg || pv.exec);
if (!pv.ok) process.exit(1);

const taskId =
  Number(
    await retry(
      () => asPoster.readContract({ address, functionName: "total_tasks", args: [] }),
      "total_tasks"
    )
  ) - 1;
check(taskId >= 0, `task id ${taskId}`);

// ---- 4: claim ------------------------------------------------------------
log("\n3. claim, as a different account");
const ch = await retry(
  () => asWorker.writeContract({ address, functionName: "claim", args: [taskId] }),
  "claim"
);
const cr = await retry(
  () =>
    asWorker.waitForTransactionReceipt({
      hash: ch,
      status: TransactionStatus.FINALIZED,
      retries: 300,
      interval: 4000,
    }),
  "claim receipt"
);
const cv = verdict(cr);
check(cv.ok, "claim accepted", cv.ok ? "" : cv.msg || cv.exec);
if (!cv.ok) process.exit(1);

const challenge = String(
  await retry(
    () =>
      asWorker.readContract({ address, functionName: "challenge_code_of", args: [taskId] }),
    "challenge_code_of"
  )
);
check(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/.test(challenge), `code issued: ${challenge}`);

// ---- 5 + 6: the worker's frame, carrying that code -----------------------
log(
  CAN_UPLOAD
    ? "\n4. draw the after photograph with the issued code, and upload it"
    : "\n4. using a pinned photograph as the after frame"
);
let afterUrl;
if (CAN_UPLOAD) {
  const shot = drawPhotos(challenge);
  afterUrl = await upload(shot.after, "after.jpg");
} else {
  afterUrl = PINNED.after;
}
check(true, "after frame ready", afterUrl.slice(-14));

// ---- 7: submit -----------------------------------------------------------
log("\n5. submit for settlement");
const sh = await retry(
  () =>
    asWorker.writeContract({
      address,
      functionName: "submit",
      args: [taskId, afterUrl],
    }),
  "submit"
);
const sr = await retry(
  () =>
    asWorker.waitForTransactionReceipt({
      hash: sh,
      status: TransactionStatus.FINALIZED,
      retries: 400,
      interval: 4000,
    }),
  "submit receipt"
);
log(`   tx ${sh}`);
const sv = verdict(sr);
check(sv.ok, "submit ran without refusing", sv.ok ? "" : sv.msg || sv.exec);
if (!sv.ok) {
  log("\n   what each round did:");
  dumpRounds(sv.rounds);
  log(`\n   node scripts/explain-tx.mjs ${sh}`);
}

const status = String(
  await retry(
    () => asWorker.readContract({ address, functionName: "status_of", args: [taskId] }),
    "status_of"
  )
);
const reason = String(
  await retry(
    () => asWorker.readContract({ address, functionName: "reason_of", args: [taskId] }),
    "reason_of"
  )
);
const hash = String(
  await retry(
    () =>
      asWorker.readContract({ address, functionName: "content_hash_of", args: [taskId] }),
    "content_hash_of"
  )
);

log(`\n   status  ${status}`);
log(`   reason  ${reason}`);
log(`   hash    ${hash || "(none)"}`);

check(
  status === "paid" || status === "rejected",
  `the contract reached a verdict (${status})`
);
check(reason.trim() !== "", "the worker was given a reason");

if (status === "paid") {
  check(hash.length === 64, "the after photograph's content hash was recorded");
  const rep = Number(
    await retry(
      () =>
        asWorker.readContract({
          address,
          functionName: "reputation_of",
          args: [worker.address],
        }),
      "reputation_of"
    )
  );
  check(rep === 1, `the worker's reputation went to ${rep}`);
} else {
  // A rejection must not cost the claim: the worker retakes and tries again
  // inside the same ninety minutes.
  const still = String(
    await retry(
      () => asWorker.readContract({ address, functionName: "claimed_by", args: [taskId] }),
      "claimed_by"
    )
  );
  check(
    still.toLowerCase() === worker.address.toLowerCase(),
    "the claim survived the rejection, so the worker can retake"
  );
  if (!CAN_UPLOAD) {
    check(
      /re-save|standard JPEG|could not read|variant/i.test(reason),
      "an unreadable image became a clean rejection, not a crashed transaction",
      reason.slice(0, 70)
    );
  }
}

log(`\ncontract ${address}  task ${taskId}`);
log(failures === 0 ? "\nthe whole loop works" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
