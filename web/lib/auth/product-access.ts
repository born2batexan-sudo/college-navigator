import { queryOne } from "@/lib/db/client";
import { isDemoOwnerEmail } from "@/lib/db/accounts";

/** Server-side, per-request authorization. Authentication or a household link alone is not access. */
export async function hasProductAccess(user: { id: string; email: string | null }, householdId: string): Promise<boolean> {
  if (isDemoOwnerEmail(user.email)) return true;
  const now = new Date().toISOString();
  const entitlement = await queryOne(`SELECT 1 AS ok FROM cycle_entitlements e
    JOIN cycle_orders o ON o.id=e.order_id AND o.household_id=e.household_id
    WHERE e.household_id=$1 AND e.starts_at<=$2 AND e.expires_at>$3 AND e.revoked_at IS NULL
      AND ((e.kind='complimentary' AND o.kind='complimentary' AND o.status='complimentary')
        OR (e.kind='paid' AND o.kind='paid' AND o.status='paid')) LIMIT 1`, [householdId, now, now]);
  if (entitlement) return true;

  // A claimed, approved request is a time-limited preview grant. Match the
  // verified CURRENT sign-in address, not the potentially stale auth_links email.
  if (!user.email) return false;
  const preview = await queryOne(`SELECT 1 AS ok FROM demo_households dh
    JOIN demo_invites i ON i.id=dh.invite_id
    JOIN demo_access_requests r ON r.id=i.access_request_id AND r.invite_id=i.id
    WHERE dh.household_id=$1 AND i.accepted_by=$2 AND i.accepted_email=$3
      AND r.requester_email=$4 AND r.status='approved'
      AND i.accepted_at IS NOT NULL AND i.revoked_at IS NULL
      AND i.expires_at>$5 LIMIT 1`, [householdId, user.id, user.email.trim().toLowerCase(), user.email.trim().toLowerCase(), now]);
  return !!preview;
}
