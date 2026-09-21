"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "@/lib/types";
import { formatRemaining } from "@/lib/tasks";
import { normalisePhoto, uniquifySample } from "@/lib/image";
import { precheckCanvas } from "@/lib/precheck";
import type { Precheck } from "@/lib/precheck";
import { ChallengeCode } from "./ChallengeCode";
import { SettlementNotice } from "./SettlementNotice";
import {
    IS_LIVE,
  connectWallet,
  humanError,
  submitPhotographs,
  type Stage,
} from "@/lib/genlayer";
import { StillSettling, TxProgress } from "./TxProgress";

/* Mobile first, one hand, outdoors.
   The checklist catches the rejection before it happens, which is worth more
   than any appeal path. */

type Shot = { blob: Blob; url: string } | null;

function CaptureTile({
  label,
  shot,
  onPick,
  disabled = false,
}: {
  label: string;
  shot: Shot;
  onPick: (f: File) => void;
  /** True while a submission is in flight. See the note at the call site. */
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        style={{
          width: "100%",
          aspectRatio: "3 / 4",
          border: shot
            ? "1px solid var(--accent-line)"
            : "1px solid var(--line2)",
          borderRadius: 12,
          // The whole photograph, not a crop of it. A worker has to be able to
          // check the code is in frame before they send it, and cover hides the
          // edges where they just put it.
          background: shot
            ? `center/contain no-repeat var(--panel) url(${shot.url})`
            : "var(--panel)",
          color: "var(--muted)",
          font: "inherit",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 10,
          padding: 0,
          overflow: "hidden",
        }}
        aria-label={`Capture the ${label.toLowerCase()} photograph`}
      >
        {shot ? null : (
          <>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="2.5"
                y="6"
                width="19"
                height="14"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.6" />
              <path
                d="M8.5 6l1.4-2.2h4.2L15.5 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
            <span
              style={{
                font: "500 11px var(--mono)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              tap to capture
            </span>
          </>
        )}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
    </div>
  );
}

const CHECKS = [
  { key: "code", label: "code visible in my photograph" },
  { key: "spot", label: "same spot as the poster's" },
  { key: "area", label: "whole task area in frame" },
] as const;

/**
 * Whether the wallet already connected to this site owns this claim.
 *
 * Reads with `eth_accounts`, which never opens MetaMask. Stays undefined while
 * unknown, and the interface then says nothing rather than guessing: warning
 * someone off their own task would be worse than the warning is worth.
 */
function useClaimIsMine(claimedBy?: string): boolean | undefined {
  const [mine, setMine] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const eth = (globalThis as { ethereum?: unknown }).ethereum as
      | { request?: (a: unknown) => Promise<string[]> }
      | undefined;
    if (!eth?.request || !claimedBy) return;
    let live = true;
    eth
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        const me = accounts?.[0];
        if (live && me) setMine(me.toLowerCase() === claimedBy.toLowerCase());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [claimedBy]);

  return mine;
}

export function CaptureFlow({ task, now }: { task: Task; now: number }) {
  const mine = useClaimIsMine(task.claimedBy);
  const [after, setAfter] = useState<Shot>(null);
  const [look, setLook] = useState<Precheck>({ state: "unknown" });

  /* Accept a photograph: normalise it, measure it, and forget the last attempt.
     
     Normalising here rather than at submit time is what makes the measurement
     honest. What reaches the validators is a 1600px re-encode, so measuring the
     camera original would report on bytes nobody ever sees - and it is also
     what stops the worker learning to retake only after the wallet has opened
     and the photograph is already public. */
  const accept = useCallback(async (file: Blob) => {
    setError("");
    // A new photograph is a new attempt. Leaving the last verdict on screen
    // describes a frame that is no longer loaded.
    setResult(null);
    setLook({ state: "unknown" });
    try {
      const ready = await normalisePhoto(file);
      setAfter((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob: ready.blob, url: URL.createObjectURL(ready.blob) };
      });
      setLook(precheckCanvas(ready.canvas));
    } catch {
      // The normaliser is the upload path too, so a failure here would have
      // failed at submit anyway. Keep the raw file so the flow still works and
      // say nothing about it - a check that did not run is not a verdict.
      setAfter((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob: file, url: URL.createObjectURL(file) };
      });
      setLook({ state: "unknown" });
    }
  }, []);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<{
    status: string;
    reason: string;
    settled: boolean;
  } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [error, setError] = useState("");
  const initialRemaining = task.expiresAt - now;
  const [remaining, setRemaining] = useState(initialRemaining);

  // Minutes rather than a timestamp, counted down live.
  // Ticked down from the window the server handed us rather than recomputed
  // against Date.now(), so the countdown is correct no matter how the server's
  // clock and the phone's clock differ.
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(
      () => setRemaining(initialRemaining - (Date.now() - startedAt)),
      1000
    );
    return () => clearInterval(id);
  }, [initialRemaining]);

  useEffect(() => {
    return () => {
      if (after) URL.revokeObjectURL(after.url);
    };
  }, [after]);

  // Words, not a minute count. The poster picks the window now, and a three day
  // task was reading "claim expires in 4320 minutes".
  const timeLeft = formatRemaining(Date.now() + remaining, Date.now());
  const expired = remaining <= 0;

  const checksLeft = CHECKS.filter((c) => !ticked[c.key]).length;
  const allTicked = checksLeft === 0;
  // `mine === false` means the connected wallet is provably not the claimant,
  // and the contract refuses those. Warning and then letting the button through
  // spends a transaction to learn what the page already knew. `undefined` is
  // not the same thing: no wallet is connected yet, so nothing is blocked.
  const ready = !!after && allTicked && !expired && mine !== false;

  const busy =
    stage === "uploading" ||
    stage === "verifying" ||
    stage === "sent" ||
    stage === "accepted" ||
    stage === "confirming";

  const stageCopy = useMemo(() => {
    switch (stage) {
      case "uploading":
        return "uploading your photograph";
      case "verifying":
        return "storage was not ready, trying again";
      case "sent":
        return "graders are reading the evidence";
      case "accepted":
        return "verdict in, releasing payment";
      case "finalized":
        return "paid";
      default:
        return "";
    }
  }, [stage]);

  async function onSubmit() {
    setError("");
    if (!after) return;
    setStartedAt(Date.now());

    if (!IS_LIVE) {
      setError(
        "This build has no contract address set, so nothing was sent. Set NEXT_PUBLIC_FIELDWORK_CONTRACT to submit for real."
      );
      return;
    }

    try {
      const address = (await connectWallet()) as `0x${string}`;
      const res = await submitPhotographs({
        address,
        taskId: task.id,
        after: after.blob,
        onStage: setStage,
      });
      setResult({ status: res.status, reason: res.reason, settled: res.settled });
      // Anything short of a payment leaves the flow usable: a rejection can be
      // retaken, and an unreadable verdict must not look like a dead screen.
      if (res.status !== "paid") setStage("idle");
    } catch (e: unknown) {
      setStage("failed");
      // Contract error strings are written for humans; humanError only drops
      // the consensus class prefix in front of them.
      setError(humanError(e) || "something went wrong");
    }
  }

  if (result?.status === "paid") {
    return (
      <div className="panel stack" style={{ textAlign: "center" }}>
        <span className="pill pill-solid">Paid - {task.reward} GEN</span>
        <h2 style={{ fontSize: 28, marginTop: 4 }}>Settled</h2>
        <p className="muted">{result.reason}</p>
        {result.settled ? null : <StillSettling what="Your submission" />}
        <SettlementNotice />
        <a className="btn btn-primary btn-block" href={`/proof/${task.id}`}>
          See the public receipt
        </a>
      </div>
    );
  }

  return (
    <div className="stack">
      {mine === false ? (
        <div className="panel" style={{ borderColor: "var(--danger)" }}>
          <div className="eyebrow" style={{ color: "var(--danger)" }}>
            This claim belongs to another wallet
          </div>
          <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            The contract will refuse a submission from anyone but the claimant,
            so this would cost you a transaction and nothing else. Switch to the
            wallet that claimed it, or find a task that is still open.
          </p>
        </div>
      ) : null}

      <ChallengeCode code={task.challengeCode || "------"} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Before - from the poster
          </div>
          <div
            style={{
              width: "100%",
              aspectRatio: "3 / 4",
              border: "1px solid var(--line2)",
              borderRadius: 12,
              background: task.beforeUrl
                ? `center/contain no-repeat var(--panel) url(${task.beforeUrl})`
                : "var(--panel)",
              display: "grid",
              placeItems: "center",
              color: "var(--muted)",
              font: "500 11px var(--mono)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              textAlign: "center",
              padding: 12,
              overflow: "hidden",
            }}
          >
            {task.beforeUrl ? "" : "no photograph on this task"}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
            The state you are measured against - match the angle
          </p>
        </div>
        <div>
          <CaptureTile
            label="After - your work"
            shot={after}
            /* Locked while a submission is in flight. submitPhotographs
               captured this blob by value when it was called, and the storage
               retry loop can keep it running for minutes, so a swap here would
               leave the screen showing one photograph while the chain graded
               another. */
            disabled={busy}
            onPick={(f) => void accept(f)}
          />
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
            Keep the code in frame - only this one is yours to take
          </p>

          {/* An observation about the photograph, never a verdict on it.

              Deliberately not the danger panel used for a rejection further
              down: a red heading here reads as the contract having refused,
              and a worker who believes that never presses submit at all. That
              is the worst kind of false block - it costs them the job without
              a transaction ever being sent, and the browser has no standing to
              decide anything.

              `ok` and `unknown` both render nothing. A photograph that is fine
              gets silence, and so does a check that could not run, because a
              check that failed to run must never be mistaken for one that
              passed. Nothing here touches `ready` or the checklist below. */}
          {look.state === "problem" ? (
            <p
              role="status"
              style={{
                margin: "8px 0 0",
                padding: "10px 12px",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 12.5,
                lineHeight: 1.6,
                color: "var(--dim)",
                background: "var(--panel-2)",
              }}
            >
              {look.message} You can still send it - the graders decide, not
              this page.
            </p>
          ) : null}
          {/* Only on the shipped example. The sample frame has TEST42 drawn
              inside it, so offering it on any other task would hand the grader
              a photograph carrying the wrong code - and the wrong scene. */}
          {task.fixedCode === "TEST42" ? (
            <button
              type="button"
              className="btn-ghost-sm"
              style={{ marginTop: 8 }}
              disabled={busy}
              onClick={async () => {
                try {
                  const res = await fetch("/samples/bins-after.jpg");
                  if (!res.ok) return;
                  // Stamped unique per run. The contract refuses a content id
                  // it has already paid for, so the fixed sample file would
                  // work exactly once per deployment and every visitor after
                  // the first would be told their photograph was reused.
                  const blob = await uniquifySample(await res.blob());
                  await accept(blob);
                } catch {
                  // the tile stays empty and the camera path still works
                }
              }}
            >
              Use the sample photograph
            </button>
          ) : null}
        </div>
      </div>

      <section className="panel panel-2" style={{ padding: 20 }}>
        <div className="eyebrow">Before you submit</div>
        {CHECKS.map((c) => (
          <label
            key={c.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              textTransform: "none",
              letterSpacing: 0,
              fontFamily: "var(--sans)",
              fontSize: 15,
              color: "var(--ink)",
              marginTop: 12,
              marginBottom: 0,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={!!ticked[c.key]}
              onChange={(e) =>
                setTicked((t) => ({ ...t, [c.key]: e.target.checked }))
              }
              style={{ width: 20, height: 20, minHeight: 20, flex: "0 0 auto" }}
            />
            {c.label}
          </label>
        ))}
        <p
          style={{
            color: "var(--muted)",
            fontSize: 13.5,
            lineHeight: 1.6,
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid var(--line)",
          }}
        >
          {task.acceptanceTest}
        </p>
      </section>

      {busy ? (
        <TxProgress
          stage={stage}
          startedAt={startedAt}
        />
      ) : null}

      <div
        className="spread"
        style={{
          font: "500 11.5px var(--mono)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <span style={{ color: "var(--muted)" }}>
          {expired ? "this claim has expired" : `claim expires in ${timeLeft}`}
        </span>
        <span style={{ color: "var(--accent)" }}>
          {stageCopy
            ? stageCopy
            : checksLeft > 0
              ? `${checksLeft} check${checksLeft === 1 ? "" : "s"} left`
              : after
                ? "ready"
                : "photograph needed"}
        </span>
      </div>

      <button
        className="btn btn-primary btn-lg"
        disabled={!ready || busy}
        onClick={onSubmit}
      >
        {busy ? stageCopy : "Submit for settlement"}
      </button>

      <p
        style={{
          textAlign: "center",
          color: "var(--muted)",
          fontSize: 13,
          margin: 0,
        }}
      >
        A rejection inside the window costs a retake, not the claim
      </p>

      {result?.status === "rejected" ? (
        <div className="panel" style={{ borderColor: "var(--danger)" }}>
          <div className="eyebrow" style={{ color: "var(--danger)" }}>
            Rejected
          </div>
          <p style={{ margin: "6px 0 0" }}>{result.reason}</p>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13.5 }}>
            Retake and submit again - the claim is still yours for {timeLeft}
          </p>
        </div>
      ) : null}

      {/* The submission is on chain and the verdict could not be read back.
          Guessing at one is how a paid task gets reported as a rejection, so
          this says exactly what is and is not known. */}
      {result?.status === "unknown" ? (
        <div className="panel">
          <div className="eyebrow">Sent, and we could not read the verdict</div>
          <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Your photograph is on chain and the graders have it. The network
            would not answer when we asked what they decided, so rather than
            guess: nothing here is a rejection.
          </p>
          <a
            className="btn btn-primary btn-block"
            href={`/proof/${task.id}`}
            style={{ marginTop: 14 }}
          >
            Open the receipt for the answer
          </a>
        </div>
      ) : null}

      {error ? (
        <p className="mono" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
