// Server side reads of the deployed contract.
//
// Every page reads through here, so pointing the site at a live contract is a
// question of whether NEXT_PUBLIC_FIELDWORK_CONTRACT is set, not a rewrite.
// When it is unset, or the chain cannot be reached, the seed records in
// lib/tasks.ts stand in.

import { createClient } from "genlayer-js";
import { chain } from "./chain";
import type { Task, TaskStatus } from "./types";
import { isClaimable, TASKS as SEED } from "./tasks";

const CONTRACT = (process.env.NEXT_PUBLIC_FIELDWORK_CONTRACT ||
  "") as `0x${string}`;

export const IS_LIVE = CONTRACT.length > 0;

/** Reads are cached briefly at the route. Nothing depends on the cache for
 *  correctness, so a stale read is a cosmetic bug rather than a money bug. */
export const revalidate = 5;

type RawTask = {
  id: number;
  poster: string;
  title: string;
  place: string;
  acceptance_test: string;
  example_pass: string;
  example_fail: string;
  lat_e6: number;
  lng_e6: number;
  reward: string;
  fee: string;
  min_reputation: number;
  claimed_by: string;
  challenge_code: string;
  claim_expires: string;
  status: string;
  reason: string;
  before_url: string;
  after_url: string;
  content_hash: string;
  phash: string;
  fixed_code: string;
  claim_minutes: number;
  /**
   * Optional on purpose. The contract cannot be upgraded in place, so the site
   * and the contract are deployed separately and there is always a window where
   * this site is reading one that predates deadlines and sends no such key.
   */
  open_until?: string;
  code_visible: boolean;
  same_place: boolean;
  test_passed: boolean;
  graded_at: string;
};

const ZERO = "0x0000000000000000000000000000000000000000";

function weiToWhole(wei: string): number {
  try {
    return Number(BigInt(wei) / BigInt(10) ** BigInt(18));
  } catch {
    return 0;
  }
}

function toTask(raw: RawTask): Task {
  // Only a claimed task has a deadline. An unclaimed one is 0, which the UI
  // reads as "no clock running yet" rather than inventing one.
  const parsed = raw.claim_expires ? Date.parse(raw.claim_expires + "Z") : 0;
  const expires = Number.isFinite(parsed) ? parsed : 0;

  // Parsed exactly like claim_expires above, and for a sharper reason. An older
  // contract sends no open_until at all, and `Date.parse(undefined + "Z")` is
  // NaN - which loses every comparison it appears in, so `now > openUntil` would
  // be false forever and a closed task would read as open on every screen. Zero
  // is the one value that means "no deadline" and behaves like it.
  const rawOpen = raw.open_until ? Date.parse(raw.open_until + "Z") : 0;
  const openUntil = Number.isFinite(rawOpen) ? rawOpen : 0;

  return {
    id: raw.id,
    title: raw.title,
    place: raw.place,
    acceptanceTest: raw.acceptance_test,
    examplePass: raw.example_pass,
    exampleFail: raw.example_fail,
    reward: weiToWhole(raw.reward),
    claimMinutes: Number(raw.claim_minutes) || 90,
    status: (raw.status as TaskStatus) || "open",
    expiresAt: expires,
    openUntil,
    // Full, like claimedBy: the task page has to know whether the visitor is
    // the poster before it can offer them a cancel.
    poster: raw.poster && raw.poster !== ZERO ? raw.poster : "",
    // Full, not shortened: the task page compares this against the visitor's
    // wallet to tell "yours" from "someone else's".
    claimedBy:
      raw.claimed_by && raw.claimed_by !== ZERO ? raw.claimed_by : undefined,
    challengeCode: raw.challenge_code || undefined,
    reason: raw.reason || undefined,
    beforeUrl: raw.before_url || undefined,
    afterUrl: raw.after_url || undefined,
    contentHash: raw.content_hash || undefined,
    phash: raw.phash || undefined,
    fixedCode: raw.fixed_code || undefined,
    // Read, never inferred. This used to hard-code three green ticks for any
    // paid task, which happened to be true (the contract only pays when all
    // three pass) and was still the site making up data it had not been given.
    // A rejected task got nothing at all, which is the case where the three
    // actually matter.
    verdict: raw.graded_at
      ? {
          codeVisible: !!raw.code_visible,
          samePlace: !!raw.same_place,
          testPassed: !!raw.test_passed,
        }
      : undefined,
    gradedAt: raw.graded_at ? Date.parse(raw.graded_at + "Z") || undefined : undefined,
  };
}

