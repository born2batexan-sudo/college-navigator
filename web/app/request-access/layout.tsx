import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Request Founding-Family Access",
  description: "Request founding-family access to Campus Passage. Submitting the form does not purchase access or subscribe you to marketing.",
  alternates: { canonical: "/request-access" },
  robots: { index: false, follow: false },
};

export default function RequestAccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
