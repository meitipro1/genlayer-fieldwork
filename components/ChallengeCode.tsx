/* Six characters, displayed large, with instructions to keep it in frame.
   The alphabet has no I, L, O, U, 0 or 1, because this is written by hand on a
   scrap of paper and read back by a vision model.

   The design gives this the only gradient on the site: it is the one thing on
   the screen the worker has to carry out into the world with them. */

export function ChallengeCode({ code }: { code: string }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: "1px solid var(--accent-line)",
        background: "linear-gradient(180deg,var(--accent-soft),transparent)",
        padding: 22,
        textAlign: "center",
        boxShadow: "0 18px 40px var(--glow)",
      }}
    >
      <div className="eyebrow">Your code for this claim</div>
      <div
        style={{
          font: "800 46px var(--mono)",
          letterSpacing: "0.18em",
          color: "var(--accent)",
          margin: "10px 0 6px",
        }}
      >
        {code}
      </div>
      <p style={{ color: "var(--dim)", fontSize: 13.5 }}>
        Write it on paper and keep it in frame in the photograph you take
      </p>
    </div>
  );
}
