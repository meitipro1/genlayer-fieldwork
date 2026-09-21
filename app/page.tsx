import Link from "next/link";
import { EvidenceStack } from "@/components/EvidenceStack";
import { SettlementNotice } from "@/components/SettlementNotice";
import { isClaimable, shortWindow } from "@/lib/tasks";
import { fetchTasks, statsFrom } from "@/lib/onchain";
import { CHAIN_ID, NETWORK } from "@/lib/chain";

export const revalidate = 5;

/* The design, applied in full: a dark instrument panel, the accent kept to
   three jobs, and the evidence stack as the only place depth is spent. */

function TaskCard({
  id,
  title,
  place,
  reward,
  claimMinutes,
  fixedCode,
}: {
  id: number;
  title: string;
  place: string;
  reward: number;
  claimMinutes: number;
  fixedCode?: string;
}) {
  return (
    <Link href={`/task/${id}`} className="card">
      <div className="spread">
        <span
          className="eyebrow"
          style={{ letterSpacing: "0.14em" }}
        >
          Task {id}
        </span>
        <span style={{ font: "700 18px var(--mono)", color: "var(--accent)" }}>
          {reward} GEN
        </span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 17, marginTop: 12 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 6 }}>
        {place}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <span className="pill">{shortWindow(claimMinutes)} on claim</span>
        {fixedCode ? <span className="pill pill-accent">test task</span> : null}
      </div>
    </Link>
  );
}