function client() {
  return createClient({ chain });
}

/**
 * The headline numbers, counted off the chain rather than written down.
 *
 * These were hard-coded: 1,204 settled, 83% first attempt pass, 4m median. On a
 * product whose entire argument is that it does not overclaim, three invented
 * numbers at the top of the front page were the least defensible thing on the
 * site. The real figures are small, and small and true beats large and made up.
 *
 * `medianMinutes` is null until the contract records enough to compute one, and
 * the interface shows a dash rather than a plausible number.
 */
export type LiveStats = {
  settled: number;
  paid: number;
  rejected: number;
  /**
   * The share of settled tasks that ended paid.
   *
   * This was labelled "first attempt pass", which it is not and never was: a
   * worker who is rejected for framing and retakes inside the same window ends
   * up counted here as a pass. The contract does not record attempts, so a real
   * first-attempt figure is not derivable from this state at all - and naming a
   * number after something you did not measure is the exact failure this whole
   * function was written to remove.
   */
  paidShare: number | null;
  openNow: number;
  committedGen: number;
};

export function statsFrom(tasks: Task[], now: number): LiveStats {
  const paid = tasks.filter((t) => t.status === "paid").length;
  const rejected = tasks.filter((t) => t.status === "rejected").length;
  const settled = paid + rejected;
  return {
    settled,
    paid,
    rejected,
    paidShare: settled > 0 ? Math.round((paid / settled) * 100) : null,
    // Counted through the same predicate the listings filter on. Counting the
    // status alone put tasks in the headline figure that no visitor could find
    // in the grid underneath it, because the grid had already excluded them.
    openNow: tasks.filter((t) => isClaimable(t, now)).length,
    // Deliberately still the raw statuses. This is money the contract is
    // actually holding, and it holds the reward for a task that is past its
    // deadline exactly as tightly until someone closes it.
    committedGen: tasks
      .filter((t) => t.status === "open" || t.status === "claimed")
      .reduce((sum, t) => sum + t.reward, 0),
  };
}

/**
 * Studio pushes back in two ways, and both look like a broken site if ignored:
 * `-32006 Server busy: all N execution slots occupied`, and
 * `Rate limit exceeded: 30 requests per minute`.
 */
function isBackpressure(e: unknown): boolean {
  const msg = String(
    (e as { details?: string; message?: string })?.details ??
      (e as Error)?.message ??
      e
  );
  return (
    msg.includes("-32006") ||
    /slots occupied|Server busy|Rate limit exceeded|too many requests/i.test(msg)
  );
}

async function backoff<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let wait = 900;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isBackpressure(e) || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    }
  }
}

/**
 * Read the chain at most once every few seconds, however many pages ask.
 *
 * Home, /map and /console all want the same list, and each task costs a call.
 * Rendering them together against a 30-requests-per-minute limit is enough to
 * start losing tasks, so concurrent callers share one in-flight read and the
 * result is held briefly. Nothing depends on the cache for correctness - a
 * stale read is a cosmetic bug, never a money bug.
 */
const TTL_MS = 5000;
let cached: { at: number; tasks: Task[] } | null = null;
let inflight: Promise<Task[]> | null = null;
let cachedTotal: { at: number; total: number } | null = null;

