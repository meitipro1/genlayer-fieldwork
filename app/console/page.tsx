import type { Metadata } from "next";
import Link from "next/link";
import { PostTaskForm } from "@/components/PostTaskForm";
import { fetchTasks, statsFrom } from "@/lib/onchain";

export const revalidate = 5;

export const metadata: Metadata = { title: "Poster console" };

/* Let a poster run a campaign of many tasks.

   The design keeps the form in a fixed right rail so it stays put while the
   poster reads coverage and assurance on the left. Posting is the whole point
   of this screen, so it never scrolls out of reach. */

function Assurance({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel panel-2" style={{ padding: 20 }}>
      <div
        className="eyebrow eyebrow-accent"
        style={{ fontWeight: 700, letterSpacing: "0.14em" }}
      >
        {title}
      </div>
      <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.6, color: "var(--dim)" }}>
        {children}
      </p>
    </div>
  );
}

export default async function ConsolePage() {
  const tasks = await fetchTasks();
  const stats = statsFrom(tasks, Date.now());
  // Money still locked in the contract, not everything ever spent. A settled
  // task's reward has left, so counting it as "committed" overstated what the
  // poster still has at stake.
  const committed = stats.committedGen;

  return (
    <>
      <div style={{ maxWidth: "var(--wrap)", margin: "0 auto", padding: "36px 30px 0" }}>
        <div className="eyebrow eyebrow-accent">Poster console</div>
        <h1 style={{ fontSize: 42, marginTop: 14 }}>Run a campaign</h1>
        <p className="lede" style={{ marginTop: 14, maxWidth: "60ch" }}>
          A task cannot be funded without an acceptance test, a pass example, a
          fail example and a photograph of how the place looks now - those rules
          are enforced by the contract and not by this form
        </p>

        <div
          className="facts"
          style={{ gridTemplateColumns: "repeat(4,1fr)", marginTop: 28 }}
        >
          <div>
            <div style={{ font: "700 28px var(--mono)", letterSpacing: "-0.02em" }}>
              {tasks.length}
            </div>
            <div className="stat-label">Tasks posted</div>
          </div>
          <div>
            <div
              style={{
                font: "700 28px var(--mono)",
                letterSpacing: "-0.02em",
                color: "var(--accent)",
              }}
            >
              {committed} GEN
            </div>
            <div className="stat-label">Locked in tasks</div>
          </div>
          <div>
            <div style={{ font: "700 28px var(--mono)", letterSpacing: "-0.02em" }}>
              {stats.paidShare === null ? "-" : `${stats.paidShare}%`}
            </div>
            <div className="stat-label">Settled as paid</div>
          </div>
          <div>
            <div style={{ font: "700 28px var(--mono)", letterSpacing: "-0.02em" }}>
              {stats.rejected}
            </div>
            <div className="stat-label">Rejected</div>
          </div>
        </div>
      </div>

      <div className="console-split">
        <div>
          <h2 style={{ fontSize: 24 }}>Assurance</h2>
          <div className="grid-2" style={{ marginTop: 14 }}>
            <Assurance title="You own the before frame">
              The starting state comes from you and not from the person being
              paid, so nobody can stage a mess and then clear it - and the worker
              can see what they are being measured against before they walk
              anywhere
            </Assurance>
            <Assurance title="Reuse detection">
              Every accepted photograph&apos;s content hash is stored on chain -
              a recycled photograph also carries the wrong challenge code, which
              is what actually catches it
            </Assurance>
            <Assurance title="Pre-flight checks">
              Your before photograph is opened while you post and the
              worker&apos;s before a grader is paid for - unopenable or
              undersized frames are refused for the price of a decode, so a task
              can never be funded with a frame nobody could grade
            </Assurance>
            <Assurance title="Every judgement is public">
              Both photographs, the exact text they were graded against and the
              three judgements are published on a receipt anyone can open - a
              verdict that can be checked beats one somebody promises to review
            </Assurance>
          </div>

          <p style={{ color: "var(--muted)", marginTop: 24, fontSize: 14 }}>
            <Link
              href="/how-it-works"
              style={{ color: "var(--accent)", fontWeight: 700 }}
            >
              How a photograph settles →
            </Link>
          </p>
        </div>

        <PostTaskForm />
      </div>
    </>
  );
}
