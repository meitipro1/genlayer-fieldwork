/* The contract's own pre-flight limits, mirrored.
 *
 * These are not the browser's opinion about a good photograph. They are the
 * exact numbers in contracts/fieldwork.py, so that a refusal the browser
 * predicts is a refusal the chain would actually make, and so the two can never
 * disagree about where the line is.
 *
 * scripts/check.mjs reads both files and fails the build if any value here
 * stops matching the contract. Guessing at these, or letting them drift, would
 * make the browser warn about photographs the chain would have accepted, which
 * is the one failure this whole feature must not have.
 */

/** Below this on the long edge, a six character code is not legible. */
export const MIN_EDGE = 480;

/** Lens cap, pocket, unlit yard. */
export const DARK_MEAN = 12;

/** Sun straight into the lens, detail gone. */
export const BRIGHT_MEAN = 243;
