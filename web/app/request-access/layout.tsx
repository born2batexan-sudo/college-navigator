import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Start Now",
  description: "Get started with Campus Passage by verifying your email and setting up your household.",
  alternates: { canonical: "/request-access" },
  robots: { index: false, follow: false },
};

export default function RequestAccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
