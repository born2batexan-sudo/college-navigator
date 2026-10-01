import type { Institution, InstitutionRelationship } from "./db/types";

// Legacy opt-in catalog. It is NOT an inventory of a student's existing schools:
// a requested school can acquire an active relationship without being in this list.
// A new school is not added to the opt-in catalog on the strength of a legacy
// coverage percentage or a directory link alone.
export const TRACKABLE_SCHOOL_SLUGS = ["alabama", "arkansas", "oklahoma", "arizona", "ut-austin", "texas-am"];

/** Return the picker plus every previously tracked relationship, without
 * inventing an institution or silently discarding an active/paused school.
 * Callers separately report orphan relationships rather than counting them
 * against the smaller list of cards. */
export function managedSchoolInventory(institutions: Institution[], relationships: InstitutionRelationship[]) {
  const byId = new Map(institutions.map(i => [i.id, i]));
  const bySlug = new Map(institutions.map(i => [i.slug, i]));
  const relByInstitution = new Map(relationships.map(r => [r.institutionId, r]));
  const schools = TRACKABLE_SCHOOL_SLUGS.map(slug => bySlug.get(slug)).filter((i): i is Institution => !!i);
  const included = new Set(schools.map(i => i.id));
  for (const rel of relationships) {
    const institution = byId.get(rel.institutionId);
    if (institution && !included.has(institution.id)) { schools.push(institution); included.add(institution.id); }
  }
  const activeCount = relationships.filter(r => r.active).length;
  const missingActiveCount = relationships.filter(r => r.active && !byId.has(r.institutionId)).length;
  return { schools, relByInstitution, activeCount, missingActiveCount };
}
