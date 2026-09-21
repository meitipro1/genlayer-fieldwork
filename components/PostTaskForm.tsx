"use client";

import { useEffect, useRef, useState } from "react";
import {
    IS_LIVE,
  IS_STUDIO,
  connectWallet,
  isOutOfGas,
  postTask,
  txUrl,
  humanError,
  type Stage,
} from "@/lib/genlayer";
import { StillSettling, TxProgress } from "./TxProgress";
import { Hint } from "./Hint";

/* Write the test as the worker will read it.
   The contract refuses a test too vague to grade from a photograph, so that
   rejection has to read as help rather than as an error. */

/** Windows that cover the shapes of job this is actually for. */
const WINDOWS = [
  { minutes: 30, label: "30 min" },
  { minutes: 90, label: "90 min" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "1 day" },
  { minutes: 4320, label: "3 days" },
] as const;

/* How long the whole task stays up, which is a different question from how long
   one worker gets once they take it.

   Zero is first and is the default, because it is what every task posted before
   this existed carries, and a deadline nobody chose is a deadline nobody
   expects. The contract accepts an hour to a year, and refuses any value
   shorter than the claim window the same task offers. */
const OPEN_FOR = [
  { minutes: 0, label: "No deadline" },
  { minutes: 1440, label: "1 day" },
  { minutes: 4320, label: "3 days" },
  { minutes: 10080, label: "1 week" },
  { minutes: 43200, label: "30 days" },
] as const;

const EXAMPLE = {
  title: "Clear the bin area behind 14 Mill St",
  place: "Mill St, behind the parade",
  acceptanceTest:
    "The bin area is empty. No bags remain against the wall, the ground is clear of loose litter, and both bins are upright with their lids closed.",
  examplePass:
    "Wall and ground both visible and clear, bins upright, lids down, code legible on paper held in frame.",
  exampleFail:
    "Bags moved out of shot rather than removed, or the wall is not visible in the after photograph.",
};

