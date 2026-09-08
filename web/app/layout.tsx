import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "College Navigator",
  description: "One household. One action plan. Every school still in play.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</div>
      </body>
    </html>
  );
}
