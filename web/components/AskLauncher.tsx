"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { askLauncherForPath } from "@/lib/ask-launcher";

/** A navigation link, not an in-page chat session: Ask opens its own full, accessible route. */
export default function AskLauncher() {
  const destination = askLauncherForPath(usePathname());
  if (!destination) return null;

  return (
    <aside className="ask-launcher" aria-label="Ask Campus Passage shortcut">
      <Link className="ask-launcher-link" href={destination.href} aria-label={destination.label}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="23" height="23" focusable="false">
          <path d="M20 11.5a8 8 0 0 1-8 8 8.5 8.5 0 0 1-3.7-.85L4 20l1.3-4.3A8 8 0 1 1 20 11.5Z" />
          <path d="M8.5 11.5h7" />
        </svg>
        <span aria-hidden="true">Ask</span>
      </Link>
    </aside>
  );
}
