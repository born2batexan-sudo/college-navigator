"use server";

import { headers } from "next/headers";
import { submitDemoAccessRequest } from "@/lib/db/demo-access";

export type RequestAccessState = { submitted: boolean; error: string | null };

/** Public action: every valid, duplicate, and throttled submission gets the same acknowledgement. */
export async function requestDemoAccess(_previous: RequestAccessState, formData: FormData): Promise<RequestAccessState> {
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const consent = formData.get("consent") === "on";
  const honeypot = String(formData.get("website") ?? "");
  if (!consent) return { submitted: false, error: "Please confirm that we may use your details to review this request." };
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ipAddress = forwarded || h.get("x-real-ip") || null;
    await submitDemoAccessRequest({ name, email, ipAddress, honeypot });
    return { submitted: true, error: null };
  } catch {
    // Do not echo validation, duplicate, rate-limit, or account state details.
    return { submitted: false, error: "We could not record that request right now. Please try again later." };
  }
}
