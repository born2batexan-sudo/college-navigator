import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.campuspassage.com"),
  title: {
    default: "Campus Passage — Protect the opportunity.",
    template: "%s | Campus Passage",
  },
  description: "Campus Passage connects what schools, sponsors, and vendors publish to your family's own plan—so the next meaningful step is clear. Explore a fictional, read-only example from interest to move-in.",
  alternates: { canonical: "/" },
  applicationName: "Campus Passage",
  keywords: [
    "what to do after submitting college applications",
    "college application next steps",
    "college deadline tracker for families",
    "financial aid and scholarship awareness for families",
    "college billing and 529 questions",
    "multi-student college household plan",
  ],
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Campus Passage",
    title: "Protect the opportunity.",
    description: "A clearer next step for your family's college journey, from interest to move-in. Explore a fictional, read-only sample.",
  },
  twitter: {
    card: "summary",
    title: "Campus Passage — Protect the opportunity.",
    description: "A clearer next step for your family's college journey. Explore a fictional, read-only sample plan.",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
