import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false, nocache: true },
};

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-ink/50">Campus Passage</p>
      <h1 className="font-display text-3xl font-semibold text-ink">Page not found</h1>
      <p className="max-w-prose text-ink/70">That page may have moved, or the address may be incorrect.</p>
      <Link href="/" className="w-fit rounded-md bg-accent px-4 py-2 font-medium text-white underline-offset-4 hover:underline">
        Return to the homepage
      </Link>
    </main>
  );
}
