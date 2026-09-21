import Link from "next/link";
import type { Metadata } from "next";
import { formatWindow, isClaimable, shortWindow } from "@/lib/tasks";
import { fetchTasks } from "@/lib/onchain";

export const revalidate = 5;

export const metadata: Metadata = { title: "Find work" };

/* Get a worker to a task they can reach today.

   There was a plot here, drawn from lat/lng on each task. Those are gone: they
   were an example pair nobody changed, so every task drew on the same point and
   the distance column read "-" on every row. The place, in words, is what
   actually gets someone there. */

export default async function MapPage() {
  const all = await fetchTasks();
  const now = Date.now();
  // Not `status === "open"`. A task whose deadline has passed stays open on
  // chain until somebody sends the transaction that closes it, so filtering on
  // the status alone advertises work nobody is allowed to take.
  const open = all.filter((t) => isClaimable(t, now));

  return (
    <div style={{ maxWidth: "var(--wrap)", margin: "0 auto", padding: "40px 30px 0" }}>
      <div className="eyebrow eyebrow-accent">Find work</div>
      <h1 style={{ fontSize: 42, marginTop: 14 }}>Open tasks</h1>
      <p className="lede" style={{ marginTop: 14 }}>
        Read the acceptance test before you claim - each task says how long a
        claim lasts, and a rejection can be retaken inside that same window
      </p>

      {open.length > 0 ? (
        <>
          <div className="grid-3" style={{ marginTop: 24 }}>
            {open.slice(0, 6).map((t) => (
              <Link key={t.id} href={`/task/${t.id}`} className="card card-tight">
                <div className="spread">
                  <span className="eyebrow" style={{ letterSpacing: "0.14em" }}>
                    task {t.id}
                  </span>
                  <span style={{ font: "700 17px var(--mono)", color: "var(--accent)" }}>
                    {t.reward} GEN
                  </span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15.5, marginTop: 10 }}>
                  {t.title}
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 5 }}>
                  {t.place}
                </div>
                <div
                  style={{
                    font: "500 11px var(--mono)",
                    color: "var(--muted)",
                    marginTop: 12,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {shortWindow(t.claimMinutes)} on claim
                  {t.fixedCode ? " - test task" : ""}
                </div>
              </Link>
            ))}
          </div>

          <div className="ledger" style={{ marginTop: 18 }}>
            <div className="ledger-row ledger-head">
              <span>Task</span>
              <span>Where</span>
              <span>Reward</span>
              <span>Window</span>
            </div>
            {open.map((t) => (
              <div key={t.id} className="ledger-row">
                <Link href={`/task/${t.id}`} style={{ fontWeight: 700 }}>
                  {t.title}
                </Link>
                <span data-label="Where" style={{ fontSize: 13.5, color: "var(--muted)" }}>
                  {t.place}
                </span>
                <span data-label="Reward" style={{ font: "700 15px var(--mono)" }}>
                  {t.reward} GEN
                </span>
                <span
                  data-label="Window"
                  style={{ font: "500 12px var(--mono)", color: "var(--muted)" }}
                >
                  {formatWindow(t, now)}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="card-dashed" style={{ marginTop: 24 }}>
          Nothing open right now - this list reads the contract directly
        </div>
      )}
    </div>
  );
}
