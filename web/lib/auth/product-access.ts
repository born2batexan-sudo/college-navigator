import { queryOne } from "@/lib/db/client";
import { isDemoOwnerEmail } from "@/lib/db/accounts";

/** Server-side, per-request authorization. Authentication or a household link alone is not access. */
export async function hasProductAccess(user: { id: string; email: string | null }, householdId: string): Promise<boolean> {
  // An entitlement belongs to a household, not to any signed-in user who knows its ID.
  // Check the live auth link even for the owner override; callers must not rely on a
  // client-selected household or an earlier/stale context as proof of membership.
  if (!await queryOne("SELECT 1 AS ok FROM auth_links WHERE auth_user_id=$1 AND household_id=$2", [user.id, householdId])) return false;
  if (isDemoOwnerEmail(user.email)) return true;
  const now = new Date().toISOString();
  const entitlement = await queryOne(`SELECT 1 AS ok FROM cycle_entitlements e
    JOIN cycle_orders o ON o.id=e.order_id AND o.household_id=e.household_id
    WHERE e.household_id=$1 AND e.starts_at<=$2 AND e.expires_at>$3 AND e.revoked_at IS NULL
      AND ((e.kind='complimentary' AND o.kind='complimentary' AND o.status='complimentary')
        OR (e.kind='paid' AND o.kind='paid' AND o.status='paid')) LIMIT 1`, [householdId, now, now]);
  if (entitlement) return true;

  // Invitation acceptance is only an onboarding grant, never product access.
  return false;
}
