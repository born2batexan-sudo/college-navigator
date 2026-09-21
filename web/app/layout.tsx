import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-ibm-plex-sans", display: "swap" });

export const metadata: Metadata = {
  title: "UVOYANT",
  description: "One household. One action plan. Every school still in play.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${plex.variable} min-h-screen antialiased`}>
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-9">{children}</div>
      </body>
    </html>
  );
}
