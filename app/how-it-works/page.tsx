import type { Metadata } from "next";
import Link from "next/link";
import { IS_STUDIO } from "@/lib/chain";

export const metadata: Metadata = {
  title: "How verification works",
  description:
    "The written standard, the challenge code, the same place check and independent graders who must agree before a coin moves.",
};

/* The design numbers these, which is the point: a numbered list reads as a
   specification. */

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel panel-2" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
        <span style={{ font: "700 11px var(--mono)", color: "var(--accent)" }}>
          {n}
        </span>
        <h3 style={{ fontSize: 19 }}>{title}</h3>
      </div>
      <div>{children}</div>
    </section>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        marginTop: 12,
        fontSize: 14.5,
        lineHeight: 1.65,
        color: "var(--dim)",
      }}
    >
      {children}
    </p>
  );
}

export default function HowItWorksPage() {
  let n = 0;
  const next = () => String(++n).padStart(2, "0");

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "36px 30px 0" }}>
      <div className="eyebrow eyebrow-accent">The verification design</div>
      <h1 style={{ fontSize: 42, marginTop: 14 }}>How a photograph settles</h1>
      <p className="lede" style={{ marginTop: 14 }}>
        Six mechanisms, all of them in the contract and all of them running on
        every submission - each one closes a specific way that paying for
        physical work goes wrong
      </p>

      <div style={{ marginTop: 22 }}>
        <Section n={next()} title="The standard is frozen before anyone spends time">
          <Para>
            The acceptance test is written when the task is funded, published on
            the task page, and is the exact text handed to the graders. Nobody
            can move the bar after the work is done
          </Para>
          <Para>
            A model reads it first and refuses a test too vague to grade from a
            photograph, before a single coin is committed. A test that leans on
            words like clean or tidy without saying what those look like never
            becomes a task at all
          </Para>
        </Section>

        <Section n={next()} title="The before frame belongs to whoever is paying">
          <Para>
            The poster photographs the place when they fund the task. A worker
            who supplies both frames can shove the bags into shot, clear them,
            and be paid for work nobody needed - taking that frame at posting
            time removes the whole class of fraud
          </Para>
          <Para>
            It also gives the worker the better half of the deal. They can see
            the exact state they are measured against before they walk anywhere
          </Para>
        </Section>

        <Section n={next()} title="The challenge code cannot be known in advance">
          <Para>
            The contract issues a six character code when someone claims,
            derived from the task, the worker and the moment. It must be legible
            in the photograph they take
          </Para>
          <Para>
            That is what proves the frame was shot after the claim. A photograph
            recycled from last month carries the wrong code, and the grader is
            already looking for it. The alphabet drops I, L, O, U, 0 and 1,
            because this is written by hand and read back by a machine
          </Para>
        </Section>

        <Section n={next()} title="Every validator grades identical bytes">
          <Para>
            Photographs go into content addressed storage before the transaction
            is sent, so the url is derived from the file itself. The contract
            refuses any other kind of url
          </Para>
          <Para>
            A mutable link would let the leader and the validators grade two
            different photographs, which would make the whole thing theatre
          </Para>
        </Section>

        <Section n={next()} title="No single party decides">
          <Para>
            Independent validators fetch the same two photographs and grade them
            against the same written text. They reach their own verdicts and the
            verdicts are compared - a validator is never asked simply to bless
            the leader&apos;s answer
          </Para>
          <Para>
            All of them must agree on three things before a coin moves: the code
            is legible, both frames show the same place, and the acceptance test
            passed. Not the poster, not one model, not one node
          </Para>
        </Section>

        <Section n={next()} title="Nothing costs the worker a wasted trip">
          <Para>
            The contract opens the photograph and checks it before it pays for a
            grader. Unopenable, or too small for a six character code to be
            legible, and it comes straight back with an instruction rather than
            a verdict
          </Para>
          <Para>
            A rejection does not cost the claim either. Most failures are
            lighting and framing, so the task stays with the worker and they can
            retake it inside the same window. And the poster cannot withdraw a
            task out from under someone who is still holding it
          </Para>
        </Section>

        <Section n={next()} title="The judgement is public, on purpose">
          <Para>
            Every settled task leaves a page carrying both photographs, the exact
            text they were graded against, the three judgements and the reason
            the worker was given. Rejections are published beside payments
          </Para>
          <Para>
            A verdict anyone can check against the evidence is a stronger thing
            than a verdict somebody promises to review
          </Para>
        </Section>

        {IS_STUDIO ? (
          <Section n={next()} title="This deployment runs on a development network">
            <Para>
              The grading, the verdict and the receipt are all real here. The
              transfer is not: on GenLayer&apos;s Studio network a payout is
              delivered as a contract call, and an ordinary wallet is not a
              contract, so the balance does not move. The verdict is final
              before the transfer is even attempted, so it stands either way
            </Para>
            <Para>
              Said plainly because someone doing real work should know which
              network they are on. On a live network the same transaction pays
            </Para>
          </Section>
        ) : null}
      </div>

      <p style={{ color: "var(--muted)", marginTop: 24, fontSize: 14 }}>
        Every one of these has settled a real task -{" "}
        <Link href="/receipts" style={{ color: "var(--accent)", fontWeight: 700 }}>
          read the receipts
        </Link>
      </p>
    </div>
  );
}
