import Link from "next/link";
import type { Task } from "@/lib/types";
import { formatStamp } from "@/lib/tasks";
import { SettlementNotice } from "./SettlementNotice";

/* Both photographs, the test, the verdict and the payment.

   Public receipts are what convince the next poster that the network works, so
   they are built to be linked rather than buried in a dashboard. The design
   leads with the verdict pill and puts the evidence directly under it, before
   any of the machinery. */

/**
 * One photograph on the receipt, or an honest gap where one should be.
 *
 * A receipt can exist without a photograph: some refusals happen before the
 * submission is recorded, and older tasks predate the contract storing the url
 * on that path. Rendering `<img src={undefined}>` there gives a broken image
 * icon on a page whose whole job is to be trustworthy evidence.
 */
function Frame({
  label,
  src,
  alt,
  accent = false,
}: {
  label: string;
  src?: string;
  alt: string;
  accent?: boolean;
}) {
  return (
    <figure
      style={{
        margin: 0,
        border: `1px solid ${accent ? "var(--accent-line)" : "var(--line)"}`,
        borderRadius: 12,
        overflow: "hidden",
        background: "var(--panel)",
      }}
    >
      <div className="eyebrow" style={{ padding: "12px 14px 8px", letterSpacing: "0.14em" }}>
        {label}
      </div>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} style={{ width: "100%", display: "block" }} />
      ) : (
        <div
          style={{
            aspectRatio: "4 / 3",
            display: "grid",
            placeItems: "center",
            padding: 20,
            textAlign: "center",
            color: "var(--muted)",
            fontSize: 13.5,
            lineHeight: 1.6,
            borderTop: "1px solid var(--line)",
          }}
        >
          Not recorded on this task
        </div>
      )}
    </figure>
  );
}

function Judgement({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="verdict-row">
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span
        style={{
          fontWeight: 700,
          color: ok ? "var(--accent)" : "var(--danger)",
        }}
      >
        {ok ? "yes" : "no"}
      </span>
    </div>
  );
}

export function ProofReceipt({ task }: { task: Task }) {
  const paid = task.status === "paid";

  return (
    <article>
      <div className="spread">
        <div className="eyebrow">Public receipt</div>
        <span className={paid ? "pill pill-solid" : "pill pill-danger"}>
          {paid ? `Paid - ${task.reward} GEN` : "Rejected"}
        </span>
      </div>

      <h1 style={{ fontSize: 36, marginTop: 14 }}>{task.title}</h1>
      <p
        style={{
          color: "var(--muted)",
          marginTop: 10,
          font: "500 13px var(--mono)",
        }}
      >
        {task.place}
        {task.gradedAt ? ` - ${formatStamp(task.gradedAt)}` : ""} - task{" "}
        {task.id}
      </p>

      <div className="grid-2" style={{ marginTop: 24 }}>
        <Frame label="Before photograph" src={task.beforeUrl} alt="Before the work" />
        <Frame
          label="After photograph"
          src={task.afterUrl}
          alt="After the work"
          accent
        />
      </div>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="eyebrow">Graded against</div>
        <p style={{ fontSize: 18, lineHeight: 1.5, marginTop: 10 }}>
          {task.acceptanceTest}
        </p>
      </section>

      {/* Only rendered when the chain actually recorded a grading. A refusal
          before the model ran (an unreadable file, a reused photograph) leaves
          no judgements, and three grey "no" rows would read as three findings
          against the worker rather than as an absence of any. */}
      {task.verdict ? (
        <section className="panel panel-2 panel-flush" style={{ marginTop: 14 }}>
          <Judgement label="code visible" ok={task.verdict.codeVisible} />
          <Judgement label="same place" ok={task.verdict.samePlace} />
          <Judgement label="test passed" ok={task.verdict.testPassed} />
        </section>
      ) : (
        <section className="panel panel-2" style={{ marginTop: 14 }}>
          <div className="eyebrow">No judgements were recorded</div>
          <p style={{ margin: "10px 0 0", color: "var(--dim)", lineHeight: 1.6 }}>
            This one was settled before the graders looked at it, so there is
            nothing to show here. The reason below is the whole story.
          </p>
        </section>
      )}

      <div className="grid-2" style={{ marginTop: 14 }}>
        {task.reason ? (
          <section className="panel panel-2" style={{ padding: "20px 22px" }}>
            <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>
              Reason given to the worker
            </div>
            <p
              style={{
                marginTop: 10,
                fontSize: 14.5,
                lineHeight: 1.6,
                color: "var(--dim)",
              }}
            >
              {task.reason}
            </p>
          </section>
        ) : null}

        {task.contentHash ? (
          <section className="panel panel-2" style={{ padding: "20px 22px" }}>
            <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>
              Content hash of the after photograph
            </div>
            <p
              style={{
                marginTop: 10,
                font: "500 12px var(--mono)",
                color: "var(--dim)",
                wordBreak: "break-all",
              }}
            >
              {task.contentHash}
            </p>
            <p
              style={{
                marginTop: 10,
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.6,
              }}
            >
              Stored on chain and matched against every later submission, so the
              same file cannot be paid for twice
            </p>
          </section>
        ) : null}
      </div>

      {task.phash ? (
        <section className="panel panel-2" style={{ padding: "20px 22px", marginTop: 14 }}>
          <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>
            Perceptual hash - recorded, not decisive
          </div>
          <p style={{ marginTop: 10, font: "500 12px var(--mono)", color: "var(--dim)" }}>
            {task.phash}
          </p>
          <p style={{ marginTop: 10, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            Kept so this photograph can be compared with any other. Reuse is
            caught by the challenge code, which a recycled frame cannot carry
          </p>
        </section>
      ) : null}

      {paid ? (
        <div style={{ marginTop: 14 }}>
          <SettlementNotice />
        </div>
      ) : null}

      <div
        className="spread"
        style={{ marginTop: 24, flexWrap: "wrap" }}
      >
        <Link href="/map" className="btn" style={{ height: 48, padding: "0 22px" }}>
          Find work like this
        </Link>
        <Link
          href="/how-it-works"
          className="eyebrow"
          style={{ letterSpacing: "0.1em", fontSize: 12 }}
        >
          How this was judged
        </Link>
      </div>
    </article>
  );
}
