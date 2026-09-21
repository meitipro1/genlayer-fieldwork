import Link from "next/link";
import type { Metadata } from "next";
import { fetchTasks } from "@/lib/onchain";
import { formatStamp } from "@/lib/tasks";

export const revalidate = 5;

export const metadata: Metadata = {
  title: "Receipts",
  description:
    "Every settled task, paid or rejected, with the photographs and the text it was graded against.",
};

/* The nav promises a receipts section, so here it is: every settled task rather
   than the three the home page has room for. Rejections are listed beside
   payments on purpose - a wall of only successes is not evidence of anything. */

export default async function ReceiptsPage() {
  const all = await fetchTasks();
  const settled = all.filter(
    (t) => t.status === "paid" || t.status === "rejected"
  );
  const paid = settled.filter((t) => t.status === "paid");

  return (
    <div style={{ maxWidth: "var(--wrap)", margin: "0 auto", padding: "36px 30px 0" }}>
      <div className="eyebrow eyebrow-accent">Public receipts</div>
      <h1 style={{ fontSize: 42, marginTop: 14 }}>Everything that settled</h1>
      <p className="lede" style={{ marginTop: 14, maxWidth: "62ch" }}>
        Each one carries both photographs, the text it was graded against, the
        three judgements and the reason the worker was given - rejections
        published beside payments, so this is a record you can check rather
        than one you have to trust
      </p>

      {settled.length > 0 ? (
        <>
          <div className="facts" style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: 28 }}>
            <div>
              <div style={{ font: "700 28px var(--mono)", letterSpacing: "-0.02em" }}>
                {settled.length}
              </div>
              <div className="stat-label">Settled</div>
            </div>
            <div>
              <div
                style={{
                  font: "700 28px var(--mono)",
                  letterSpacing: "-0.02em",
                  color: "var(--accent)",
                }}
              >
                {paid.length}
              </div>
              <div className="stat-label">Paid</div>
            </div>
            <div>
              <div style={{ font: "700 28px var(--mono)", letterSpacing: "-0.02em" }}>
                {settled.length - paid.length}
              </div>
              <div className="stat-label">Rejected</div>
            </div>
          </div>

          <div className="grid-3" style={{ marginTop: 18 }}>
            {settled.map((t) => (
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
                  <span
                    className={t.status === "paid" ? "pill pill-accent" : "pill pill-danger"}
                  >
                    {t.status}
                  </span>
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
                    {t.gradedAt ? ` - ${formatStamp(t.gradedAt)}` : ""}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="card-dashed" style={{ marginTop: 28, padding: 40 }}>
          The first receipt appears when a task settles
        </div>
      )}
    </div>
  );
}
