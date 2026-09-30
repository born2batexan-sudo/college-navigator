import { queryRows } from "./client";

/** Safe, read-only admin lookup projection. Never returns tokens, auth IDs, phone numbers, or student attributes. */
export type AdminHouseholdLookupRecord = {
  id: string;
  name: string;
  subState: string;
  createdAt: string;
  contacts: Array<{ name: string; role: string; email: string | null }>;
  students: Array<{ name: string; gradYear: number }>;
};

type HouseholdRow = { id: string; name: string; sub_state: string; created_at: string };
type ContactRow = { household_id: string; name: string; role: string; email: string | null };
type StudentRow = { household_id: string; name: string; grad_year: number };

/** Search household/account and student labels without exposing auth or bearer-token fields. */
export async function searchAdminHouseholds(search: string, maxResults = 20): Promise<AdminHouseholdLookupRecord[]> {
  const term = search.trim();
  if (term.length < 2 || term.length > 120) return [];

  // Treat SQL LIKE metacharacters as literal user input; values remain parameterized.
  const pattern = `%${term.replace(/[!%_]/g, "!$&")}%`;
  const limit = Number.isFinite(maxResults) ? Math.min(25, Math.max(1, Math.trunc(maxResults))) : 20;
  const households = await queryRows<HouseholdRow>(`WITH criteria AS (SELECT lower($1) AS pattern)
    SELECT h.id, h.name, h.sub_state, h.created_at
    FROM households h CROSS JOIN criteria c
    WHERE lower(h.id) LIKE c.pattern ESCAPE '!'
      OR lower(h.name) LIKE c.pattern ESCAPE '!'
      OR EXISTS (SELECT 1 FROM people p WHERE p.household_id = h.id
        AND (lower(p.name) LIKE c.pattern ESCAPE '!' OR lower(p.email) LIKE c.pattern ESCAPE '!'))
      OR EXISTS (SELECT 1 FROM students s WHERE s.household_id = h.id
        AND lower(s.name) LIKE c.pattern ESCAPE '!')
    ORDER BY h.created_at DESC, h.id ASC
    LIMIT $2`, [pattern, limit]);

  if (households.length === 0) return [];
  const ids = households.map((household) => household.id);
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
  const [contacts, students] = await Promise.all([
    queryRows<ContactRow>(`SELECT household_id, name, role, email FROM people
      WHERE household_id IN (${placeholders}) ORDER BY household_id, created_at, id`, ids),
    queryRows<StudentRow>(`SELECT household_id, name, grad_year FROM students
      WHERE household_id IN (${placeholders}) ORDER BY household_id, created_at, id`, ids),
  ]);

  const contactsByHousehold = new Map<string, ContactRow[]>();
  const studentsByHousehold = new Map<string, StudentRow[]>();
  for (const contact of contacts) {
    const values = contactsByHousehold.get(contact.household_id) ?? [];
    values.push(contact);
    contactsByHousehold.set(contact.household_id, values);
  }
  for (const student of students) {
    const values = studentsByHousehold.get(student.household_id) ?? [];
    values.push(student);
    studentsByHousehold.set(student.household_id, values);
  }

  return households.map((household) => ({
    id: household.id,
    name: household.name,
    subState: household.sub_state,
    createdAt: household.created_at,
    contacts: (contactsByHousehold.get(household.id) ?? []).map(({ name, role, email }) => ({ name, role, email })),
    students: (studentsByHousehold.get(household.id) ?? []).map(({ name, grad_year }) => ({ name, gradYear: grad_year })),
  }));
}