export function PostTaskForm() {
  const [form, setForm] = useState({
    title: "",
    place: "",
    acceptanceTest: "",
    examplePass: "",
    exampleFail: "",
    reward: 18,
    claimMinutes: 90,
    openMinutes: 0,
    fixedCode: "",
  });
  const [before, setBefore] = useState<{ blob: Blob; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{
    hash: string;
    taskId: number | null;
    settled: boolean;
  } | null>(null);
  const [startedAt, setStartedAt] = useState(0);

  const busy =
    stage === "uploading" ||
    stage === "verifying" ||
    stage === "sent" ||
    stage === "accepted" ||
    stage === "confirming";

  useEffect(() => {
    return () => {
      if (before) URL.revokeObjectURL(before.url);
    };
  }, [before]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * One press fills the whole form, photograph included, as a labelled test
   * task.
   *
   * This used to fill the text and leave the photograph empty, which stranded
   * exactly the person it exists for: someone trying the product for the first
   * time has no "before" photograph of anything, so the example was a form
   * they still could not send. The sample frame ships with the site, and the
   * code is set to TEST42 because that is the code drawn inside the matching
   * sample "after" frame the submit screen offers.
   */
  async function fillExample() {
    setForm((f) => ({ ...f, ...EXAMPLE, fixedCode: "TEST42", claimMinutes: 1440 }));
    try {
      const res = await fetch("/samples/bins-before.jpg");
      if (res.ok) {
        const blob = await res.blob();
        setBefore((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { blob, url: URL.createObjectURL(blob) };
        });
      }
    } catch {
      // The text is still filled; the photograph field simply stays theirs to
      // provide, exactly as before.
    }
  }

  const ready =
    form.title.trim() !== "" &&
    form.acceptanceTest.trim().length >= 20 &&
    form.examplePass.trim() !== "" &&
    form.exampleFail.trim() !== "" &&
    form.reward > 0 &&
    !!before &&
    // The contract wants exactly six or nothing at all. Half a code is the one
    // way to fill this field in and still be refused, so it is caught here.
    (form.fixedCode.length === 0 || form.fixedCode.length === 6) &&
    form.claimMinutes >= 10 &&
    form.claimMinutes <= 10080 &&
    // Zero is always fine. Anything else has to clear the contract's floor and
    // ceiling, and has to be long enough to fit the window this task offers -
    // a task that closes before its own claim window could never be finished.
    (form.openMinutes === 0 ||
      (form.openMinutes >= 60 &&
        form.openMinutes <= 525600 &&
        form.openMinutes >= form.claimMinutes));

  async function onSubmit() {
    setError("");
    setDone(null);
    setStartedAt(Date.now());

    if (!IS_LIVE) {
      setError(
        "No contract address is set, so nothing was sent. Deploy the contract and set NEXT_PUBLIC_FIELDWORK_CONTRACT."
      );
      return;
    }

    try {
      const address = await connectWallet();

      if (await isOutOfGas(address)) {
        setError("This wallet has no GEN to pay for the transaction.");
        return;
      }

      setStage("sent");
      const res = await postTask(
        address,
        {
          title: form.title.trim(),
          place: form.place.trim(),
          acceptanceTest: form.acceptanceTest.trim(),
          examplePass: form.examplePass.trim(),
          exampleFail: form.exampleFail.trim(),
          before: before!.blob,
          // The contract still takes a pair and stores it. Nothing reads it:
          // "Where" in words is what actually gets a worker to a place, and
          // every task posted with the old inputs kept the prefilled example.
          latE6: 0,
          lngE6: 0,
          reward: Number(form.reward),
          // Reputation is out of the interface for now. The contract still
          // takes the parameter and still keeps the score, so nothing on chain
          // changed and putting the field back is a form change, not a
          // redeploy. Zero means every task is open to anyone.
          minReputation: 0,
          claimMinutes: Number(form.claimMinutes),
          openMinutes: Number(form.openMinutes),
          fixedCode: form.fixedCode,
        },
        setStage
      );
      setDone(res);
      setStage("finalized");
    } catch (e: unknown) {
      setStage("failed");
      // Contract error strings are written for humans; humanError only drops
      // the consensus class prefix in front of them.
      setError(humanError(e));
    }
  }

  if (done) {
    return (
      <div className="panel stack">
        <div className="eyebrow" style={{ color: "var(--accent)" }}>
          Task posted
        </div>
        <p style={{ margin: 0 }}>
          {done.taskId !== null
            ? `It is live as task ${done.taskId} and workers can claim it now.`
            : "It is live and workers can claim it now."}
        </p>
        {done.settled ? null : <StillSettling what="Your task" />}
        <a
          className="mono"
          style={{ color: "var(--accent)", wordBreak: "break-all" }}
          href={txUrl(done.hash)}
          target="_blank"
          rel="noreferrer"
        >
          {done.hash}
        </a>
        <button className="btn" type="button" onClick={() => setDone(null)}>
          Post another
        </button>
      </div>
    );
  }

  return (
    /* Not sticky. It was `position: sticky; top: 86`, and this form is far
       taller than a viewport - a sticky element that does not fit pins its top
       and puts everything below the fold out of reach, so the reward, the
       window and the post button could not be scrolled to. It is also the
       tallest thing on the page, so sticking it bought nothing even when it
       did fit. */
    <form
      className="panel"
      style={{ padding: 22 }}
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="spread">
        <div className="eyebrow">New task</div>
        <button className="btn-ghost-sm" type="button" onClick={fillExample}>
          Fill with the example task
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <label htmlFor="title">Title</label>
        <input
          id="title"
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={EXAMPLE.title}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <label htmlFor="place">Where</label>
        <input
          id="place"
          value={form.place}
          onChange={(e) => set("place", e.target.value)}
          placeholder={EXAMPLE.place}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Hint htmlFor="test" label="Acceptance test">
          Name only what a photograph shows
        </Hint>
        <textarea
          id="test"
          rows={4}
          value={form.acceptanceTest}
          onChange={(e) => set("acceptanceTest", e.target.value)}
          placeholder={EXAMPLE.acceptanceTest}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <Hint htmlFor="before" label="How it looks now">
          Yours to shoot, not the worker&apos;s
        </Hint>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{
            width: "100%",
            minHeight: 150,
            border: before
              ? "1px solid var(--accent-line)"
              : "1px dashed var(--line2)",
            borderRadius: 8,
            // contain, not cover: the poster has to see the whole frame they
            // are committing to, and a crop hides exactly the edges the worker
            // will be judged against.
            background: before
              ? `center/contain no-repeat var(--panel) url(${before.url})`
              : "var(--panel)",
            aspectRatio: before ? "4 / 3" : undefined,
            color: "var(--muted)",
            font: "inherit",
            cursor: "pointer",
            overflow: "hidden",
          }}
          aria-label="Choose the before photograph"
        >
          {before ? "" : "tap to add the before photograph"}
        </button>
        <input
          id="before"
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setBefore({ blob: f, url: URL.createObjectURL(f) });
          }}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginTop: 14,
        }}
      >
        <div>
          <label htmlFor="pass">Pass example</label>
          <textarea
            id="pass"
            rows={3}
            value={form.examplePass}
            onChange={(e) => set("examplePass", e.target.value)}
            placeholder={EXAMPLE.examplePass}
          />
        </div>
        <div>
          <label htmlFor="fail">Fail example</label>
          <textarea
            id="fail"
            rows={3}
            value={form.exampleFail}
            onChange={(e) => set("exampleFail", e.target.value)}
            placeholder={EXAMPLE.exampleFail}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginTop: 14,
        }}
      >
        <div>
          <Hint htmlFor="reward" label="Reward - GEN">
            Reward plus fee, sent on posting
          </Hint>
          <input
            id="reward"
            type="number"
            min={1}
            value={form.reward}
            onChange={(e) => set("reward", Number(e.target.value))}
          />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Hint htmlFor="window" label="Claim window">
            Minutes. Clock starts on claim
          </Hint>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {WINDOWS.map((w) => (
              <button
                key={w.minutes}
                type="button"
                className={
                  form.claimMinutes === w.minutes ? "pill pill-accent" : "pill"
                }
                style={{ cursor: "pointer", background: "none" }}
                onClick={() => set("claimMinutes", w.minutes)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <input
            id="window"
            type="number"
            min={10}
            max={10080}
            value={form.claimMinutes}
            onChange={(e) => set("claimMinutes", Number(e.target.value))}
            style={{ marginTop: 8 }}
          />
          {form.claimMinutes < 10 || form.claimMinutes > 10080 ? (
            <p style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.6, color: "var(--danger)" }}>
              The contract accepts 10 minutes to 7 days.
            </p>
          ) : null}
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <Hint htmlFor="openFor" label="Stays open for">
            Minutes. Anyone can return the reward after this
          </Hint>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {OPEN_FOR.map((w) => (
              <button
                key={w.minutes}
                type="button"
                className={
                  form.openMinutes === w.minutes ? "pill pill-accent" : "pill"
                }
                style={{ cursor: "pointer", background: "none" }}
                onClick={() => set("openMinutes", w.minutes)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <input
            id="openFor"
            type="number"
            min={0}
            max={525600}
            value={form.openMinutes}
            onChange={(e) => set("openMinutes", Number(e.target.value))}
            style={{ marginTop: 8 }}
          />
          <p style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.6, color: "var(--muted)" }}>
            {form.openMinutes === 0
              ? "With no deadline the task stays up until you withdraw it yourself, and the reward stays in the contract until you do."
              : "Once it closes unclaimed, anyone can send the reward and the fee back to you in one transaction, without waiting for you to come back and do it."}
          </p>
          {form.openMinutes !== 0 &&
          (form.openMinutes < 60 || form.openMinutes > 525600) ? (
            <p style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.6, color: "var(--danger)" }}>
              The contract accepts an hour to a year, or zero for no deadline.
            </p>
          ) : null}
          {form.openMinutes !== 0 && form.openMinutes >= 60 &&
          form.openMinutes < form.claimMinutes ? (
            <p style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.6, color: "var(--danger)" }}>
              This closes sooner than the {form.claimMinutes} minute claim window
              above, so nobody could finish it in time.
            </p>
          ) : null}
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <Hint htmlFor="fixedCode" label="Set the code yourself">
            Published code. For testing only
          </Hint>
          <input
            id="fixedCode"
            value={form.fixedCode}
            maxLength={6}
            placeholder="leave empty for a real task"
            onChange={(e) =>
              set(
                "fixedCode",
                e.target.value.toUpperCase().replace(/[^23456789ABCDEFGHJKMNPQRSTVWXYZ]/g, "")
              )
            }
            style={{
              fontFamily: "var(--mono)",
              fontWeight: 700,
              letterSpacing: "0.18em",
            }}
          />
          {form.fixedCode.length > 0 && form.fixedCode.length < 6 ? (
            <p
              style={{
                marginTop: 8,
                fontSize: 12.5,
                lineHeight: 1.6,
                color: "var(--danger)",
              }}
            >
              {6 - form.fixedCode.length} more character
              {6 - form.fixedCode.length === 1 ? "" : "s"} needed, or clear the
              field to have the contract issue one.
            </p>
          ) : null}
        </div>
      </div>

      {/* `.panel` spaces nothing for its children, so these last three blocks
          were sitting flush against the field grid above them. */}
      <p className="muted" style={{ margin: "18px 0 0", fontSize: 13.5 }}>
        You send the reward plus the fee when you post. A vision call with two
        images runs once per validator, so rewards below roughly ten GEN do not
        cover their own settlement.
        {IS_STUDIO ? " This network is gasless, so there is nothing else to pay." : ""}
      </p>

      {busy ? (
        <div style={{ marginTop: 14 }}>
          <TxProgress
            stage={stage}
            startedAt={startedAt}
          />
        </div>
      ) : null}

      <button
        className="btn btn-primary btn-block"
        type="button"
        style={{ marginTop: 16 }}
        disabled={!ready || busy}
        onClick={onSubmit}
      >
        {busy ? "working" : "Fund and post"}
      </button>

      {stage === "sent" ? (
        <p className="muted" style={{ margin: "12px 0 0", fontSize: 13.5 }}>
          The contract is reading your acceptance test to check it can be graded
          from a photograph. This takes a few seconds.
        </p>
      ) : null}

      {error ? (
        <div
          className="panel"
          style={{ borderColor: "var(--danger)", marginTop: 14 }}
        >
          <div className="eyebrow" style={{ color: "var(--danger)" }}>
            Not posted
          </div>
          <p style={{ margin: "6px 0 0" }}>{error}</p>
        </div>
      ) : null}
    </form>
  );
}
