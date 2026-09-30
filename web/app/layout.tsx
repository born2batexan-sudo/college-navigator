import type { Metadata } from "next";
import { Epilogue, Inter } from "next/font/google";
import "./globals.css";

// Epilogue 600 is loaded (self-hosted from Google Fonts at build) for the logo wordmark ONLY.
const epilogue = Epilogue({ subsets: ["latin"], weight: "600", display: "swap", variable: "--font-epilogue" });
// Inter 400/500/600 is self-hosted at build and applied only to marketing pages.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL("https://www.campuspassage.com"),
  title: {
    default: "Your College Journey Tracker",
    template: "%s | Campus Passage",
  },
  description: "Track college application deadlines, verified next steps, financial aid dates, and move-in planning in one plan per student. Built for parents. No portal passwords.",
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
    title: "Be their parent, not their project manager.",
    description: "One clear plan per student, from first look to move-in. Up to 144 checks per school. No portal passwords.",
  },
  twitter: {
    card: "summary",
    title: "Be their parent, not their project manager.",
    description: "One clear plan per student, from first look to move-in. Up to 144 checks per school. No portal passwords.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${epilogue.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
