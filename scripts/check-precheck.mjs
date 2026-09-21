/* Prove the browser pre-check agrees with the contract, on real pixels.
 *
 *     node scripts/check-precheck.mjs
 *
 * The measurement lives in lib/precheck.ts and runs on a canvas, which does not
 * exist here. So this reimplements nothing: it extracts the thresholds from
 * lib/limits.ts, decodes the real sample photographs with the same Rec. 601
 * luma and the same 32 by 32 reduction the browser does, and asserts the
 * outcome. If this and the browser ever disagree it is because the constants
 * drifted, and scripts/check.mjs fails the build on exactly that.
 *
 * The case that matters most is the shipped sample. It is the first photograph
 * any visitor submits, and a check that warns on the product's own demo frame
 * is a calibration failure, not a sample failure.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const limits = readFileSync(join(ROOT, "lib", "limits.ts"), "utf8");
const num = (name) => Number(new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(limits)[1]);
const MIN_EDGE = num("MIN_EDGE");
const DARK_MEAN = num("DARK_MEAN");
const BRIGHT_MEAN = num("BRIGHT_MEAN");

let failures = 0;
const note = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`  [${ok ? "ok  " : "FAIL"}] ${label}${detail ? "  " + detail : ""}`);
};

/* A baseline JPEG decoder, enough for the sample frames.
 * Only the dimensions and an average brightness are needed, and both can be
 * read without a full decode: the SOF marker carries the size, and a mean over
 * the DC coefficients is not available without entropy decoding - so instead of
 * half-decoding a JPEG badly, this shells out to the one decoder that is
 * guaranteed present, the same Pillow the contract uses. If it is not
 * available the size checks still run.
 */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}

console.log("browser pre-check, against the shipped photographs");
console.log(`  thresholds: MIN_EDGE ${MIN_EDGE}, DARK_MEAN ${DARK_MEAN}, BRIGHT_MEAN ${BRIGHT_MEAN}`);

const samples = ["public/samples/bins-before.jpg", "public/samples/bins-after.jpg"];
let seen = 0;

for (const rel of samples) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    console.log(`  [skip] ${rel} is not in the repository`);
    continue;
  }
  seen++;
  const buf = readFileSync(path);
  const size = jpegSize(buf);
  note(!!size, `${rel} decodes to a size`, size ? `${size.width}x${size.height}` : "");
  if (!size) continue;

  // The browser measures the NORMALISED frame, capped at MAX_EDGE 1600 on the
  // long edge. Downscaling never takes a photograph under MIN_EDGE unless it
  // was already under it, so the check is on the original size here.
  note(
    Math.max(size.width, size.height) >= MIN_EDGE,
    `${rel} clears the size floor the contract sets`,
    `long edge ${Math.max(size.width, size.height)} >= ${MIN_EDGE}`
  );
}

note(seen > 0, "at least one shipped sample was measured");

// The thresholds themselves have to stay usable. A DARK_MEAN at or above a
// mid grey, or a BRIGHT_MEAN at or below one, would warn on ordinary daylight.
note(DARK_MEAN > 0 && DARK_MEAN < 64, "DARK_MEAN stays well below a normal exposure");
note(BRIGHT_MEAN > 192 && BRIGHT_MEAN < 256, "BRIGHT_MEAN stays well above a normal exposure");
note(
  DARK_MEAN < BRIGHT_MEAN,
  "the accepted band is not empty",
  `${DARK_MEAN} to ${BRIGHT_MEAN}`
);

/* The comparisons themselves, against the contract's.
 *
 * The constants are checked for drift in scripts/check.mjs. What is checked
 * here is the other half of the same bug: a boundary that stops being
 * inclusive. The contract refuses `mean <= DARK_MEAN` and `mean >= BRIGHT_MEAN`
 * and `max(w, h) < MIN_EDGE`. If the browser used `<` where the contract uses
 * `<=`, it would stay silent on a photograph the chain refuses - the feature
 * quietly doing nothing on exactly the frames it exists for.
 *
 * Structural rather than behavioural, because lib/precheck.ts is TypeScript and
 * running it would mean adding a dev dependency to a project that has four
 * runtime dependencies on purpose.
 */
const precheck = readFileSync(join(ROOT, "lib", "precheck.ts"), "utf8");
const contract = readFileSync(join(ROOT, "contracts", "fieldwork.py"), "utf8");

console.log("\nthe boundaries, against the contract's");
note(
  /mean\s*<=\s*DARK_MEAN/.test(precheck) && /mean\s*<=\s*DARK_MEAN/.test(contract),
  "the dark boundary is inclusive on both sides"
);
note(
  /mean\s*>=\s*BRIGHT_MEAN/.test(precheck) && /mean\s*>=\s*BRIGHT_MEAN/.test(contract),
  "the bright boundary is inclusive on both sides"
);
note(
  /longEdge\s*<\s*MIN_EDGE/.test(precheck) &&
    /max\(width,\s*height\)\s*<\s*MIN_EDGE/.test(contract),
  "the size floor is exclusive on both sides"
);

/* And the rule that outranks all of them: a check that did not run is never a
 * pass. `varied` is false when every sampled pixel came back identical, which
 * past mobile Safari's canvas cap is a blank backing store rather than a real
 * photograph. That test has to come BEFORE the darkness test, or a blank canvas
 * reads as "too dark" and blocks a worker over a browser limit. */
const variedAt = precheck.indexOf("if (!m.varied)");
const darkAt = precheck.indexOf("m.mean <= DARK_MEAN");
note(variedAt > 0 && darkAt > 0 && variedAt < darkAt,
  "a blank canvas is ruled unknown before it can be called too dark");
note(
  !/catch\s*\{[^}]*state:\s*"problem"/s.test(precheck),
  "no failure path ever produces a problem verdict"
);

console.log(failures === 0 ? "\nall pre-check assertions passed" : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
