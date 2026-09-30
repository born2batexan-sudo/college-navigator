"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Primary navigation. At 900px and below everything except the logo and the Start Now button collapses
 * into a menu toggle (button with aria-expanded). Escape closes the menu and returns focus to the toggle.
 * Nav order follows the approved mockup: Overview, How it works, 12² Standard, Sample plan, Trust, Log in.
 */
export default function HeaderNav({ current }: { current: "overview" | "sample" }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="topbar-nav">
      <nav id="primary-nav" className="navlinks" data-open={open ? "true" : "false"} aria-label="Primary navigation">
        <Link aria-current={current === "overview" ? "page" : undefined} href="/" onClick={close}>Overview</Link>
        <Link href="/#how" onClick={close}>How it works</Link>
        <Link href="/#standard" onClick={close}>12² Standard</Link>
        <Link aria-current={current === "sample" ? "page" : undefined} href="/sample-plan" onClick={close}>Sample plan</Link>
        <Link href="/#trust" onClick={close}>Trust</Link>
        <Link href="/login?next=%2Fdashboard" className="login-link" onClick={close}>Log in</Link>
      </nav>
      <Link href="/login?next=%2Fonboarding" className="nav-cta">Start Now</Link>
      <button ref={toggle} type="button" className="nav-toggle" aria-expanded={open} aria-controls="primary-nav" onClick={() => setOpen((value) => !value)}>
        <span className="nav-toggle-bars" aria-hidden="true" />
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
    </div>
  );
}
