"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  IS_LIVE,
  IS_STUDIO,
  connectWallet,
  expireTask,
  humanError,
  txUrl,
} from "@/lib/genlayer";
import { StillSettling, TxProgress } from "./TxProgress";
import type { Stage } from "@/lib/genlayer";

/* Close a task whose deadline has passed, and send the reward back.

   Deliberately not gated on who is looking, which is the one thing that makes
   this worth having. CancelTask beside it draws only for the poster, because
   only the poster may withdraw a task. This one draws for everybody, because
   the failure it fixes is a poster who never comes back: a rescue only they can
   perform is no rescue at all, and the reward would sit in the contract for
   good with an undoable job on the map beside it.

   Whoever presses it gains nothing. The contract reads the recipient out of its
   own storage, so the money can only go to the poster and the caller is out the
   cost of a transaction. On a gasless network that cost is zero, which is why
   the button can be offered to a stranger without apology. */

export function ExpireTask({
  taskId,
  reward,
  closedAt,
  expirable,
}: {
  taskId: number;
  reward: number;
  /** When the deadline passed, already formatted. */
  closedAt: string;
  /** The contract will accept it right now. */
  expirable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [startedAt, setStartedAt] = useState(0);
  const [settled, setSettled] = useState(true);
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");

  if (!expirable) return null;

  async function onExpire() {
    setError("");
    if (!IS_LIVE) {
      setError("No contract address is set, so nothing was sent.");
      return;
    }
    setBusy(true);
    setStartedAt(Date.now());
    try {
      const address = (await connectWallet()) as `0x${string}`;
      const res = await expireTask(address, taskId, setStage);
      setHash(res.hash);
      setSettled(res.settled);
      router.refresh();
    } catch (e: unknown) {
      setError(humanError(e) || "the task was not closed");
    } finally {
      setBusy(false);
    }
  }

  if (hash) {
    return (
      <div className="panel panel-2" style={{ marginTop: 14 }}>
        <div className="eyebrow eyebrow-accent">Task closed</div>
        <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
          The reward and the fee went back to whoever posted it, in the same
          transaction that closed the task.
          {IS_STUDIO
            ? " On this development network the refund is recorded and the balance does not move, the same as a payout."
            : ""}
        </p>
        {settled ? null : <StillSettling what="The refund" />}
        <a
          className="mono"
          style={{
            color: "var(--accent)",
            wordBreak: "break-all",
            display: "block",
            marginTop: 10,
            fontSize: 12,
          }}
          href={txUrl(hash)}
          target="_blank"
          rel="noreferrer"
        >
          {hash}
        </a>
      </div>
    );
  }

  return (
    <div className="panel panel-2" style={{ marginTop: 14 }}>
      <div className="eyebrow">This task has closed</div>
      <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
        Its deadline passed on {closedAt} with nobody holding it, so it can no
        longer be claimed and the {reward} GEN is still sitting in the contract.
        Anyone can send it back to the poster, including you - the contract reads
        the address out of its own record, so there is nothing to fill in and
        nothing to gain by doing it.
      </p>

      {busy ? (
        <div style={{ marginTop: 14 }}>
          <TxProgress
            stage={stage === "idle" ? "sent" : stage}
            startedAt={startedAt}
          />
        </div>
      ) : null}

      <button
        className="btn"
        type="button"
        style={{ marginTop: 14 }}
        disabled={busy}
        onClick={onExpire}
      >
        {busy ? "closing" : `Return the ${reward} GEN to the poster`}
      </button>

      {error ? (
        <p style={{ margin: "12px 0 0", color: "var(--danger)", lineHeight: 1.6 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
