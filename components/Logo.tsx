/* The mark: camera brackets around a location pin.
   The brackets say framing, the pin says place, which are the two things every
   submission has to get right. No gradient, no second hue, no outline version,
   no shadow. */

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* framing brackets */}
      <path
        d="M2 7.6V3.6A1.6 1.6 0 0 1 3.6 2h4M16.4 2h4A1.6 1.6 0 0 1 22 3.6v4M22 16.4v4a1.6 1.6 0 0 1-1.6 1.6h-4M7.6 22h-4A1.6 1.6 0 0 1 2 20.4v-4"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* location pin */}
      <path
        d="M12 6.6c-2.35 0-4.25 1.87-4.25 4.18 0 3.02 3.42 6.3 4.02 6.85a.34.34 0 0 0 .46 0c.6-.55 4.02-3.83 4.02-6.85 0-2.31-1.9-4.18-4.25-4.18Z"
        fill="currentColor"
      />
      <circle cx="12" cy="10.7" r="1.5" fill="var(--panel, #fff)" />
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <span
      className="row"
      style={{ gap: 8, color: "var(--accent)" }}
      aria-label="Fieldwork"
    >
      <Mark size={size} />
      <span
        style={{
          color: "var(--ink)",
          fontWeight: 700,
          fontSize: size,
          /* all lowercase, bold, tight tracking, never letterspaced */
          letterSpacing: "-0.035em",
          lineHeight: 1,
        }}
      >
        fieldwork
      </span>
    </span>
  );
}
