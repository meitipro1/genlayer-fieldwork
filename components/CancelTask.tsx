"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
    IS_LIVE,
  IS_STUDIO,
  cancelTask,
  connectWallet,
  humanError,
  txUrl,
} from "@/lib/genlayer";
import { StillSettling, TxProgress } from "./TxProgress";
import type { Stage } from "@/lib/genlayer";

/* Let a poster take a task back and get the money out.

   The contract has always had `cancel_task` and the site never offered it, so
   a poster who funded work nobody wanted had no way to recover the reward
   short of writing the transaction themselves. That is a real hole in a
   product that takes money up front.

   It only shows for the poster, and only while the task is still cancellable,
   because the contract refuses anything else and an offer that gets refused is
   worse than no offer. */

function useIsPoster(poster?: string): boolean {
  const [mine, setMine] = useState(false);

  useEffect(() => {
    const eth = (globalThis as { ethereum?: unknown }).ethereum as
      | {
          request?: (a: unknown) => Promise<string[]>;
          on?: (e: string, f: (a: string[]) => void) => void;
          removeListener?: (e: string, f: (a: string[]) => void) => void;
        }
      | undefined;
    if (!eth?.request || !poster) return;

    let live = true;
    // eth_accounts never opens the wallet. Prompting everyone who reads a task
    // page just to decide whether to draw one button would be rude.
    const settle = (accounts: string[]) => {
      const me = accounts?.[0];
      if (live) setMine(!!me && me.toLowerCase() === poster.toLowerCase());
    };
    eth.request({ method: "eth_accounts" }).then(settle).catch(() => {});
    eth.on?.("accountsChanged", settle);
    return () => {
      live = false;
      eth.removeListener?.("accountsChanged", settle);
    };
  }, [poster]);

  return mine;
}

export function CancelTask({
  taskId,
  poster,
  reward,
  cancellable,
  blockedReason,
  windowLabel = "90 minutes",
}: {
  taskId: number;
  poster?: string;
  reward: number;
  /** Open always, rejected only once the claim window has run out. */
  cancellable: boolean;
  /** Why not, when the poster would otherwise be looking at nothing at all. */
  blockedReason?: string;
  /** The window this task actually runs, for the copy. */
  windowLabel?: string;
}) {
  const router = useRouter();
  const isPoster = useIsPoster(poster);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [startedAt, setStartedAt] = useState(0);
  const [settled, setSettled] = useState(true);
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");

  if (!isPoster) return null;

  // A poster whose task is held by a worker used to get no panel at all, which
  // reads as the site having lost their withdraw button rather than as the
  // contract protecting someone who is part way through the job.
  if (!cancellable) {
    if (!blockedReason) return null;
    return (
      <div className="panel panel-2" style={{ marginTop: 14 }}>
        <div className="eyebrow">You posted this task</div>
        <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
          {blockedReason}
        </p>
      </div>
    );
  }

  async function onCancel() {
    setError("");
    if (!IS_LIVE) {
      setError("No contract address is set, so nothing was sent.");
      return;
    }
    setBusy(true);
    setStartedAt(Date.now());
    try {
      const address = (await connectWallet()) as `0x${string}`;
      const res = await cancelTask(address, taskId, setStage);
      setHash(res.hash);
      setSettled(res.settled);
      router.refresh();
    } catch (e: unknown) {
      setError(humanError(e) || "the task was not cancelled");
    } finally {
      setBusy(false);
    }
  }

  if (hash) {
    return (
      <div className="panel panel-2" style={{ marginTop: 14 }}>
        <div className="eyebrow eyebrow-accent">Task withdrawn</div>
        <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
          The reward and the fee were refunded to you in the same transaction.
          {IS_STUDIO
            ? " On this development network the refund is recorded and the balance does not move, the same as a payout."
            : ""}
        </p>
        {settled ? null : <StillSettling what="The withdrawal" />}
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
      <div className="eyebrow">You posted this task</div>

      {!confirming ? (
        <>
          <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
            You can withdraw it while it is unpaid and take the {reward} GEN back,
            along with the fee.
          </p>
          <button
            className="btn"
            type="button"
            style={{ marginTop: 14 }}
            onClick={() => setConfirming(true)}
          >
            Withdraw this task
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
            This closes the task for good and nobody can claim it afterwards.
            The contract will not let you do it while a worker still holds a
            live claim, so what you are withdrawing here is a task that either
            nobody took or whose {windowLabel} have already run out.
          </p>
          {busy ? (
            <div style={{ marginTop: 14 }}>
              <TxProgress
                stage={stage === "idle" ? "sent" : stage}
                startedAt={startedAt}
              />
            </div>
          ) : null}

          <div className="row" style={{ marginTop: 14, flexWrap: "wrap" }}>
            <button
              className="btn"
              type="button"
              style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
              disabled={busy}
              onClick={onCancel}
            >
              {busy ? "withdrawing" : `Yes, refund ${reward} GEN`}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Keep it open
            </button>
          </div>
        </>
      )}

      {error ? (
        <p style={{ margin: "12px 0 0", color: "var(--danger)", lineHeight: 1.6 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
