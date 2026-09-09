/**
 * Support code for the browser companion extension's two public endpoints
 * (app/api/companion/context, app/api/companion/observe).
 *
 * Important scope note: this MVP has exactly one household and no login,
 * so "the household" below just means listHouseholds()[0] — the seeded
 * demo household. Real multi-tenant auth (matching a browser session to a
 * specific household) is explicitly future work; see README.md.
 */

import {
  listInstitutions,
  listHouseholds,
  listStudentsForHousehold,
  listRelationshipsForStudent,
  listObservationPatternsForInstitution,
  listActionInstancesForRelationship,
  getRuleByCode,
  findActionInstance,
  updateActionInstance,
  createActionEvent,
} from "./db/repo";
import { hostnameOf, domainMatches, globMatch } from "./urlmatch";
import type { Institution, ObservationPattern } from "./db/types";

const ACTION_STATE_ORDER = ["not_started", "started", "submitted", "received", "complete"];

export async function findInstitutionForUrl(url: string): Promise<Institution | null> {
  const hostname = hostnameOf(url);
  if (!hostname) return null;
  for (const inst of await listInstitutions()) {
    const domains: string[] = JSON.parse(inst.domains || "[]");
    if (domainMatches(domains, hostname)) return inst;
  }
  return null;
}

function matchingPatterns(patterns: ObservationPattern[], url: string): ObservationPattern[] {
  const hostname = hostnameOf(url) ?? "";
  const withoutScheme = url.replace(/^https?:\/\//, "");
  return patterns.filter((p) => globMatch(p.urlPattern, withoutScheme) || globMatch(p.urlPattern, hostname));
}

async function getDemoRelationshipFor(institutionId: string) {
  const household = (await listHouseholds())[0];
  if (!household) return null;
  const student = (await listStudentsForHousehold(household.id))[0];
  if (!student) return null;
  const relationships = await listRelationshipsForStudent(student.id);
  return relationships.find((r) => r.institutionId === institutionId) ?? null;
}

export async function getContextForUrl(url: string) {
  const institution = await findInstitutionForUrl(url);
  if (!institution) return { matched: false as const };

  const patterns = matchingPatterns(await listObservationPatternsForInstitution(institution.id), url);
  const relationship = await getDemoRelationshipFor(institution.id);
  const actions = relationship ? await listActionInstancesForRelationship(relationship.id) : [];
  const openActions = actions.filter((a) => !["complete", "waived", "not_applicable"].includes(a.state));

  return {
    matched: true as const,
    institution: { slug: institution.slug, name: institution.name, coverageStatus: institution.coverageStatus, coveragePct: institution.coveragePct },
    observationPatterns: patterns.map((p) => ({ workflow: p.workflow, signal: p.signal })),
    actions: openActions.map((a) => ({
      id: a.id,
      checkpointCode: a.rule.checkpointCode,
      title: a.rule.title,
      state: a.state,
      priority: a.priority,
      dueAt: a.dueAt,
      guidance: a.guidance,
    })),
  };
}

/**
 * The content script sends the current page's visible text; this checks it
 * against every observation pattern whose URL scope matches the current
 * page, and advances the linked ActionInstance's state when a signal is
 * found — but only forward (never regresses a state), and only records a
 * `state_change` event with actorType "observation_engine" so the Action
 * Ledger always shows why the transition happened.
 */
export async function recordObservation(url: string, pageText: string) {
  const institution = await findInstitutionForUrl(url);
  if (!institution) return { matched: false as const, updates: [] };

  const patterns = matchingPatterns(await listObservationPatternsForInstitution(institution.id), url);
  const relationship = await getDemoRelationshipFor(institution.id);
  const haystack = pageText.toLowerCase();
  const updates: { checkpointCode: string; fromState: string; toState: string }[] = [];

  if (!relationship) return { matched: true as const, updates };

  for (const pattern of patterns) {
    if (!pattern.relatedCheckpointCode) continue;
    if (!haystack.includes(pattern.signal.toLowerCase())) continue;

    const rule = await getRuleByCode(institution.id, pattern.relatedCheckpointCode);
    if (!rule) continue;
    const action = await findActionInstance(relationship.id, rule.id);
    if (!action) continue;

    const currentIdx = ACTION_STATE_ORDER.indexOf(action.state);
    const impliedIdx = ACTION_STATE_ORDER.indexOf(pattern.impliesState);
    if (impliedIdx === -1 || impliedIdx <= currentIdx) continue; // never regress, never no-op

    await updateActionInstance(action.id, { state: pattern.impliesState });
    await createActionEvent({ actionId: action.id, eventType: "observed_signal", fromState: action.state, toState: pattern.impliesState, actorType: "observation_engine", evidenceRef: url });
    updates.push({ checkpointCode: rule.checkpointCode, fromState: action.state, toState: pattern.impliesState });
  }

  return { matched: true as const, updates };
}
