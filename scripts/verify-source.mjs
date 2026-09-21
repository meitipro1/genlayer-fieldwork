/* Compare the deployed contract with the repository, byte for byte.
 *
 *     npm run verify-source             # the address in .env.local
 *     npm run verify-source -- 0x...    # any other address
 *
 * The deployment is the submission. A reviewer fetches the source the chain is
 * actually running, diffs it against this repository and lints those bytes, so
 * a repository that is correct on its own counts for nothing if the address on
 * the listing runs something else. This is that check, run before submitting
 * rather than learned from a rejection.
 *
 * Both sides are compared as LF. A Windows checkout carries CRLF, and a raw
 * comparison would call every correct deployment a mismatch on any machine that
 * is not the one it was deployed from.
 */

import dns from "node:dns";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { studionet } from "genlayer-js/chains";

dns.setDefaultResultOrder("ipv4first");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const lf = (text) => text.split(CR + LF).join(LF);

function addressFromEnv() {
  const file = join(ROOT, ".env.local");
  if (!existsSync(file)) return "";
  for (const line of readFileSync(file, "utf8").split(LF)) {
    const m = /^NEXT_PUBLIC_FIELDWORK_CONTRACT\s*=\s*(0x[0-9a-fA-F]{40})/.exec(line.trim());
    if (m) return m[1];
  }
  return "";
}

// Exactly as given. Studio reads a lowercased address as "contract not found".
const address = process.argv[2] || addressFromEnv();
if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
  console.log("no contract address - pass one, or set NEXT_PUBLIC_FIELDWORK_CONTRACT in .env.local");
  process.exit(2);
}

const rpc = studionet.rpcUrls.default.http[0];

async function deployedSource() {
  // Reads are idempotent, so retrying costs nothing. Without it one dropped
  // connection reports a mismatch on a deployment that is fine, and a gate that
  // cries wolf is a gate that gets ignored.
  let wait = 1500;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "gen_getContractCode",
          params: [address],
        }),
      });
      const json = await res.json();
      if (json.result) return Buffer.from(json.result, "base64").toString("utf8");
      throw new Error(JSON.stringify(json.error || json).slice(0, 200));
    } catch (e) {
      if (attempt >= 6) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}

function firstDifference(a, b) {
  const la = a.split(LF);
  const lb = b.split(LF);
  const n = Math.min(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return { line: i + 1, repo: la[i], chain: lb[i] };
  }
  return {
    line: n + 1,
    repo: la[n] ?? "(end of file)",
    chain: lb[n] ?? "(end of file)",
  };
}

const rawChain = await deployedSource();
const chain = lf(rawChain);
const head = lf(
  execFileSync("git", ["show", "HEAD:contracts/fieldwork.py"], { cwd: ROOT }).toString("utf8")
);
const work = lf(readFileSync(join(ROOT, "contracts", "fieldwork.py"), "utf8"));

console.log(`contract ${address}`);
console.log(`  on chain    ${Buffer.byteLength(chain)} bytes`);
console.log(`  repository  ${Buffer.byteLength(head)} bytes at HEAD`);

let ok = false;
if (chain === head && rawChain === head) {
  ok = true;
  console.log("\n  MATCH - the chain runs exactly what the repository holds");
} else if (chain === head) {
  // The rules are identical, but the deployment carries carriage returns that
  // no clone has, so nobody else can reproduce this comparison byte for byte.
  console.log(
    "\n  LINE ENDINGS ONLY - the rules match, but the deployment carries CR bytes no clone of the repository has. Redeploy from a normalised source."
  );
} else {
  const d = firstDifference(head, chain);
  console.log("\n  DIFFERENT SOURCE - this address does not run the repository's contract");
  console.log(`  first difference at line ${d.line}`);
  console.log(`    repository: ${String(d.repo).slice(0, 110)}`);
  console.log(`    on chain:   ${String(d.chain).slice(0, 110)}`);
}

if (work !== head) {
  console.log(
    "\n  note: the working copy differs from HEAD - this compared what is committed, which is what a push would publish"
  );
}

console.log(
  "\nnot proven here: that the deployed bytes pass genvm-lint (on a MATCH they are the same bytes as contracts/fieldwork.py, so lint that file), and that this is the address on the Explorer listing, which only the listing can show."
);
process.exit(ok ? 0 : 1);
