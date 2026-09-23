import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Request founding-family beta access",
  description: "Request owner-approved complimentary beta access for your real household plan. No payment or marketing subscription required.",
  alternates: { canonical: "/request-access" },
  robots: { index: true, follow: true },
};

export default function RequestAccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
