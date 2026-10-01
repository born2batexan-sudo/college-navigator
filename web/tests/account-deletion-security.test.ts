import assert from "node:assert/strict";
import { test } from "node:test";
import { accountDeletionAdmin, preflightOwnAuthDeletion, deleteOwnAuthUser } from "../lib/auth/account-deletion";

type Admin = Parameters<typeof preflightOwnAuthDeletion>[0];
const identity = "00000000-0000-4000-8000-000000000001";
function fakeAdmin({ email = "owner@example.test", lookupError = false, deleteError = false, deletedStatus = 404 } = {}) {
  let deleted = false, deletionCalls = 0;
  const admin = {
    getUserById: async (id: string) => deleted
      ? { data: { user: null }, error: { status: deletedStatus } }
      : lookupError ? { data: { user: null }, error: { status: 503 } }
      : { data: { user: { id, email } }, error: null },
    deleteUser: async () => { deletionCalls++; if (deleteError) return { error: { status: 503 } }; deleted = true; return { error: null }; },
  } as unknown as Admin;
  return { admin, deletionCalls: () => deletionCalls };
}

test("no admin credential fails closed before any data deletion", () => {
  const old = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(() => accountDeletionAdmin(), /temporarily unavailable/);
  } finally { if (old === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = old; }
});

test("preflight accepts only same authenticated identity and verified email", async () => {
  const ok = fakeAdmin();
  await preflightOwnAuthDeletion(ok.admin, identity, " OWNER@example.test ");
  assert.equal(ok.deletionCalls(), 0);
  for (const input of [null, "attacker@example.test"]) {
    await assert.rejects(preflightOwnAuthDeletion(ok.admin, identity, input), /Unable to verify/);
  }
  await assert.rejects(preflightOwnAuthDeletion(fakeAdmin({ lookupError: true }).admin, identity, "owner@example.test"), /Unable to verify/);
});

test("Auth admin deletion errors and unverified results never claim completion", async () => {
  const failed = fakeAdmin({ deleteError: true });
  await assert.rejects(deleteOwnAuthUser(failed.admin, identity), /did not complete/);
  assert.equal(failed.deletionCalls(), 1);
  const uncertain = fakeAdmin({ deletedStatus: 503 });
  await assert.rejects(deleteOwnAuthUser(uncertain.admin, identity), /could not be verified/);
  await deleteOwnAuthUser(fakeAdmin().admin, identity);
});
