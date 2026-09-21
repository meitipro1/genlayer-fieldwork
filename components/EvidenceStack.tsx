/* The hero object: an acceptance test, the two photographs and the verdict,
   stacked in depth in the order the contract sees them.

   The plate underneath is the task, each
   card floats a little further off it, and the payment sits highest because it
   is the last thing to happen. On hover the whole stack eases up towards the
   viewer over .7s, which is the only place on the site depth is spent. */

const LAYER = {
  position: "absolute" as const,
  borderRadius: 12,
  background: "var(--panel)",
  boxShadow: "0 30px 60px var(--shadow)",
};

export function EvidenceStack({
  code = "K73QXB",
  acceptanceTest = "The bin area is empty - no bags against the wall - both bins upright with lids closed",
  reward = 18,
  beforeSrc = "/samples/bins-before.svg",
  afterSrc = "/samples/bins-after.svg",
}: {
  code?: string;
  acceptanceTest?: string;
  reward?: number;
  beforeSrc?: string;
  afterSrc?: string;
}) {
  return (
    <div
      className="evidence-stack"
      style={{ perspective: 1300, perspectiveOrigin: "60% 40%" }}
      aria-label="A task, its two photographs and the payment, stacked in depth"
    >
      <div className="evidence-stack-inner">
        {/* the task itself, flat on the ground */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 14,
            border: "1px solid var(--accent-line)",
            background: "var(--accent-soft)",
          }}
        />

        {/* the standard, written before anyone walks anywhere */}
        <div
          style={{
            ...LAYER,
            inset: 0,
            borderRadius: 14,
            border: "1px solid var(--line2)",
            transform: "translateZ(46px)",
            padding: 16,
          }}
        >
          <div className="eyebrow">Acceptance test</div>
          <p
            style={{
              marginTop: 9,
              fontSize: 12.5,
              lineHeight: 1.55,
              color: "var(--dim)",
            }}
          >
            {acceptanceTest}
          </p>
          <div
            style={{
              marginTop: 14,
              font: "700 22px var(--mono)",
              letterSpacing: "0.2em",
              color: "var(--accent)",
            }}
          >
            {code}
          </div>
        </div>

        {/* the poster's frame */}
        <div
          style={{
            ...LAYER,
            width: 180,
            overflow: "hidden",
            border: "1px solid var(--line2)",
            transform: "translateZ(102px) translate(-6px,26px)",
          }}
        >
          <div className="eyebrow" style={{ padding: "8px 10px 4px", fontSize: 9.5 }}>
            Before
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={beforeSrc} alt="Before the work" style={{ width: "100%", display: "block" }} />
        </div>

        {/* the worker's frame */}
        <div
          style={{
            ...LAYER,
            width: 180,
            overflow: "hidden",
            border: "1px solid var(--accent-line)",
            boxShadow: "0 34px 68px var(--shadow)",
            transform: "translateZ(164px) translate(112px,120px)",
          }}
        >
          <div className="eyebrow" style={{ padding: "8px 10px 4px", fontSize: 9.5 }}>
            After
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={afterSrc} alt="After the work" style={{ width: "100%", display: "block" }} />
        </div>

        {/* the verdict, on top because it is last */}
        <div
          style={{
            position: "absolute",
            borderRadius: 999,
            background: "var(--accent)",
            color: "var(--accent-ink)",
            padding: "11px 18px",
            font: "800 12px var(--mono)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            boxShadow: "0 30px 60px var(--glow)",
            transform: "translateZ(226px) translate(150px,-30px)",
          }}
        >
          Paid - {reward} GEN
        </div>
      </div>
    </div>
  );
}
