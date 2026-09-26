import { notFound } from "next/navigation";
import { ReviewLab } from "./ReviewLab";
import { requireDemoOwner } from "@/lib/auth/session";
import { reviewLabEnabled } from "@/lib/auth/env";

export const dynamic = "force-dynamic";

/**
 * Intentionally separate from customer previews. The proxy signs every visitor
 * in first; this route then fail-closes unless the server flag and review-owner
 * email guard both pass.
 */
export default async function ReviewLabPage() {
  if (!reviewLabEnabled) notFound();
  await requireDemoOwner();
  return <ReviewLab />;
}