export default async function HomePage() {
  const all = await fetchTasks();
  const now = Date.now();
  // Through the shared predicate, so the grid below and the "open right now"
  // stat above it can never disagree about what counts as open.
  const open = all.filter((t) => isClaimable(t, now));
  const settled = all.filter((t) => t.status === "paid");
  const stats = statsFrom(all, now);

  // The design shows three receipt slots, filling left to right.
  const slots = [0, 1, 2];

  return (
    <>
      <section className="grid-bg">
        <div
          style={{
            position: "relative",
            maxWidth: "var(--wrap)",
            margin: "0 auto",
            padding: "64px 30px 70px",
          }}
          className="hero-grid"
        >
          <div>
            <span className="pill pill-accent">
              Live on {NETWORK} - chain {CHAIN_ID}
            </span>
            <h1
              style={{
                fontSize: 58,
                margin: "22px 0 0",
                maxWidth: "13ch",
                letterSpacing: "-0.045em",
              }}
            >
              Evidence in - settlement out
            </h1>
            <p
              style={{
                fontSize: 17,
                lineHeight: 1.6,
                color: "var(--dim)",
                maxWidth: "46ch",
                marginTop: 20,
              }}
            >
              One written standard, two photographs and independent graders - the
              verdict and the payment leave the contract as a single transaction
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 30, flexWrap: "wrap" }}>
              <Link href="/console" className="btn btn-primary">
                Post a task
              </Link>
              <Link href="/map" className="btn">
                Find work near me
              </Link>
            </div>
            <div style={{ display: "flex", gap: 36, marginTop: 42, flexWrap: "wrap" }}>
              <div>
                <div className="stat" style={{ color: "var(--accent)" }}>
                  {stats.settled.toLocaleString("en-GB")}
                </div>
                <div className="stat-label">Tasks settled</div>
              </div>
              <div>
                <div className="stat">
                  {stats.paidShare === null ? "-" : `${stats.paidShare}%`}
                </div>
                <div className="stat-label">Settled as paid</div>
              </div>
              <div>
                <div className="stat">{stats.openNow.toLocaleString("en-GB")}</div>
                <div className="stat-label">Open right now</div>
              </div>
            </div>
          </div>

          <EvidenceStack />
        </div>
      </section>

      <section className="wrap" style={{ paddingTop: 52 }}>
        <div className="spread" style={{ alignItems: "flex-end" }}>
          <h2 style={{ fontSize: 28 }}>Open tasks</h2>
          <span
            className="eyebrow"
            style={{ letterSpacing: "0.14em", fontSize: 11 }}
          >
            {open.length} open now
          </span>
        </div>
        {open.length > 0 ? (
          <div className="grid-2" style={{ marginTop: 18 }}>
            {open.slice(0, 4).map((t) => (
              <TaskCard
                key={t.id}
                id={t.id}
                title={t.title}
                place={t.place}
                reward={t.reward}
                claimMinutes={t.claimMinutes}
                fixedCode={t.fixedCode}
              />
            ))}
          </div>
        ) : (
          <div className="card-dashed" style={{ marginTop: 18 }}>
            No open tasks right now
          </div>
        )}
      </section>

      <section className="wrap" style={{ paddingTop: 46 }}>
        <h2 style={{ fontSize: 28 }}>Settled receipts</h2>
        <p
          style={{
            color: "var(--dim)",
            marginTop: 8,
            fontSize: 14.5,
            maxWidth: "62ch",
          }}
        >
          Every settled task leaves a public page carrying both photographs, the
          text it was graded against and the verdict
        </p>
        <div className="grid-3" style={{ marginTop: 18 }}>
          {slots.map((i) => {
            const t = settled[i];
            if (!t) {
              return (
                <div key={i} className="card-dashed">
                  Next receipt appears on settlement
                </div>
              );
            }
            return (
              <Link key={t.id} href={`/proof/${t.id}`} className="card card-media">
                {t.afterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.afterUrl}
                    alt="After the work"
                    style={{
                      width: "100%",
                      display: "block",
                      borderBottom: "1px solid var(--line)",
                    }}
                  />
                ) : null}
                <div style={{ padding: "16px 18px" }}>
                  <span className="pill pill-accent">Paid</span>
                  <div style={{ fontWeight: 700, fontSize: 15.5, marginTop: 12 }}>
                    {t.title}
                  </div>
                  <div
                    style={{
                      font: "500 12px var(--mono)",
                      color: "var(--muted)",
                      marginTop: 7,
                    }}
                  >
                    {t.reward} GEN - task {t.id}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="wrap" style={{ paddingTop: 46 }}>
        <h2 style={{ fontSize: 28 }}>How settlement works</h2>
        <div className="grid-3" style={{ marginTop: 18 }}>
          <div className="panel panel-2">
            <div
              className="eyebrow eyebrow-accent"
              style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.14em" }}
            >
              01 - Standard
            </div>
            <p style={{ marginTop: 11, fontSize: 14, lineHeight: 1.6, color: "var(--dim)" }}>
              The poster writes the acceptance test, photographs how the place
              looks now and funds the task - both are public before anyone spends
              time on site
            </p>
          </div>
          <div className="panel panel-2">
            <div
              className="eyebrow eyebrow-accent"
              style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.14em" }}
            >
              02 - Evidence
            </div>
            <p style={{ marginTop: 11, fontSize: 14, lineHeight: 1.6, color: "var(--dim)" }}>
              A six character code is issued on claim and must be legible in the
              photograph the worker takes - the before frame is already on the
              task
            </p>
          </div>
          <div className="panel panel-2">
            <div
              className="eyebrow eyebrow-accent"
              style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.14em" }}
            >
              03 - Settlement
            </div>
            <p style={{ marginTop: 11, fontSize: 14, lineHeight: 1.6, color: "var(--dim)" }}>
              Independent validators grade the same two images against the same
              text and must agree before a coin moves
            </p>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <SettlementNotice />
        </div>

        <p style={{ color: "var(--muted)", marginTop: 18, fontSize: 14 }}>
          Seven mechanisms stand between a photograph and a payment -{" "}
          <Link
            href="/how-it-works"
            style={{ color: "var(--accent)", fontWeight: 700 }}
          >
            see how verification works
          </Link>
        </p>
      </section>
    </>
  );
}
