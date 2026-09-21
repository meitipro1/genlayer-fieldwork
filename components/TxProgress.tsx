"use client";

import { useEffect, useState } from "react";
import { type Stage } from "@/lib/genlayer";

/* What a write looks like while it is happening.

   Every screen used to show a one line "sent" and then jump straight to an
   answer read off the first receipt, which arrives long before consensus is
   done. So the site announced verdicts it did not have yet, and a slow chain
   read as a hang.

   This says the same three things everywhere: which step we are on, why that
   step exists, and how long it has actually been running. Nothing here predicts
   how long is left, because nothing here knows. */

const LABEL: Record<Stage, string> = {
  idle: "",
  uploading: "Uploading your photograph",
  verifying: "Storage was not ready, trying again",
  sent: "Sent to the network, waiting for a validator",
  accepted: "Executed, waiting for the network to agree",
  confirming: "Agreed, confirming before we answer",
  finalized: "Confirmed",
  failed: "Stopped",
};

const DETAIL: Record<Stage, string> = {
  idle: "",
  uploading: "It goes to content addressed storage, so every validator reads the same bytes.",
  verifying:
    "The graders could not fetch your photograph yet, which happens for a short while after it is stored. Nothing is wrong with it and nothing is lost - this is the same transaction being sent again.",
  sent: "Nothing has been decided yet.",
  accepted:
    "A result exists but consensus can still rotate to another validator, so it is not an answer yet.",
  confirming:
    "The transaction is final. Holding for half a minute, then reading the answer back off the chain rather than off the receipt.",
  finalized: "",
  failed: "",
};

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/**
 * No estimate, and no progress bar.
 *
 * Both were predictions. A percentage bar is an estimate wearing a different
 * hat: it can only be drawn by guessing a total, and when the guess is wrong it
 * sits at 97% while the chain carries on, which reads worse than no bar. A
 * settlement takes as long as consensus takes.
 *
 * What is shown instead is only what is known: which step the write is on, why
 * that step exists, and how long it has actually been running.
 */
export function TxProgress({
  stage,
  startedAt,
}: {
  stage: Stage;
  /** Unix ms when the write began, so the clock survives a re-render. */
  startedAt: number;
}) {
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (stage === "idle" || stage === "finalized" || stage === "failed") return null;

  const elapsed = Math.max(0, now - startedAt);

  return (
    <div className="panel panel-2" role="status" aria-live="polite">
      <div className="spread">
        <div className="eyebrow eyebrow-accent">{LABEL[stage]}</div>
        <span
          style={{
            font: "500 11.5px var(--mono)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          {clock(elapsed)}
        </span>
      </div>

      {/* Indeterminate on purpose. It says "running", which is true, rather
          than "62 percent", which would not be. */}
      <div className="tx-bar" style={{ marginTop: 12 }}>
        <span />
      </div>

      <p
        style={{
          margin: "12px 0 0",
          fontSize: 13.5,
          lineHeight: 1.6,
          color: "var(--dim)",
        }}
      >
        {DETAIL[stage]}
      </p>

      <p
        style={{
          margin: "8px 0 0",
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--muted)",
        }}
      >
        This takes as long as the network takes, and nothing is lost by waiting.
        Leaving this page does not cancel it.
      </p>
    </div>
  );
}

/**
 * Shown when a write reached the chain but the site could not watch it finish.
 *
 * This is not a failure and must never be dressed as one. The transaction has a
 * hash and is settling; the only honest thing to say is where to look.
 */
export function StillSettling({ what }: { what: string }) {
  return (
    <div className="notice" style={{ marginTop: 12 }}>
      <strong>{what} is on chain and still settling.</strong> The network stopped
      answering us before we saw it finish, which is common here and is not a
      failure. Give it a minute and reload rather than sending it again.
    </div>
  );
}
