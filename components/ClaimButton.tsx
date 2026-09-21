"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    IS_LIVE,
  claimTask,
  connectWallet,
  humanError,
  isOutOfGas,
  txUrl,
} from "@/lib/genlayer";
import { formatWindowLength } from "@/lib/tasks";
import { StillSettling, TxProgress } from "./TxProgress";
import type { Stage } from "@/lib/genlayer";

/* Claiming is a real transaction: it is what issues the code that ties the
   photographs to this worker and this moment. The button therefore shows the
   whole lifecycle rather than a spinner, because a write takes longer than a
   token transfer and a silent wait reads as a broken page. */

type Phase = "idle" | "wallet" | "sent" | "accepted" | "confirming" | "done" | "failed";

export function ClaimButton({
  taskId,
  claimMinutes = 90,
}: {
  taskId: number;
  claimMinutes?: number;
}) {
  const windowLabel = formatWindowLength(claimMinutes);
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState("");
  const [hash, setHash] = useState("");
  const [settled, setSettled] = useState(true);
  const [startedAt, setStartedAt] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");

  const busy =
    phase === "wallet" ||
    phase === "sent" ||
    phase === "accepted" ||
    phase === "confirming";

  const label =
    phase === "wallet"
      ? "confirm in your wallet"
      : phase === "sent"
        ? "claiming, this takes a few seconds"
        : phase === "accepted"
          ? "waiting for the network to agree"
          : phase === "confirming"
            ? "confirming before we answer"
            : "Claim this task";

  async function onClaim() {
    setError("");
    setStartedAt(Date.now());
    if (!IS_LIVE) {
      setError(
        "No contract address is set, so nothing was sent. Set NEXT_PUBLIC_FIELDWORK_CONTRACT."
      );
      setPhase("failed");
      return;
    }

    try {
      setPhase("wallet");
      const address = await connectWallet();

      if (await isOutOfGas(address)) {
        setError("This wallet has no GEN to pay for the transaction.");
        setPhase("failed");
        return;
      }

      setPhase("sent");
      const res = await claimTask(
        address,
        taskId,
        () => setPhase("accepted"),
        (st) => {
          setStage(st);
          if (st === "confirming") setPhase("confirming");
        }
      );
      setHash(res.hash);
      setCode(res.code);
      setSettled(res.settled);
      setPhase("done");

      // The submit screen reads the code from the chain, so it needs the fresh
      // state rather than the copy rendered before the claim.
      router.refresh();
    } catch (e: unknown) {
      setPhase("failed");
      setError(humanError(e) || "the claim did not go through");
    }
  }

  if (phase === "done") {
    return (
      <div className="panel stack">
        <div className="eyebrow" style={{ color: "var(--accent)" }}>
          Claimed - the task is yours for {windowLabel}
        </div>
        {code ? (
          <div
            className="mono"
            style={{
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "0.16em",
              color: "var(--accent)",
            }}
          >
            {code}
          </div>
        ) : null}
        <p className="muted" style={{ margin: 0 }}>
          {code
            ? "Write that code on paper and keep it in frame in the photograph you take."
            : // The claim landed; only the read that fetches the code back did
              // not. The next screen asks the chain again on the server, so send
              // them there rather than printing whatever the receipt held.
              "The claim is yours. Your code would not read back just now - it is on the next screen, which asks the chain again."}
        </p>
        {settled ? null : <StillSettling what="Your claim" />}
        <a className="btn btn-primary btn-block" href={`/submit/${taskId}`}>
          Take the photographs
        </a>
        {hash ? (
          <a
            className="mono muted"
            style={{ wordBreak: "break-all" }}
            href={txUrl(hash)}
            target="_blank"
            rel="noreferrer"
          >
            {hash}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stack">
      <button
        className="btn btn-primary btn-block"
        onClick={onClaim}
        disabled={busy}
        type="button"
      >
        {label}
      </button>

      {busy ? (
        <TxProgress
          stage={stage === "idle" ? "sent" : stage}
          startedAt={startedAt}
        />
      ) : null}

      {error ? (
        <div className="panel" style={{ borderColor: "var(--danger)" }}>
          <div className="eyebrow" style={{ color: "var(--danger)" }}>
            Not claimed
          </div>
          <p style={{ margin: "6px 0 0" }}>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
