import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ClaimButton } from "@/components/ClaimButton";
import { ClaimState } from "@/components/ClaimState";
import { CancelTask } from "@/components/CancelTask";
import { ExpireTask } from "@/components/ExpireTask";
import {
  formatStamp,
  formatWindow,
  formatWindowLength,
  isExpirable,
  isPastDeadline,
} from "@/lib/tasks";
import { fetchTask, lookupTask } from "@/lib/onchain";
import { Unavailable } from "@/components/Unavailable";

export const revalidate = 5;

/* Make the acceptance test impossible to misread.

   The design frames the standard as the centre of the page and the claim as a
   consequence of having read it, so the facts strip and the test sit above the
   button rather than beside it. */

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const task = await fetchTask(Number(params.id));
  return { title: task ? task.title : "Task" };
}

export default async function TaskPage({ params }: { params: { id: string } }) {
  const found = await lookupTask(Number(params.id));
  if (found.status === "unavailable") return <Unavailable what="this task" />;
  if (found.status === "missing") notFound();
  const task = found.task;

  const now = Date.now();

  /* The contract's own rule, mirrored so the button matches what will happen.
     `claim` calls `_abandoned` first and returns an expired task to the pool
     before checking whether it is open, so a `claimed` or `rejected` task whose
     window has run out is claimable by anyone - including the person whose
     claim it was. Showing "claimed by someone else" there was wrong: it hid a
     task that is genuinely available. */
  const stale =
    (task.status === "claimed" || task.status === "rejected") &&
    task.expiresAt > 0 &&
    now > task.expiresAt;
  /* The task's own deadline, which outranks everything above.

     A task past its deadline is still `open` on chain until somebody sends the
     transaction that closes it, so `status === "open"` is no longer the whole
     answer. Offering a claim here would take a worker through a wallet prompt
     and a paid transaction to reach a refusal the page already knew about. */
  const closed = isPastDeadline(task, now);
  const claimable = (task.status === "open" || stale) && !closed;
  /* Anyone may close it, not just the poster - that is the point of it. */
  const expirable = isExpirable(task, now);
  /* A rejection leaves the claim with its owner so they can retake inside the
     same window, so a live `rejected` task belongs to its claimant exactly as a
     `claimed` one does. */
  const heldByClaimant =
    !stale && (task.status === "claimed" || task.status === "rejected");

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "34px 30px 0" }}>
      <Link
        href="/map"
        className="eyebrow"
        style={{ letterSpacing: "0.1em", fontSize: 12 }}
      >
        ← All tasks
      </Link>

      <div className="spread" style={{ marginTop: 20 }}>
        <div className="eyebrow">Task {task.id}</div>
        <span
          className={
            (task.status === "open" && !closed) || task.status === "paid"
              ? "pill pill-accent"
              : "pill"
          }
        >
          {task.status}
        </span>
      </div>

      <h1 style={{ fontSize: 36, marginTop: 14 }}>{task.title}</h1>
      <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 15 }}>
        {task.place}
      </p>

      <div
        className="facts"
        style={{ gridTemplateColumns: "repeat(2,1fr)", marginTop: 26 }}
      >
        <div>
          <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>
            Reward
          </div>
          <div className="fact-value" style={{ color: "var(--accent)" }}>
            {task.reward} GEN
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>
            Claim window
          </div>
          <div className="fact-value">{formatWindow(task, now)}</div>
        </div>
      </div>

      {task.beforeUrl ? (
        <figure
          style={{
            margin: "14px 0 0",
            border: "1px solid var(--line)",
            borderRadius: 12,
            overflow: "hidden",
            background: "var(--panel)",
          }}
        >
          <div className="eyebrow" style={{ padding: "12px 14px 8px", letterSpacing: "0.14em" }}>
            How it looks now - photographed by the poster
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={task.beforeUrl}
            alt="The place as the poster found it"
            style={{ width: "100%", display: "block" }}
          />
          <figcaption
            style={{
              padding: "12px 14px 14px",
              fontSize: 13.5,
              color: "var(--muted)",
              lineHeight: 1.6,
            }}
          >
            The starting state you will be graded against, so you can see the job
            before you walk anywhere - take your photograph from roughly here
          </figcaption>
        </figure>
      ) : null}

      <section
        className="panel panel-flush"
        style={{ marginTop: 14 }}
      >
        <div style={{ padding: "22px 24px", borderBottom: "1px solid var(--line)" }}>
          <div className="eyebrow eyebrow-accent">
            Acceptance test - frozen before any claim
          </div>
          <p style={{ fontSize: 19, lineHeight: 1.5, marginTop: 12 }}>
            {task.acceptanceTest}
          </p>
        </div>
        <div className="grid-2" style={{ gap: 0 }}>
          <div style={{ padding: "20px 24px", borderRight: "1px solid var(--line)" }}>
            <div
              className="eyebrow eyebrow-accent"
              style={{ fontWeight: 700, letterSpacing: "0.14em" }}
            >
              Passes
            </div>
            <p
              style={{
                color: "var(--dim)",
                marginTop: 9,
                fontSize: 14.5,
                lineHeight: 1.6,
              }}
            >
              {task.examplePass}
            </p>
          </div>
          <div style={{ padding: "20px 24px" }}>
            <div
              className="eyebrow"
              style={{ fontWeight: 700, letterSpacing: "0.14em", color: "var(--danger)" }}
            >
              Fails
            </div>
            <p
              style={{
                color: "var(--dim)",
                marginTop: 9,
                fontSize: 14.5,
                lineHeight: 1.6,
              }}
            >
              {task.exampleFail}
            </p>
          </div>
        </div>
      </section>

      {task.fixedCode ? (
        <div
          className="panel"
          style={{
            marginTop: 14,
            borderColor: "var(--accent-line)",
            background: "linear-gradient(180deg,var(--accent-soft),transparent)",
          }}
        >
          <div className="spread">
            <div className="eyebrow eyebrow-accent">
              The code for this task is published
            </div>
            <span className="pill">test task</span>
          </div>
          <div
            style={{
              font: "800 34px var(--mono)",
              letterSpacing: "0.18em",
              color: "var(--accent)",
              marginTop: 12,
            }}
          >
            {task.fixedCode}
          </div>
          <p style={{ marginTop: 10, color: "var(--dim)", lineHeight: 1.6 }}>
            The poster chose it, so you can write it on paper and take the
            photograph before you claim. That is the point of it: one person can
            run the whole thing through on their own.
          </p>
          <p
            style={{
              marginTop: 8,
              color: "var(--muted)",
              fontSize: 13.5,
              lineHeight: 1.6,
            }}
          >
            On a live task the code is issued at claim time and nobody can know
            it in advance, which is what proves the photograph came after. This
            one is labelled because it is a demonstration.
          </p>
        </div>
      ) : null}

      <div className="panel panel-2" style={{ marginTop: 14 }}>
        <div className="eyebrow">What happens when you claim</div>
        <p style={{ marginTop: 10, fontSize: 15, lineHeight: 1.6, color: "var(--dim)" }}>
          {task.fixedCode
            ? "You get the code above, which is already public on this task - write it on paper, keep it in frame in the photograph you take and submit inside the window"
            : "The contract issues a six character code that is yours alone - write it on paper, keep it in frame in the photograph you take and submit inside the window"}
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <span className="pill">open to anyone</span>
          <span className="pill">{formatWindowLength(task.claimMinutes)} claim</span>
          <span className="pill">retry inside the window</span>
        </div>
      </div>

      {/* The pill above shows the chain's own word, and for an abandoned task
          that word is still "claimed". Rather than overwrite it, say what it
          means: the previous claim ran out and the contract returns the task to
          the pool on the next claim. */}
      {stale && !closed ? (
        <div className="panel panel-2" style={{ marginTop: 20 }}>
          <div className="eyebrow eyebrow-accent">Available again</div>
          <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
            The last claim on this ran out without a passing submission, so it is
            open to anyone - including whoever held it. Claiming returns it to
            the pool and issues a fresh code in the same transaction.
          </p>
        </div>
      ) : null}

      <div style={{ marginTop: 20 }}>
        {claimable ? (
          <ClaimButton taskId={task.id} claimMinutes={task.claimMinutes} />
        ) : heldByClaimant ? (
          // Whether this is "yours" or "someone else's" depends on who is
          // looking, which the server cannot know.
          <ClaimState
            taskId={task.id}
            claimedBy={task.claimedBy}
            challengeCode={task.challengeCode}
            expiresAt={task.expiresAt}
            openUntil={task.openUntil}
            claimMinutes={task.claimMinutes}
            rejected={task.status === "rejected"}
            reason={task.reason}
          />
        ) : (
          <button className="btn btn-primary btn-lg" disabled>
            {task.status === "paid"
              ? "Already settled"
              : task.status === "cancelled"
                ? "The poster cancelled this task"
                : task.status === "expired"
                  ? "This task closed and the reward went back"
                  : closed
                    ? "This task has closed to new claims"
                    : "Not open"}
          </button>
        )}
      </div>

      {claimable ? (
        <p
          style={{
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13,
            marginTop: 12,
          }}
        >
          The claim is a transaction - it is what ties the photograph to you and
          to this moment
        </p>
      ) : null}

      {/* Mirrors the contract exactly: open always, rejected only once the
          claim window has run out. A rejection leaves the claim with the worker
          so they can retake, and cancelling underneath them would take the task
          away from someone who has already made the trip. */}
      <ExpireTask
        taskId={task.id}
        reward={task.reward}
        closedAt={formatStamp(task.openUntil)}
        expirable={expirable}
      />

      <CancelTask
        taskId={task.id}
        poster={task.poster}
        reward={task.reward}
        windowLabel={formatWindowLength(task.claimMinutes)}
        cancellable={task.status === "open" || (task.status === "rejected" && stale)}
        blockedReason={
          heldByClaimant
            ? task.status === "rejected"
              ? `A worker holds this task. Their submission was rejected and they can retake it inside the same window, so you can withdraw it once their ${formatWindowLength(
                  task.claimMinutes
                )} have run out.`
              : `A worker holds a live claim on this. You can withdraw it once their ${formatWindowLength(
                  task.claimMinutes
                )} have run out.`
            : undefined
        }
      />

      {task.status === "paid" ? (
        <p style={{ marginTop: 14 }}>
          <Link href={`/proof/${task.id}`} style={{ color: "var(--accent)", fontWeight: 700 }}>
            See the public receipt for this task →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
