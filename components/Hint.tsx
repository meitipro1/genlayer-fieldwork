"use client";

import { useState } from "react";

/* A label with its explanation folded away behind it.

   Every field here used to carry a paragraph underneath, and a form of nine
   fields was mostly prose. The rule now: a small button, and six words. */

export function Hint({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  /** Six words. If it needs more, the field name is wrong. */
  children: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`What is ${label}`}
          title={children}
          style={{
            width: 16,
            height: 16,
            flex: "0 0 auto",
            borderRadius: 999,
            border: "1px solid var(--line2)",
            background: open ? "var(--accent)" : "transparent",
            color: open ? "var(--accent-ink)" : "var(--muted)",
            font: "700 10px var(--mono)",
            lineHeight: 1,
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            padding: 0,
          }}
        >
          ?
        </button>
        <label htmlFor={htmlFor} style={{ margin: 0 }}>
          {label}
        </label>
      </div>
      {open ? (
        <p
          className="muted"
          style={{ margin: "6px 0 7px", fontSize: 12.5, lineHeight: 1.5 }}
        >
          {children}
        </p>
      ) : (
        <div style={{ height: 7 }} />
      )}
    </>
  );
}
