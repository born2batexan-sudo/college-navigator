export type AskLauncherDestination = { href: "/ask" | "/ask/research"; label: string };

/** Route context, not session inference: never expose household research from public/unfinished flows. */
export function askLauncherForPath(pathname: string): AskLauncherDestination | null {
  if (["/", "/sample-plan", "/login", "/onboarding", "/account", "/account/mail-privacy"].includes(pathname)) {
    return { href: "/ask", label: "Ask about Campus Passage" };
  }
  if (["/dashboard", "/welcome", "/intake", "/request", "/feedback"].includes(pathname)
      || /^\/(action|school)\/[^/]+$/.test(pathname)) {
    return { href: "/ask/research", label: "Ask about your journey" };
  }
  // Ask pages, admin/demo/technical routes and unknown paths do not get a redundant launcher.
  return null;
}
