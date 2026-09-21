import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CaptureFlow } from "@/components/CaptureFlow";
import { fetchTask, lookupTask } from "@/lib/onchain";
import { formatWindowLength, isPastDeadline } from "@/lib/tasks";
import { Unavailable } from "@/components/Unavailable";
import type { Task } from "@/lib/types";

export const revalidate = 5;

/* Guide a phone camera to a passing photograph.

   Everything above the camera is a gate. This screen used to render the capture
   flow for any task at all, inventing a stand-in code when there was no claim,
   so it happily walked someone through photographing a task that was already
   paid, or never theirs, and the contract refused the transaction at the end of
   it. Measured on 0xd5af05ee: a second submission against a settled task, which
   the contract correctly refused with "this task is not awaiting a submission".

   A refusal the interface could have predicted is an interface bug. The rule
   below is the contract's own rule, checked before anyone drives anywhere. */

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const task = await fetchTask(Number(params.id));
  return { title: task ? `Submit - ${task.title}` : "Submit" };
}

function Blocked({
  task,
  title,
  children,
  action,
}: {
  task: Task;
  title: string;
  children: React.ReactNode;
  action?: { href: string; label: string };
}) {
  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "30px 24px 0" }}>
      <Link
        href={`/task/${task.id}`}
        className="eyebrow"
        style={{ letterSpacing: "0.1em", fontSize: 12 }}
      >
        ← {task.title}
      </Link>

      <h1 style={{ fontSize: 26, marginTop: 16 }}>{title}</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>
        {task.place}
      </p>

      <div className="panel panel-2" style={{ marginTop: 20 }}>
        <p style={{ margin: 0, color: "var(--dim)", lineHeight: 1.6 }}>
          {children}
        </p>
        {action ? (
          <Link
            className="btn btn-primary btn-lg"
            href={action.href}
            style={{ marginTop: 16 }}
          >
            {action.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default async function SubmitPage({ params }: { params: { id: string } }) {
  const found = await lookupTask(Number(params.id));
  if (found.status === "unavailable") return <Unavailable what="this task" />;
  if (found.status === "missing") notFound();
  const task = found.task;

  if (task.status === "paid") {
    return (
      <Blocked
        task={task}
        title="This one is already settled"
        action={{ href: `/proof/${task.id}`, label: "See the receipt" }}
      >
        The work was graded and the task is closed, so there is nothing left to
        photograph. The receipt has both photographs, the text they were graded
        against and the three judgements.
      </Blocked>
    );
  }

  if (task.status === "cancelled") {
    return (
      <Blocked
        task={task}
        title="The poster cancelled this task"
        action={{ href: "/map", label: "Find work that is open" }}
      >
        It was withdrawn before anyone settled it, and the reward went back to
        the poster. Nothing you submit here can be paid.
      </Blocked>
    );
  }

  if (task.status === "expired") {
    return (
      <Blocked
        task={task}
        title="This task closed before it was settled"
        action={{ href: "/map", label: "Find work that is open" }}
      >
        Its deadline passed with nobody holding it, so the reward and the fee
        went back to the poster. Nothing submitted here can be paid.
      </Blocked>
    );
  }

  // Nobody has claimed it, so there is no code to hold in the frame and the
  // contract has no idea who the photograph would be from.
  if (task.status === "open" || !task.challengeCode) {
    return (
      <Blocked
        task={task}
        title="Claim it before you photograph it"
        action={{ href: `/task/${task.id}`, label: "Read the test and claim" }}
      >
        The code you have to hold in the frame is issued when you claim, and the
        claim is what ties the photograph to you. Without it the contract has
        nothing to check the work against.
      </Blocked>
    );
  }

  // `claimed` and `rejected` are both live: a rejection leaves the claim with
  // its owner so they can retake inside the same window.
  const now = Date.now();
  const expired = task.expiresAt > 0 && now > task.expiresAt;

  if (expired) {
    // A claim is clamped to the task's own deadline, so a claim that ran out
    // on a task with a deadline means the task itself has closed. Telling that
    // worker to claim it again would walk them into a refusal.
    const taskClosed = isPastDeadline(task, now);
    return (
      <Blocked
        task={task}
        title={
          taskClosed
            ? "This task has closed"
            : `Your ${formatWindowLength(task.claimMinutes)} are up`
        }
        action={
          taskClosed
            ? { href: "/map", label: "Find work that is open" }
            : { href: `/task/${task.id}`, label: "Claim it again if it is open" }
        }
      >
        {taskClosed
          ? "Its deadline has passed, so it is not going back to the pool and nobody can claim it now. Anyone can send the reward back to the poster from the task page."
          : "The claim has run out, so the task goes back to the pool and anyone can take it. Nothing is lost: claim it again and you get a fresh code and a fresh window."}
      </Blocked>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "30px 24px 0" }}>
      <Link
        href={`/task/${task.id}`}
        className="eyebrow"
        style={{ letterSpacing: "0.1em", fontSize: 12 }}
      >
        ← {task.title}
      </Link>

      <h1 style={{ fontSize: 26, marginTop: 16 }}>Submit for settlement</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>
        {task.place}
      </p>

      {task.status === "rejected" && task.reason ? (
        <div className="panel" style={{ marginTop: 16, borderColor: "var(--danger)" }}>
          <div className="eyebrow" style={{ color: "var(--danger)" }}>
            Last time this was rejected
          </div>
          <p style={{ margin: "8px 0 0", lineHeight: 1.6 }}>{task.reason}</p>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 13.5,
              color: "var(--muted)",
              lineHeight: 1.6,
            }}
          >
            The claim is still yours, so fix that one thing and shoot it again.
          </p>
        </div>
      ) : null}

      <div style={{ marginTop: 20 }}>
        <CaptureFlow task={task} now={now} />
      </div>
    </div>
  );
}
