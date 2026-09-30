"use server";

import { requireDemoOwner } from "@/lib/auth/session";
import { searchAdminHouseholds, type AdminHouseholdLookupRecord } from "@/lib/db/admin-households";

export type HouseholdLookupState = {
  query: string;
  results: AdminHouseholdLookupRecord[];
  searched: boolean;
  error: string | null;
};

/** Search is a server action so search terms containing personal data are not placed in the URL. */
export async function lookupHouseholds(
  _previousState: HouseholdLookupState,
  formData: FormData,
): Promise<HouseholdLookupState> {
  await requireDemoOwner();
  const query = String(formData.get("query") ?? "").trim();
  if (query.length < 2) return { query, results: [], searched: false, error: "Enter at least two characters." };
  if (query.length > 120) return { query: "", results: [], searched: false, error: "Search terms must be 120 characters or fewer." };

  try {
    return { query, results: await searchAdminHouseholds(query), searched: true, error: null };
  } catch {
    // Do not disclose SQL, account details, or environment configuration in an error response.
    return { query, results: [], searched: false, error: "The account lookup is temporarily unavailable." };
  }
}
