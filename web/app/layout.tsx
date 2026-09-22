import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.campuspassage.com"),
  title: {
    default: "CampusPassage — protect the college opportunity, reduce the noise",
    template: "%s | CampusPassage",
  },
  description: "CampusPassage inspects official public college and vendor sources, filters out irrelevant noise, and organizes financial aid, scholarship, billing/529, and school-update information into one household plan — before, during, and after applications, across every student and school. A private-preview, read-only concept.",
  alternates: { canonical: "/" },
  applicationName: "CampusPassage",
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
    siteName: "CampusPassage",
    title: "Protect the college opportunity. Reduce the noise.",
    description: "One shared household plan for official-source college, financial-aid, scholarship, and billing information — before, during, and after applications.",
  },
  twitter: {
    card: "summary",
    title: "CampusPassage — protect the opportunity, reduce the noise",
    description: "See official-source college, aid, scholarship, and billing information organized into one calm household plan — across every student, every school.",
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
