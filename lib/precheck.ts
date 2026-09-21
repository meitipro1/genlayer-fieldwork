import { MIN_EDGE, DARK_MEAN, BRIGHT_MEAN } from "./limits";

/* Run the contract's own pre-flight, here, where it can actually run.
 *
 * The contract has an exposure gate: it opens the photograph, converts to
 * luminance, resizes to 32 by 32 and refuses a mean at or below DARK_MEAN or at
 * or above BRIGHT_MEAN. Read `_preflight` in contracts/fieldwork.py and it says
 * plainly why that gate never fires for anything this site sends: the Pillow
 * build inside GenVM has no JPEG decoder, so on a JPEG the measurement is
 * skipped rather than failed - the alternative would be refusing every JPEG
 * ever submitted. Every photograph this site uploads is JPEG, because
 * normalisePhoto re-encodes with toBlob("image/jpeg").
 *
 * So the contract describes a check it cannot perform on our photographs, and
 * the browser is holding the decoded pixels anyway. Running the same
 * measurement here costs no new dependency, no download and a few milliseconds
 * on a canvas that has already been drawn.
 *
 * What this is not: it is not a reader. It never looks for the code, never
 * recognises a character and never claims the photograph will pass. A worker
 * whose photograph is fine gets nothing but silence from it.
 */

/**
 * Three states, never two.
 *
 * `unknown` is the one that matters. A check that failed to run must never be
 * indistinguishable from a check that passed: on a phone under memory pressure
 * `getContext` returns null and `drawImage` can leave the canvas blank without
 * throwing, and a two-state result would read both as "fine". The interface
 * renders `unknown` as nothing at all, which is exactly what shipped before
 * this existed.
 */
export type Precheck =
  | { state: "ok" }
  | { state: "problem"; message: string }
  | { state: "unknown" };

const UNKNOWN: Precheck = { state: "unknown" };

/**
 * The decision, with no canvas in it.
 *
 * Split out so it can be tested. The measuring half needs a browser and cannot
 * be exercised in node; the deciding half is where a wrong threshold or a
 * wrong comparison would actually cost a worker their submission, and it is
 * pure arithmetic. scripts/check-precheck.mjs runs this against the real
 * thresholds and the shipped photographs.
 *
 * `varied` is false when every sampled pixel came back identical, which past
 * mobile Safari's canvas cap is a blank backing store far more often than it
 * is a real photograph - so it resolves to `unknown`, never to "too dark".
 */
export function verdictFor(m: {
  longEdge: number;
  mean: number;
  varied: boolean;
}): Precheck {
  if (!(m.longEdge > 0)) return UNKNOWN;
  if (m.longEdge < MIN_EDGE) {
    return {
      state: "problem",
      message:
        "This photograph is too small for a six character code to be legible. Take it again at your camera's normal size rather than sending a cropped or shrunken copy.",
    };
  }
  if (!m.varied) return UNKNOWN;
  if (m.mean <= DARK_MEAN) {
    return {
      state: "problem",
      message:
        "This photograph is too dark to grade. Take it again with more light on the code, or move so the paper is not in shadow.",
    };
  }
  if (m.mean >= BRIGHT_MEAN) {
    return {
      state: "problem",
      message:
        "This photograph is washed out and the detail is gone. Stand so the sun is behind you rather than behind the code.",
    };
  }
  return { state: "ok" };
}

/**
 * Measure a photograph the way the contract would.
 *
 * Takes the canvas the normaliser already drew, so this reads the exact pixels
 * that reach content addressed storage and therefore the exact pixels the
 * validators fetch. Measuring the camera original instead would grade bytes
 * nobody ever sees - a 12 megapixel frame where a biro stroke is comfortably
 * wide, when what gets uploaded is a 1600px re-encode where the same stroke is
 * a pixel and a half.
 */
export function precheckCanvas(canvas: HTMLCanvasElement): Precheck {
  try {
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return UNKNOWN;

    const longEdge = Math.max(w, h);
    // The size floor is decidable without reading a pixel, so it is answered
    // before any canvas work that could fail.
    if (longEdge < MIN_EDGE) return verdictFor({ longEdge, mean: 128, varied: true });

    // 32 by 32, the same grid the contract reduces to, so the mean is
    // comparable rather than merely similar.
    const tile = document.createElement("canvas");
    tile.width = 32;
    tile.height = 32;
    const ctx = tile.getContext("2d", { willReadFrequently: true });
    if (!ctx) return UNKNOWN;
    ctx.drawImage(canvas, 0, 0, 32, 32);

    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, 32, 32).data;
    } catch {
      // A tainted or oversized canvas. Not a failed photograph.
      return UNKNOWN;
    }

    let total = 0;
    let first = -1;
    let varied = false;
    for (let i = 0; i < data.length; i += 4) {
      // Rec. 601 luma, which is what Pillow's convert("L") computes.
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      total += y;
      const q = Math.round(y);
      if (first < 0) first = q;
      else if (q !== first) varied = true;
    }

    return verdictFor({ longEdge, mean: total / (data.length / 4), varied });
  } catch {
    // Anything unexpected is a check that did not run, never a photograph that
    // failed. The worker must not lose a job to a bug in this file.
    return UNKNOWN;
  }
}
