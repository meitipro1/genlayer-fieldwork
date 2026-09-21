"use client";

import { useEffect, useState } from "react";
import { isPastDeadline } from "@/lib/tasks";
import Link from "next/link";
import { formatRemaining, formatWindowLength } from "@/lib/tasks";

/* What to show on a task that is already claimed.

   The page itself is rendered on the server and cannot know who is looking at
   it, so it used to say "Claimed by someone else" to everyone - including the
   person who had just claimed it, which left them with no way back to their own
   submit screen.

   This reads the wallet without prompting for it. `eth_accounts` returns the
   accounts already connected to this site and never opens MetaMask; asking with
   `eth_requestAccounts` would pop a dialog at everyone who opened a task page,
   which is a worse thing to do than the bug it fixes. */

type Ownership = "unknown" | "mine" | "theirs";

/**
 * Three states, not two, and the difference matters.
 *
 * "unknown" covers the server render, the moment before the wallet answers, and
 * every visitor without one. Collapsing that into "someone else" is what made
 * the claimant see their own task accused of belonging to a stranger, and it
 * would still flash that for a beat even once the check existed. So an
 * unanswered question is shown as an unanswered question.
 */
function useOwnership(claimedBy?: string): Ownership {
  const [state, setState] = useState<Ownership>("unknown");

  useEffect(() => {
    const eth = (globalThis as { ethereum?: unknown }).ethereum as
      | {
          request?: (a: unknown) => Promise<string[]>;
          on?: (e: string, f: (a: string[]) => void) => void;
          removeListener?: (e: string, f: (a: string[]) => void) => void;
        }
      | undefined;
    if (!eth?.request || !claimedBy) return;

    let live = true;
    const settle = (accounts: string[]) => {
      if (!live) return;
      const me = accounts?.[0];
      if (!me) return setState("unknown");
      setState(me.toLowerCase() === claimedBy.toLowerCase() ? "mine" : "theirs");
    };

    eth.request({ method: "eth_accounts" }).then(settle).catch(() => {});
    eth.on?.("accountsChanged", settle);
    return () => {
      live = false;
      eth.removeListener?.("accountsChanged", settle);
    };
  }, [claimedBy]);

  return state;
}

export function ClaimState({
  taskId,
  claimedBy,
  challengeCode,
  expiresAt,
  openUntil = 0,
  claimMinutes = 90,
  rejected = false,
  reason,
}: {
  taskId: number;
  claimedBy?: string;
  challengeCode?: string;
  expiresAt: number;
  /** The task's own deadline, or 0 if it has none. See the expired branch. */
  openUntil?: number;
  /** The window the poster chose, for the copy on a task nobody here holds. */
  claimMinutes?: number;
  /** A rejection keeps the claim, so the holder can retake inside the window. */
  rejected?: boolean;
  reason?: string;
}) {
  const owned = useOwnership(claimedBy);

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Rendered on the server too, so the clock only exists after mount.
  // Expiry is decided on the raw milliseconds, not on the rounded label: a
  // claim with forty seconds left rounds to "0 minutes" and is still live.
  const timeLeft = now && expiresAt > 0 ? formatRemaining(expiresAt, now) : null;
  const expired = now !== null && expiresAt > 0 && now >= expiresAt;
  // Not `openUntil > 0`. A short claim on a task with a distant deadline runs
  // out while the task is still perfectly open, and telling that worker it has
  // closed would send them away from a job they could simply take again.
  const taskClosed = now !== null && isPastDeadline({ openUntil }, now);
  const windowLabel = formatWindowLength(claimMinutes);

  if (owned === "theirs") {
    return (
      <button className="btn btn-primary btn-lg" disabled>
        Claimed by someone else
      </button>
    );
  }

  if (owned === "unknown") {
    return (
      <div className="panel panel-2">
        <div className="eyebrow">Claimed, and being worked on</div>
        <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
          Someone has {windowLabel} on this one. If it is you, connect the
          wallet you claimed with and this will turn into your code. If the
          window runs out the task comes back to the pool.
        </p>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="panel panel-2">
        <div className="eyebrow">Your claim has run out</div>
        <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
          {taskClosed
            ? `Your ${windowLabel} are up, and this task's own deadline has passed too, so it is not going back to the pool. Anyone can now send the reward back to whoever posted it.`
            : `Your ${windowLabel} are up, so this task has gone back to the pool and anyone can take it. Claim it again if it is still open.`}
        </p>
      </div>
    );
  }

  return (
    <div className="panel panel-2">
      <div className="spread">
        <div className="eyebrow eyebrow-accent">
          {rejected ? "Still yours, and worth another go" : "This task is yours"}
        </div>
        {timeLeft !== null ? (
          <span
            style={{
              font: "500 11.5px var(--mono)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {timeLeft} left
          </span>
        ) : null}
      </div>

      {challengeCode ? (
        <div
          style={{
            font: "800 34px var(--mono)",
            letterSpacing: "0.18em",
            color: "var(--accent)",
            marginTop: 12,
          }}
        >
          {challengeCode}
        </div>
      ) : null}

      {rejected && reason ? (
        <p
          style={{
            margin: "10px 0 0",
            color: "var(--danger)",
            lineHeight: 1.6,
            fontSize: 14.5,
          }}
        >
          {reason}
        </p>
      ) : null}

      <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
        {rejected
          ? "A rejection does not cost you the claim. Fix that one thing, keep the code in frame, and submit again inside the window."
          : "Write that code on paper and keep it in frame in the photograph you take."}
      </p>

      <Link
        className="btn btn-primary btn-lg"
        href={`/submit/${taskId}`}
        style={{ marginTop: 14 }}
      >
        {rejected ? "Retake the photograph" : "Take the photograph"}
      </Link>
    </div>
  );
}
