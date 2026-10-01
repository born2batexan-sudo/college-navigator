import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { managedSchoolInventory, TRACKABLE_SCHOOL_SLUGS } from "../lib/trackable";
import type { Institution, InstitutionRelationship } from "../lib/db/types";

const school = (slug: string): Institution => ({ id: `inst_${slug}`, slug, name: slug, domains: "[]", pathway: "both", coverageStatus: "research", coveragePct: 0, createdAt: "" });
const rel = (slug: string, active = true): InstitutionRelationship => ({ id: `rel_${slug}`, studentId: "student_one", institutionId: `inst_${slug}`, lifecycleState: "considering", decisionDate: null, commitDate: null, attributes: "{}", active, createdAt: "" });

describe("tracked school visibility and unreviewed tracker safety", () => {
  it("counts and shows all seven active canonical schools, even though the opt-in catalog contains six", () => {
    const institutions = [...TRACKABLE_SCHOOL_SLUGS.map(school), school("ut-dallas")];
    const inventory = managedSchoolInventory(institutions, institutions.map(i => rel(i.slug)));
    assert.equal(inventory.activeCount, 7);
    assert.equal(inventory.schools.length, 7);
    assert.ok(inventory.schools.some(i => i.slug === "ut-dallas"));
    assert.equal(inventory.missingActiveCount, 0);
    assert.equal(inventory.relByInstitution.get("inst_ut-dallas")?.active, true);
  });
  it("retains paused requested schools and reports active orphan identities without a misleading denominator", () => {
    const inventory = managedSchoolInventory([...TRACKABLE_SCHOOL_SLUGS.map(school), school("ut-dallas")], [rel("ut-dallas", false), rel("orphan")]);
    assert.equal(inventory.activeCount, 1);
    assert.equal(inventory.missingActiveCount, 1);
    assert.equal(inventory.schools.length, 7);
    assert.equal(inventory.relByInstitution.get("inst_ut-dallas")?.active, false);
  });
  it("keeps unknown/untracked school routes private and does not expose directory-linked legacy actions", () => {
    const page = readFileSync(path.join(process.cwd(), "app/school/[slug]/page.tsx"), "utf8");
    assert.ok(page.indexOf("if (!relationship) notFound()") < page.indexOf("if (directory) return"));
    assert.ok(page.indexOf("if (directory) return") < page.indexOf("listActionInstancesForRelationship(relationship.id, term)"));
    assert.match(page, /School tracked; action plan not yet certified/);
    const action = readFileSync(path.join(process.cwd(), "app/welcome/actions.ts"), "utf8");
    assert.match(action, /directory && !existing\?\.active/);
    assert.match(action, /if \(!directory\) \{\s*await setRelationshipActive/);
  });
});
