"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* The design marks the current section in the accent colour rather than with an
   underline, so the nav reads as an instrument panel. */

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link href={href} data-active={active ? "true" : undefined}>
      {children}
    </Link>
  );
}
