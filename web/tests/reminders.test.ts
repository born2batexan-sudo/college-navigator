import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "cn-reminders-"));
process.env.DB_PATH = path.join(dir, "reminders.sqlite3");
delete process.env.DATABASE_URL;
delete process.env.DEMO_TEMPLATE_HOUSEHOLD_ID;

let A: typeof import("../lib/db/accounts");
let R: typeof import("../lib/db/repo");
let D: typeof import("../lib/db/client");
let M: typeof import("../lib/db/reminders");

describe("provider-neutral reminder foundation", () => {
  let householdId: string;
  let actionId: string;
  let otherActionId: string;
  let ruleId: string;
  let baseReminderId: string;

  before(async () => {
    A = await import("../lib/db/accounts");
    R = await import("../lib/db/repo");
    D = await import("../lib/db/client");
    M = await import("../lib/db/reminders");
    const institution = await R.upsertInstitution({ name: "Reminder University", slug: "reminder-u", domains: ["reminder.edu"] });
    const source = await R.createSource({ institutionId: institution.id, url: "https://reminder.edu/requirements", label: "Requirements" });
    const account = await A.provisionAccount({ authUserId: "reminder-user", email: "family@example.com" });
    const student = await A.completeOnboarding(account, { studentName: "Reminder Student", role: "parent", enteringTerm: "Fall 2027" });
    householdId = account.household.id;
    const relationship = await R.upsertRelationship({ studentId: student.id, institutionId: institution.id });
    const rule = await R.upsertRule({
      institutionId: institution.id, checkpointCode: "REM-01", domain: "Admissions", title: "Submit records",
      critical: true, requirement: "Submit records", status: "verified", confidence: "high",
      researchTerm: "Fall 2027", cycleState: "current", applicability: "applies",
      evidenceQuote: "Official records are due.", sourceId: source.id,
    });
    ruleId = rule.id;
    const action = await R.createActionInstance({ relationshipId: relationship.id, ruleId: rule.id, dueAt: "2027-01-10T00:00:00.000Z", applicabilityReason: "applies", priority: "high" });
    actionId = action.id;
    const otherRule = await R.upsertRule({
      institutionId: institution.id, checkpointCode: "REM-02", domain: "Admissions", title: "Confirm records",
      critical: false, requirement: "Confirm records", status: "verified", confidence: "high",
      researchTerm: "Fall 2027", cycleState: "current", applicability: "applies",
      evidenceQuote: "Records must be confirmed.", sourceId: source.id,
    });
    const otherAction = await R.createActionInstance({ relationshipId: relationship.id, ruleId: otherRule.id, dueAt: "2027-01-11T00:00:00.000Z", applicabilityReason: "applies", priority: "normal" });
    otherActionId = otherAction.id;
  });

  it("accepts only eligible exact-term actions and defers across quiet hours", async () => {
    await M.upsertReminderPreferences({ householdId, quietHoursStart: "21:00", quietHoursEnd: "08:00" });
    const first = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-01-05", localTime: "22:30", timezone: "America/Chicago" });
    assert.equal(first.created, true);
    assert.equal(first.reminder?.scheduledForLocal.endsWith("T08:00"), true);
    assert.equal(first.reminder?.deliveryState, "queued");
    assert.equal(first.reminder?.directActionPath, `/action/${actionId}`);
    assert.equal(first.reminder?.recipientAddress, null, "dry-run mode has no provider recipient");
    baseReminderId = first.reminder!.id;
    const again = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-01-05", localTime: "22:30", timezone: "America/Chicago" });
    assert.equal(again.created, false);
    assert.equal(again.reminder?.id, first.reminder?.id);
    assert.equal((await M.listReminderDeliveryEvents(first.reminder!.id)).length, 1, "idempotency does not duplicate the queued event");
    const collision = await M.enqueueReminder({ actionInstanceId: otherActionId, localDate: "2027-01-05", localTime: "22:30", timezone: "America/Chicago", idempotencyKey: first.reminder!.idempotencyKey });
    assert.equal(collision.reminder, null, "an idempotency key cannot disclose or return another action");
    assert.equal(collision.reason, "idempotency_key_conflict");

    // Explicit DST policy: Chicago's 02:30 spring-forward wall time clamps to
    // the first valid instant (03:00), while an overlap chooses the earlier
    // 01:30 occurrence (06:30Z, not 07:30Z).
    await M.upsertReminderPreferences({ householdId, quietHoursStart: "00:00", quietHoursEnd: "00:00" });
    const gap = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-03-14", localTime: "02:30", timezone: "America/Chicago", idempotencyKey: "dst-gap" });
    assert.equal(gap.reminder?.scheduledForLocal, "2027-03-14T03:00");
    assert.equal(gap.reminder?.dueAt, "2027-03-14T08:00:00.000Z");
    const overlap = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-11-07", localTime: "01:30", timezone: "America/Chicago", idempotencyKey: "dst-overlap" });
    assert.equal(overlap.reminder?.dueAt, "2027-11-07T06:30:00.000Z");
    await M.cancelReminder(gap.reminder!.id, "dst_test_cleanup");
    await M.cancelReminder(overlap.reminder!.id, "dst_test_cleanup");

    // Quiet-hour deferral resolves its endpoint through the same gap policy.
    await M.upsertReminderPreferences({ householdId, quietHoursStart: "21:00", quietHoursEnd: "03:30" });
    const quietGap = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2028-03-12", localTime: "02:30", timezone: "America/Chicago", idempotencyKey: "dst-quiet-gap" });
    assert.equal(quietGap.reminder?.scheduledForLocal, "2028-03-12T03:30");
    await M.cancelReminder(quietGap.reminder!.id, "dst_test_cleanup");
    await M.upsertReminderPreferences({ householdId, quietHoursStart: "21:00", quietHoursEnd: "08:00" });

    // A template marker and a demo marker are both hard enqueue exclusions.
    process.env.DEMO_TEMPLATE_HOUSEHOLD_ID = householdId;
    const templateExcluded = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-02-01", localTime: "10:00", timezone: "America/Chicago", idempotencyKey: "template-excluded" });
    assert.equal(templateExcluded.reason, "not_eligible");
    delete process.env.DEMO_TEMPLATE_HOUSEHOLD_ID;
    await D.exec(`INSERT INTO demo_invites(id,token_hash,template_household_id,created_by,created_email,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, ["reminder-demo-invite", "reminder-demo-hash", householdId, "test", "test@example.com", "2999-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z"]);
    await D.exec("INSERT INTO demo_households(household_id,invite_id,template_household_id,cloned_at) VALUES($1,$2,$3,$4)", [householdId, "reminder-demo-invite", householdId, "2027-01-01T00:00:00.000Z"]);
    const demoExcluded = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-02-02", localTime: "10:00", timezone: "America/Chicago", idempotencyKey: "demo-excluded" });
    assert.equal(demoExcluded.reason, "not_eligible");
    await D.exec("DELETE FROM demo_households WHERE household_id=$1", [householdId]);
    await D.exec("DELETE FROM demo_invites WHERE id=$1", ["reminder-demo-invite"]);
  });

  it("records provider-neutral events with retry counters and no message body", async () => {
    const reminder = (await M.getReminder(baseReminderId))!;
    const sent = await M.recordReminderDeliveryEvent({ reminderId: reminder.id, state: "sent", providerEventId: "provider-base-send", detailCode: "adapter_attempt" });
    assert.equal(sent.eventState, "sent");
    const failed = await M.recordReminderDeliveryEvent({ reminderId: reminder.id, state: "failed", providerEventId: "provider-base-failure", detailCode: "temporary_failure" });
    assert.equal(failed.eventState, "failed");
    assert.equal((await M.getReminder(reminder.id))?.attemptCount, 1, "failure records delivery result without counting a second send");
    assert.equal((await M.recordReminderDeliveryEvent({ reminderId: reminder.id, state: "sent", providerEventId: "provider-base-send" })).id, sent.id, "duplicate provider event is idempotent before transition validation");
    const events = await M.listReminderDeliveryEvents(reminder.id);
    assert.deepEqual(events.map((event) => event.eventState).sort(), ["failed", "queued", "sent"].sort());
    const columns = (await D.queryRows<any>("PRAGMA table_info(reminder_outbox)")).map((row) => row.name);
    assert.equal(columns.includes("message_body"), false);

    const maxOne = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-01-07", localTime: "10:00", timezone: "America/Chicago", idempotencyKey: "max-one", maxAttempts: 1, directActionPath: "/action/not-the-action" });
    assert.equal(maxOne.reminder?.directActionPath, `/action/${actionId}`, "direct links are derived from action identity");
    await M.recordReminderDeliveryEvent({ reminderId: maxOne.reminder!.id, state: "sent", providerEventId: "max-one-send" });
    await M.recordReminderDeliveryEvent({ reminderId: maxOne.reminder!.id, state: "failed", providerEventId: "max-one-fail" });
    assert.equal((await M.getReminder(maxOne.reminder!.id))?.attemptCount, 1);
    assert.equal((await M.retryFailedReminder(maxOne.reminder!.id))?.deliveryState, "failed", "maxAttempts prevents retry after the one actual send");
    await assert.rejects(() => M.recordReminderDeliveryEvent({ reminderId: maxOne.reminder!.id, state: "sent", providerEventId: "max-one-send-2" }), /retry limit|Invalid reminder transition/);
    await M.cancelReminder(maxOne.reminder!.id, "test_cleanup");

    const outOfOrder = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-01-08", localTime: "10:00", timezone: "America/Chicago", idempotencyKey: "out-of-order" });
    await M.recordReminderDeliveryEvent({ reminderId: outOfOrder.reminder!.id, state: "sent", providerEventId: "out-send" });
    await M.recordReminderDeliveryEvent({ reminderId: outOfOrder.reminder!.id, state: "delivered", providerEventId: "out-delivered" });
    await assert.rejects(() => M.recordReminderDeliveryEvent({ reminderId: outOfOrder.reminder!.id, state: "sent", providerEventId: "out-late-send" }), /Invalid reminder transition/);

    const lateDelivery = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-01-09", localTime: "10:00", timezone: "America/Chicago", idempotencyKey: "late-delivery" });
    await M.recordReminderDeliveryEvent({ reminderId: lateDelivery.reminder!.id, state: "sent", providerEventId: "late-delivery-send" });
    await M.cancelReminder(lateDelivery.reminder!.id, "operator_cancel");
    await M.recordReminderDeliveryEvent({ reminderId: lateDelivery.reminder!.id, state: "delivered", providerEventId: "late-delivery-result" });
    assert.equal((await M.getReminder(lateDelivery.reminder!.id))?.deliveryState, "canceled", "late delivery evidence never resurrects a canceled row");
    assert.ok((await M.listReminderDeliveryEvents(lateDelivery.reminder!.id)).some((event) => event.eventState === "delivered"));

    const lateBounce = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-01-10", localTime: "10:00", timezone: "America/Chicago", idempotencyKey: "late-bounce" });
    await M.recordReminderDeliveryEvent({ reminderId: lateBounce.reminder!.id, state: "sent", providerEventId: "late-bounce-send" });
    await M.cancelReminder(lateBounce.reminder!.id, "operator_cancel");
    await M.recordReminderDeliveryEvent({ reminderId: lateBounce.reminder!.id, state: "bounced", providerEventId: "late-bounce-result" });
    assert.equal((await M.getReminder(lateBounce.reminder!.id))?.deliveryState, "canceled");
    assert.ok((await M.listReminderDeliveryEvents(lateBounce.reminder!.id)).some((event) => event.eventState === "bounced"));
  });

  it("cancels queued work when a household pauses and supports approved-recipient staging", async () => {
    const paused = await M.pauseReminders(householdId);
    assert.equal(paused.remindersEnabled, false);
    const noQueue = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-01-06", localTime: "10:00", timezone: "America/Chicago" });
    assert.equal(noQueue.reason, "household_paused");

    await M.resumeReminders(householdId);
    await assert.rejects(
      () => M.upsertReminderPreferences({ householdId, deliveryMode: "approved_recipient", stagingDryRun: false, approvedRecipient: "approved@example.com" }),
      /Production reminder delivery is disabled/,
      "non-dry-run recipient mode is opt-in only",
    );
    process.env.REMINDER_PRODUCTION_DELIVERY_ENABLED = "1";
    await M.upsertReminderPreferences({ householdId, deliveryMode: "approved_recipient", stagingDryRun: false, approvedRecipient: "approved@example.com" });
    const queued = await M.enqueueReminder({ actionInstanceId: actionId, localDate: "2027-01-06", localTime: "10:00", timezone: "America/Chicago" });
    delete process.env.REMINDER_PRODUCTION_DELIVERY_ENABLED;
    assert.equal(queued.reminder?.deliveryMode, "approved_recipient");
    assert.equal(queued.reminder?.recipientAddress, "approved@example.com");
    await M.reconcileReminders(householdId);
    await D.exec("UPDATE action_instances SET state='completed' WHERE id=$1", [actionId]);
    const result = await M.reconcileReminders(householdId);
    assert.equal(result.canceled, 1, "the approved-recipient row is canceled after action completion; pause already canceled the earlier row");
    assert.equal((await M.getReminder(queued.reminder!.id))?.deliveryState, "canceled");
    assert.equal((await M.getReminder(queued.reminder!.id))?.cancellationReason, "action_completed");
    // Keep the rule in scope so the fixture documents the snapshot source.
    assert.ok(ruleId);
  });
});
