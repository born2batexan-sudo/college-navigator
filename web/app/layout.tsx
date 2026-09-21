import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.campuspassage.com"),
  title: {
    default: "CampusPassage — a calmer plan after college applications are submitted",
    template: "%s | CampusPassage",
  },
  description: "CampusPassage helps families organize the college steps after applications are submitted with a calm, shared plan for what matters next, who must act, and what is still waiting on a school.",
  alternates: { canonical: "/" },
  applicationName: "CampusPassage",
  keywords: [
    "what to do after submitting college applications",
    "college application next steps",
    "college deadline tracker for families",
    "post application college checklist",
  ],
  openGraph: {
    type: "website",
    url: "/",
    siteName: "CampusPassage",
    title: "A calmer plan after college applications are submitted",
    description: "One shared family plan for the deadlines, confirmations, and next steps that follow college application submission.",
  },
  twitter: {
    card: "summary",
    title: "CampusPassage — a calmer post-submit plan",
    description: "See what matters next, who must act, and what is still waiting on a school.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
