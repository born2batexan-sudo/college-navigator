import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CampusPassage — a calmer plan after applications are submitted",
  description: "CampusPassage gives families one calm, source-conscious household plan for the college work that follows submitted applications.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
