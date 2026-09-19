import { notFound } from "next/navigation";

// Retired temporary diagnostic page. Inert stub; safe to delete.
export const dynamic = "force-dynamic";

export default function DebugPageCheck() {
  notFound();
}
