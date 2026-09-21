"use client";

import { useEffect, useState } from "react";

export const THEME_KEY = "fw-theme";

/**
 * Runs in <head> before first paint.
 *
 * Without it, a dark-theme visitor gets a white flash on every navigation.
 * It always writes an explicit data-fw, so the stylesheet only ever needs
 * [data-fw] selectors and can never disagree with the media query.
 */
export const THEME_BOOT = `(function(){try{
var s=localStorage.getItem(${JSON.stringify(THEME_KEY)});
if(s!=="light"&&s!=="dark"){s=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}
document.documentElement.setAttribute("data-fw",s);
}catch(e){document.documentElement.setAttribute("data-fw","dark");}})();`;

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // Read what the boot script already decided, rather than guessing again.
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-fw");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  // Follow the system only while the visitor has not chosen for themselves.
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(THEME_KEY)) return;
      } catch {
        return;
      }
      const next: Theme = e.matches ? "light" : "dark";
      document.documentElement.setAttribute("data-fw", next);
      setTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-fw", next);
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // a visitor with storage blocked still gets the switch for this page
    }
  }

  // Render nothing until the client has read the real theme, so the button
  // never claims the wrong one for a frame.
  if (theme === null) {
    return <span style={{ width: 42, height: 36, display: "inline-block" }} aria-hidden />;
  }

  return (
    <button
      type="button"
      className="btn-mono"
      style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      <span className="hide-sm">{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      <path
        d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.4A8.4 8.4 0 0 1 9.6 4a8.4 8.4 0 1 0 10.4 10.4Z"
        fill="currentColor"
      />
    </svg>
  );
}
