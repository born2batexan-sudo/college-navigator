import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Request private-preview access",
  description: "Request consideration for a read-only Campus Passage private preview of a shared post-application family plan.",
  alternates: { canonical: "/request-access" },
  robots: { index: true, follow: true },
};

export default function RequestAccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
