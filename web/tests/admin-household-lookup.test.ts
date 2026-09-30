import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "cn-admin-household-lookup-"));
process.env.DB_PATH = path.join(dir, "admin-household-lookup.sqlite3");
delete process.env.DATABASE_URL;

type Accounts = typeof import("../lib/db/accounts");
type Lookup = typeof import("../lib/db/admin-households");
type Client = typeof import("../lib/db/client");
let accounts: Accounts;
let lookup: Lookup;
let client: Client;
let targetHouseholdId = "";
let unrelatedHouseholdId = "";

before(async () => {
  accounts = await import("../lib/db/accounts");
  lookup = await import("../lib/db/admin-households");
  client = await import("../lib/db/client");

  const target = await accounts.provisionAccount({ authUserId: "lookup-target", email: "ada.parent@example.test" });
  targetHouseholdId = target.household.id;
  await accounts.completeOnboarding(target, { studentName: "Alex North", role: "parent", enteringTerm: "Fall 2027" });
  await client.exec("UPDATE households SET name=$1 WHERE id=$2", ["North Household", targetHouseholdId]);

  const unrelated = await accounts.provisionAccount({ authUserId: "lookup-unrelated", email: "other.parent@example.test" });
  unrelatedHouseholdId = unrelated.household.id;
  await accounts.completeOnboarding(unrelated, { studentName: "Taylor South", role: "parent", enteringTerm: "Fall 2027" });
  await client.exec("UPDATE households SET name=$1 WHERE id=$2", ["South Household", unrelated.household.id]);
});

describe("protected admin household lookup", () => {
  it("finds an account by contact email or household name and returns only safe account fields", async () => {
    const byEmail = await lookup.searchAdminHouseholds(" ADA.PARENT@EXAMPLE.TEST ");
    assert.equal(byEmail.length, 1);
    assert.equal(byEmail[0].id, targetHouseholdId);
    assert.deepEqual(byEmail[0].contacts, [{ name: "ada.parent", role: "parent", email: "ada.parent@example.test" }]);
    assert.deepEqual(byEmail[0].students, [{ name: "Alex North", gradYear: 2027 }]);
    assert.equal(byEmail[0].subState, "trial");
    assert.deepEqual(Object.keys(byEmail[0]).sort(), ["contacts", "createdAt", "id", "name", "students", "subState"]);
    assert.deepEqual(Object.keys(byEmail[0].contacts[0]).sort(), ["email", "name", "role"]);
    assert.deepEqual(Object.keys(byEmail[0].students[0]).sort(), ["gradYear", "name"]);
    assert.doesNotMatch(JSON.stringify(byEmail), /authUserId|attributes|phone|token_hash|access_token|refresh_token/i);

    const byStudent = await lookup.searchAdminHouseholds("Alex North");
    assert.deepEqual(byStudent.map((household) => household.id), [targetHouseholdId]);
    const byHousehold = await lookup.searchAdminHouseholds("North Household");
    assert.deepEqual(byHousehold.map((household) => household.id), [targetHouseholdId]);
  });

  it("does not return unrelated households, short/blank queries, or LIKE wildcard expansions", async () => {
    const unrelated = await lookup.searchAdminHouseholds("Taylor South");
    assert.equal(unrelated.length, 1);
    assert.equal(unrelated[0].id, unrelatedHouseholdId);
    assert.deepEqual(unrelated[0].students, [{ name: "Taylor South", gradYear: 2027 }]);
    assert.deepEqual(await lookup.searchAdminHouseholds("x"), []);
    assert.deepEqual(await lookup.searchAdminHouseholds("   "), []);
    assert.deepEqual(await lookup.searchAdminHouseholds("%%"), []);
    assert.deepEqual(await lookup.searchAdminHouseholds("not-present"), []);
  });

  it("applies a bounded result limit and performs no database writes", async () => {
    const before = await client.queryOne<{ households: number; people: number; students: number; auth_links: number }>(`SELECT
      (SELECT COUNT(*) FROM households) AS households,
      (SELECT COUNT(*) FROM people) AS people,
      (SELECT COUNT(*) FROM students) AS students,
      (SELECT COUNT(*) FROM auth_links) AS auth_links`);
    const matches = await lookup.searchAdminHouseholds("household", 1);
    const after = await client.queryOne<{ households: number; people: number; students: number; auth_links: number }>(`SELECT
      (SELECT COUNT(*) FROM households) AS households,
      (SELECT COUNT(*) FROM people) AS people,
      (SELECT COUNT(*) FROM students) AS students,
      (SELECT COUNT(*) FROM auth_links) AS auth_links`);
    assert.equal(matches.length, 1);
    assert.deepEqual(after, before);
    assert.deepEqual(await lookup.searchAdminHouseholds("household", 1000).then((rows) => rows.length), 2, "caller-supplied limits are capped at the two matching fixtures here");
  });
});

describe("administrator allowlist authorization regression", () => {
  it("admits only the two configured administrators using full exact email matches", async () => {
    const { administratorEmails, isAdministratorEmail } = await import("../lib/auth/admin");
    const env = { DEMO_OWNER_EMAIL: "Born2BaTexan@gmail.com", ADMIN_EMAILS: " Marc@HydraOpCo.com, born2batexan@gmail.com " } as unknown as NodeJS.ProcessEnv;
    assert.deepEqual(administratorEmails(env), ["born2batexan@gmail.com", "marc@hydraopco.com"]);
    assert.equal(isAdministratorEmail(" born2batexan@gmail.com ", env), true);
    assert.equal(isAdministratorEmail("MARC@HYDRAOPCO.COM", env), true);
    assert.equal(isAdministratorEmail("marc@hydraopco.com.evil", env), false);
    assert.equal(isAdministratorEmail("notmarc@hydraopco.com", env), false);
    assert.equal(isAdministratorEmail("born2batexan+other@gmail.com", env), false);
    assert.equal(isAdministratorEmail(null, env), false);
    assert.equal(isAdministratorEmail(" ", env), false);
  });

  it("fails closed when the allowlist is absent or contains no address", async () => {
    const { administratorEmails, isAdministratorEmail } = await import("../lib/auth/admin");
    const env = {} as NodeJS.ProcessEnv;
    assert.deepEqual(administratorEmails(env), []);
    assert.equal(isAdministratorEmail("born2batexan@gmail.com", env), false);
    assert.equal(isAdministratorEmail("marc@hydraopco.com", env), false);
    assert.equal(isAdministratorEmail("owner@example.com", { DEMO_OWNER_EMAIL: " ", ADMIN_EMAILS: " ,\n " } as unknown as NodeJS.ProcessEnv), false);
  });
});