/** Small concurrency, so a long list never bursts through the rate limit. */
async function inBatches<In, Out>(
  items: In[],
  size: number,
  fn: (item: In) => Promise<Out>
): Promise<Out[]> {
  const out: Out[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * How many tasks the contract has, or null if the chain would not say.
 *
 * Needed because the SDK does not surface a contract's own error text: asking
 * for an id that does not exist comes back as a bare "execution failed", which
 * is indistinguishable from a busy node. One extra read settles it.
 */
async function totalTasks(): Promise<number | null> {
  if (cachedTotal && Date.now() - cachedTotal.at < TTL_MS) return cachedTotal.total;
  try {
    const total = Number(
      await backoff(() =>
        (client() as any).readContract({
          address: CONTRACT,
          functionName: "total_tasks",
          args: [],
        })
      )
    );
    if (!Number.isFinite(total)) return null;
    cachedTotal = { at: Date.now(), total };
    return total;
  } catch {
    return null;
  }
}

export async function fetchTasks(limit = 40): Promise<Task[]> {
  if (!IS_LIVE) return SEED;

  if (cached && Date.now() - cached.at < TTL_MS) return cached.tasks;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const c = client();
      const total = Number(
        await backoff(() =>
          (c as any).readContract({
            address: CONTRACT,
            functionName: "total_tasks",
            args: [],
          })
        )
      );
      if (!Number.isFinite(total) || total <= 0) return [];
      cachedTotal = { at: Date.now(), total };

      // Newest first, bounded.
      const ids: number[] = [];
      for (let i = total - 1; i >= 0 && ids.length < limit; i--) ids.push(i);

      const rows = await inBatches(ids, 4, async (id) => {
        try {
          const raw = await backoff(() =>
            (c as any).readContract({
              address: CONTRACT,
              functionName: "task_json",
              args: [id],
            })
          );
          return toTask(JSON.parse(String(raw)) as RawTask);
        } catch {
          return null;
        }
      });

      const tasks = rows.filter((t): t is Task => t !== null);
      cached = { at: Date.now(), tasks };
      return tasks;
    } catch {
      // A chain that cannot be reached should not take the site down.
      return cached?.tasks ?? SEED;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * "I could not reach the chain" and "there is no such task" are different
 * answers and must not be collapsed.
 *
 * The seed records cannot stand in for a single live task: their ids are in a
 * different space entirely, so falling back to them turns a busy RPC into a
 * confident "this task does not exist" for a task that plainly does.
 */
export type TaskLookup =
  | { status: "found"; task: Task }
  | { status: "missing" }
  | { status: "unavailable" };

export async function lookupTask(id: number): Promise<TaskLookup> {
  if (!IS_LIVE) {
    const seeded = SEED.find((t) => t.id === id);
    return seeded ? { status: "found", task: seeded } : { status: "missing" };
  }

  // generateMetadata and the page body both ask for the same task, so a warm
  // list answers both without touching the chain again.
  if (cached && Date.now() - cached.at < TTL_MS) {
    const hit = cached.tasks.find((t) => t.id === id);
    if (hit) return { status: "found", task: hit };
  }

  try {
    const raw = await backoff(
      () =>
        (client() as any).readContract({
          address: CONTRACT,
          functionName: "task_json",
          args: [id],
        }),
      5
    );
    return { status: "found", task: toTask(JSON.parse(String(raw)) as RawTask) };
  } catch (e) {
    const warm = cached?.tasks.find((t) => t.id === id);
    if (warm) return { status: "found", task: warm };

    // The contract says "no task with that id", but the SDK reports every
    // failed gen_call as "execution failed" and drops the message, so the read
    // that failed cannot tell us why on its own. Ask how many tasks exist: an
    // id past the end is genuinely missing, and anything else is the network.
    if (/no task with that id/i.test(String((e as Error)?.message ?? e))) {
      return { status: "missing" };
    }
    const total = await totalTasks();
    if (total !== null && (id < 0 || id >= total)) return { status: "missing" };
    return { status: "unavailable" };
  }
}

export async function fetchTask(id: number): Promise<Task | undefined> {
  const found = await lookupTask(id);
  return found.status === "found" ? found.task : undefined;
}
