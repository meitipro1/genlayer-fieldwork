/**
 * Repo guard: the checks that are easy to break and boring to remember.
 *
 *   npm run check
 *
 * Exists because "I will remember the rule" does not work. Every item here is
 * something that has actually shipped broken in this project at least once.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOT = process.cwd();

// Built from escape sequences on purpose. Written as literal characters, this
// file's own source would contain them and the checker would report itself on
// every clean run, which is how a check becomes noise people skip.
const DASHES = new RegExp("[\\u2014\\u2013]", "g");
const ENTITY = new RegExp("&" + "mdash;|&" + "ndash;", "g");

// `.example` is in here because it was not, and `.env.example` shipped with two
// em dashes in it for weeks. Anything a person reads counts, whatever it is
// named.
const SOURCE_EXT = new Set([
  ".ts",
  ".tsx",
  ".css",
  ".py",
  ".mjs",
  ".js",
  ".md",
  ".txt",
  ".json",
  ".example",
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "test-photos",
  "__pycache__",
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

let failures = 0;
const note = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`  [${ok ? "ok  " : "FAIL"}] ${label}${detail ? "  " + detail : ""}`);
};

// ---------------------------------------------------------------- house style
console.log("house style");
{
  const hits = [];
  for (const file of walk(ROOT)) {
    if (!SOURCE_EXT.has(extname(file))) continue;
    if (relative(ROOT, file).replace(/\\/g, "/") === "scripts/check.mjs") continue;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const n =
      (text.match(DASHES) || []).length + (text.match(ENTITY) || []).length;
    if (n > 0) hits.push(`${relative(ROOT, file)} (${n})`);
  }
  note(
    hits.length === 0,
    "no em or en dashes in sources",
    hits.length ? "\n         " + hits.join("\n         ") : ""
  );
}

// The source scan is not enough on its own. An entity only becomes a dash once
// rendered, so the built output is the check that actually counts.
{
  const outDir = join(ROOT, ".next", "server", "app");
  if (!existsSync(outDir)) {
    console.log("  [skip] build output not scanned (run npm run build first)");
  } else {
    const hits = [];
    for (const file of walk(outDir)) {
      if (![".js", ".html", ".rsc", ".json"].includes(extname(file))) continue;
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const n = (text.match(DASHES) || []).length;
      if (n > 0) hits.push(`${relative(ROOT, file)} (${n})`);
    }
    note(
      hits.length === 0,
      "no dashes in the built output either",
      hits.length ? "\n         " + hits.join("\n         ") : ""
    );
  }
}

// ------------------------------------------------------------- contract shape
console.log("\ncontract");
{
  const src = readFileSync(join(ROOT, "contracts", "fieldwork.py"), "utf8");

  note(
    /^# \{ "Depends": "py-genlayer:[a-z0-9]+" \}/m.test(src),
    "pins a concrete runner version"
  );

  // Every field on the Task dataclass has to be set where a Task is built, or
  // the constructor throws at runtime and nothing catches it until a deploy.
  const body = src.slice(src.indexOf("class Task:"), src.indexOf("class Contract"));
  const fields = [...body.matchAll(/^    (\w+):\s/gm)].map((m) => m[1]);
  const ctor = src.slice(src.indexOf("self.tasks.append("));
  const missing = fields.filter((f) => !ctor.includes(`${f}=`));
  note(
    missing.length === 0,
    `all ${fields.length} Task fields are set on construction`,
    missing.length ? `missing: ${missing.join(", ")}` : ""
  );

  // task_json is what the whole site reads, so a field that never reaches it is
  // invisible however well it is stored.
  const json = src.slice(src.indexOf("def task_json"), src.indexOf("def title_of"));
  const unexposed = fields.filter((f) => !json.includes(`"${f}"`));
  note(
    unexposed.length === 0,
    "every Task field is exposed on task_json",
    unexposed.length ? `missing: ${unexposed.join(", ")}` : ""
  );

  // ---- the deadline invariants ----
  //
  // Five ways to reintroduce a money bug that a review of this feature turned
  // up independently, each cheap to check and expensive to find later.

  // "" is the no-deadline sentinel and every real stamp sorts above it, so a
  // bare comparison reads every deadline-free task as long expired and lets a
  // stranger hand its reward back. Only _past_deadline may compare the field.
  // Prose out, code only. Both of these invariants are explained in the very
  // docstrings that describe the mistake, so a check that reads the comments
  // fails on its own documentation.
  const code = src
    .replace(/"""[\s\S]*?"""/g, '""')
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  const bareCompare = [...code.matchAll(/^(?!.*!= "").*[<>]=?\s*t\.open_until/gm)]
    .map((m) => m[0].trim())
    .filter((l) => !l.includes("_past_deadline"));
  note(
    bareCompare.length === 0,
    "no deadline comparison skips the empty sentinel",
    bareCompare.length ? `unguarded: ${bareCompare[0]}` : ""
  );

  const expireBody = (code.split("def expire_task")[1] || "").split("@gl.public")[0];
  note(
    expireBody.includes('if t.status != "open"'),
    "expire_task guards on a positive allow-list, not a denylist"
  );
  note(
    expireBody.indexOf('t.status = "expired"') > 0 &&
      expireBody.indexOf('t.status = "expired"') < expireBody.indexOf("self._pay("),
    "expire_task writes the terminal status before it pays"
  );
  // The fee is banked on a payout or handed back on a withdrawal, never both.
  // Accruing it here too would leave the owner owed money the contract does
  // not hold, and withdraw_fees has no balance check to catch it.
  note(
    !expireBody.includes("fees_accrued"),
    "expire_task leaves the accrued fees alone"
  );
  // The fee floors to zero at fee_bps 0, which is the deployed configuration,
  // and _pay refuses a zero transfer - so two calls would revert the whole
  // transaction and lock the reward it had just released.
  note(
    (expireBody.match(/self\._pay\(/g) || []).length === 1,
    "expire_task refunds in one summed transfer, not two"
  );
  // open_until belongs to the task, not to an attempt. Clearing it here reads
  // like tidiness and puts the task back in the pool immortal.
  const poolBody = (code.split("def _return_to_pool")[1] || "").split("\n    def ")[0];
  note(
    !poolBody.includes("open_until"),
    "returning a task to the pool never clears its deadline"
  );

  // ---- the browser's copy of the pre-flight limits ----
  //
  // lib/precheck.ts runs the contract's exposure gate in the browser, because
  // the contract cannot: the Pillow build inside GenVM has no JPEG decoder, so
  // _preflight skips the measurement on every JPEG, and this site uploads
  // nothing else. That only stays honest while the two sets of numbers agree.
  // If they drift, the browser warns a worker about a photograph the chain
  // would have accepted, which is the one failure this feature must not have.
  const limits = readFileSync(join(ROOT, "lib", "limits.ts"), "utf8");
  const drifted = [];
  for (const name of ["MIN_EDGE", "DARK_MEAN", "BRIGHT_MEAN"]) {
    const inPy = new RegExp(`^${name}\\s*=\\s*(\\d+)`, "m").exec(src);
    const inTs = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(limits);
    if (!inPy || !inTs) drifted.push(`${name} not found`);
    else if (inPy[1] !== inTs[1]) drifted.push(`${name}: py ${inPy[1]} vs ts ${inTs[1]}`);
  }
  note(
    drifted.length === 0,
    "the browser's pre-flight limits match the contract's",
    drifted.join(", ")
  );
}

// ------------------------------------------------------------------ frontend
console.log("\nfrontend");
{
  const onchain = readFileSync(join(ROOT, "lib", "onchain.ts"), "utf8");

  note(
    !/codeVisible:\s*true/.test(onchain),
    "the verdict is read from the chain, not hard coded"
  );

  const genlayer = readFileSync(join(ROOT, "lib", "genlayer.ts"), "utf8");
  const writes = [...genlayer.matchAll(/export async function (\w+)/g)].map(
    (m) => m[1]
  );
  const guarded = (genlayer.match(/assertExecuted\(/g) || []).length - 1;
  note(
    guarded >= 5,
    `every write asserts execution_result (${guarded} call sites)`,
    `writes: ${writes.join(", ")}`
  );

  // A refused call finalizes perfectly well, so status alone means nothing.
  note(
    /consensus_data\?\.leader_receipt/.test(genlayer),
    "reads the leader receipt rather than trusting status"
  );

  // A url off the chain can be absent on any task the contract refused before
  // recording it, and `<img src={undefined}>` is a broken image on a page whose
  // whole job is to be trustworthy evidence.
  const unguarded = [];
  for (const file of walk(join(ROOT, "app")).concat(walk(join(ROOT, "components")))) {
    if (extname(file) !== ".tsx") continue;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const m = /src=\{(\w+)\.(beforeUrl|afterUrl)\}/.exec(line);
      if (!m) return;
      // Guarded either by a ternary above, or by being handed to a component
      // that does the checking. The window has to cover a whole JSX element,
      // style object and all: at six lines this reported a guard that sits
      // fifteen lines up, and a check that cries wolf gets ignored.
      const context = lines.slice(Math.max(0, i - 24), i + 1).join("\n");
      if (new RegExp(`${m[1]}\\.${m[2]}\\s*\\?`).test(context)) return;
      if (/<Frame\b/.test(context)) return;
      unguarded.push(`${relative(ROOT, file)}:${i + 1}`);
    });
  }
  // Heuristic, not a parser: it looks backwards for a guard on the same field
  // rather than tracking JSX scope. It will miss a second unguarded image
  // sitting just below a guarded one. Good enough to catch the mistake that
  // actually happened, and cheap enough to keep.
  note(
    unguarded.length === 0,
    "every photograph is rendered behind a presence check",
    unguarded.length ? unguarded.join(", ") : ""
  );
}

// -------------------------------------------------------------------- scripts
console.log("\nscripts");
{
  const files = readdirSync(join(ROOT, "scripts")).filter((f) => f.endsWith(".mjs"));
  const unguarded = files.filter((f) => {
    const text = readFileSync(join(ROOT, "scripts", f), "utf8");
    const talksToChain = /genlayer-js|rpcUrls|fetch\(RPC/.test(text);
    return talksToChain && !text.includes("setDefaultResultOrder");
  });
  note(
    unguarded.length === 0,
    "every chain-facing script forces IPv4 first",
    unguarded.length ? `missing: ${unguarded.join(", ")}` : ""
  );

  const next = readFileSync(join(ROOT, "next.config.mjs"), "utf8");
  note(
    next.includes("setDefaultResultOrder"),
    "the Next server forces IPv4 first too"
  );
}

// -------------------------------------------------------------------- colour
//
// A theme that fails WCAG AA on its muted grey or on the accent is invisible
// when you eyeball a mockup, and it has shipped that way before. This reads the
// tokens straight out of globals.css and checks the pairings that carry text.
console.log("\ncolour");
{
  const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

  const tokensFor = (selector) => {
    const at = css.indexOf(selector);
    const block = css.slice(at, css.indexOf("}", at));
    const out = {};
    for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) {
      out[name] = value;
    }
    return out;
  };

  const luminance = (hex) => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255);
    const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  const SURFACES = ["bg", "panel", "panel2", "foot"];
  const FOREGROUNDS = ["ink", "dim", "muted", "accent", "danger"];
  const AA = 4.5;

  for (const [label, selector] of [
    ["dark", ':root[data-fw="dark"]'],
    ["light", ':root[data-fw="light"]'],
  ]) {
    const t = tokensFor(selector);
    let worst = { pair: "none", value: Infinity };
    for (const fg of FOREGROUNDS) {
      for (const bg of SURFACES) {
        if (!t[fg] || !t[bg]) continue;
        const r = ratio(t[fg], t[bg]);
        if (r < worst.value) worst = { pair: `${fg} on ${bg}`, value: r };
      }
    }
    // The accent is a fill as well as a colour, with accent-ink written on it.
    if (t.accent && t["accent-ink"]) {
      const r = ratio(t["accent-ink"], t.accent);
      if (r < worst.value) worst = { pair: "accent-ink on accent", value: r };
    }

    note(
      worst.value >= AA,
      `${label} theme clears WCAG AA`,
      `worst is ${worst.pair} at ${worst.value.toFixed(2)}`
    );
  }
}

// ----------------------------------------------------------------- deployment
console.log("\ndeployment");
{
  const next = readFileSync(join(ROOT, "next.config.mjs"), "utf8");
  note(
    next.includes("outputFileTracingIncludes") &&
      next.includes("contracts/fieldwork.py"),
    "the contract source is traced into the serverless bundle"
  );
  note(
    existsSync(join(ROOT, ".env.local")) || true,
    "env is a deploy-time concern, not checked here"
  );
}

console.log(
  failures === 0 ? "\nall checks passed" : `\n${failures} FAILURES`
);
process.exit(failures === 0 ? 0 : 1);
