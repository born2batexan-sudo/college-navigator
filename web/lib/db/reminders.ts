// Provider-neutral reminder foundation.
//
// This module intentionally stops at a local SQLite/Postgres outbox. It does
// not call a mail/SMS provider, persist message bodies, or create provider
// accounts. A future delivery adapter can consume reminder_outbox and append
// provider-neutral state changes through recordReminderDeliveryEvent().
import { exec, newId, nowIso, queryOne, queryRows, usingPostgres, withTransaction } from "./client";

export const REMINDER_STATES = [
  "queued", "sent", "delivered", "bounced", "complained", "suppressed", "failed", "canceled",
] as const;
export type ReminderState = (typeof REMINDER_STATES)[number];
export type ReminderDeliveryMode = "staging_dry_run" | "approved_recipient";

// Kept as an explicit registry so the local schema contract and Postgres
// release verification cannot silently omit the reminder tables.
export const REMINDER_TABLES = [
  "household_reminder_preferences",
  "reminder_outbox",
  "reminder_delivery_events",
] as const;
export const REMINDER_DDL = [
  `CREATE TABLE IF NOT EXISTS household_reminder_preferences (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminders_enabled IN (0, 1)),
  quiet_hours_start TEXT NOT NULL DEFAULT '21:00',
  quiet_hours_end TEXT NOT NULL DEFAULT '08:00',
  delivery_mode TEXT NOT NULL DEFAULT 'staging_dry_run' CHECK (delivery_mode IN ('staging_dry_run', 'approved_recipient')),
  staging_dry_run INTEGER NOT NULL DEFAULT 1 CHECK (staging_dry_run IN (0, 1)),
  approved_recipient TEXT,
  updated_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS reminder_outbox (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  action_instance_id TEXT NOT NULL REFERENCES action_instances(id),
  rule_id TEXT NOT NULL REFERENCES rules(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  recipient_address TEXT,
  delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('staging_dry_run', 'approved_recipient')),
  staging_dry_run INTEGER NOT NULL CHECK (staging_dry_run IN (0, 1)),
  approved_recipient TEXT,
  timezone TEXT NOT NULL,
  scheduled_for_local TEXT NOT NULL,
  due_at TEXT NOT NULL,
  direct_action_path TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'queued' CHECK (delivery_state IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed', 'canceled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  next_attempt_at TEXT,
  last_error TEXT,
  cancellation_reason TEXT,
  action_due_at_snapshot TEXT,
  rule_updated_at_snapshot TEXT NOT NULL,
  research_term_snapshot TEXT NOT NULL,
  source_id_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS reminder_delivery_events (
  id TEXT PRIMARY KEY,
  reminder_outbox_id TEXT NOT NULL REFERENCES reminder_outbox(id),
  event_state TEXT NOT NULL CHECK (event_state IN ('queued', 'sent', 'delivered', 'bounced', 'complained', 'suppressed', 'failed', 'canceled')),
  attempt_number INTEGER NOT NULL DEFAULT 0 CHECK (attempt_number >= 0),
  provider_event_id TEXT,
  detail_code TEXT,
  occurred_at TEXT NOT NULL,
  UNIQUE(reminder_outbox_id, provider_event_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_reminder_outbox_due ON reminder_outbox(delivery_state, due_at)`,
  `CREATE INDEX IF NOT EXISTS idx_reminder_outbox_household ON reminder_outbox(household_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_reminder_outbox_action ON reminder_outbox(action_instance_id, delivery_state)`,
  `CREATE INDEX IF NOT EXISTS idx_reminder_delivery_events_outbox ON reminder_delivery_events(reminder_outbox_id, occurred_at)`,
] as const;

export type ReminderPreferences = {
  householdId: string;
  remindersEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  deliveryMode: ReminderDeliveryMode;
  stagingDryRun: boolean;
  approvedRecipient: string | null;
  updatedAt: string | null;
};

export type ReminderOutbox = {
  id: string;
  householdId: string;
  actionInstanceId: string;
  ruleId: string;
  idempotencyKey: string;
  recipientAddress: string | null;
  deliveryMode: ReminderDeliveryMode;
  stagingDryRun: boolean;
  approvedRecipient: string | null;
  timezone: string;
  scheduledForLocal: string;
  dueAt: string;
  directActionPath: string;
  deliveryState: ReminderState;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  cancellationReason: string | null;
  actionDueAtSnapshot: string | null;
  ruleUpdatedAtSnapshot: string;
  researchTermSnapshot: string;
  sourceIdSnapshot: string;
  createdAt: string;
  updatedAt: string;
};

export type ReminderDeliveryEvent = {
  id: string;
  reminderOutboxId: string;
  eventState: ReminderState;
  attemptNumber: number;
  providerEventId: string | null;
  detailCode: string | null;
  occurredAt: string;
};

const DEFAULT_PREFS = {
  remindersEnabled: true,
  quietHoursStart: "21:00",
  quietHoursEnd: "08:00",
  deliveryMode: "staging_dry_run" as ReminderDeliveryMode,
  stagingDryRun: true,
  approvedRecipient: null as string | null,
};

function toPreferences(row: any, householdId = row?.household_id): ReminderPreferences {
  return {
    householdId,
    remindersEnabled: row ? !!row.reminders_enabled : DEFAULT_PREFS.remindersEnabled,
    quietHoursStart: row?.quiet_hours_start ?? DEFAULT_PREFS.quietHoursStart,
    quietHoursEnd: row?.quiet_hours_end ?? DEFAULT_PREFS.quietHoursEnd,
    deliveryMode: row?.delivery_mode === "approved_recipient" ? "approved_recipient" : DEFAULT_PREFS.deliveryMode,
    stagingDryRun: row ? !!row.staging_dry_run : DEFAULT_PREFS.stagingDryRun,
    approvedRecipient: row?.approved_recipient ?? DEFAULT_PREFS.approvedRecipient,
    updatedAt: row?.updated_at ?? null,
  };
}

function toOutbox(row: any): ReminderOutbox {
  return {
    id: row.id,
    householdId: row.household_id,
    actionInstanceId: row.action_instance_id,
    ruleId: row.rule_id,
    idempotencyKey: row.idempotency_key,
    recipientAddress: row.recipient_address,
    deliveryMode: row.delivery_mode,
    stagingDryRun: !!row.staging_dry_run,
    approvedRecipient: row.approved_recipient,
    timezone: row.timezone,
    scheduledForLocal: row.scheduled_for_local,
    dueAt: row.due_at,
    directActionPath: row.direct_action_path,
    deliveryState: row.delivery_state,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    cancellationReason: row.cancellation_reason,
    actionDueAtSnapshot: row.action_due_at_snapshot,
    ruleUpdatedAtSnapshot: row.rule_updated_at_snapshot,
    researchTermSnapshot: row.research_term_snapshot,
    sourceIdSnapshot: row.source_id_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toEvent(row: any): ReminderDeliveryEvent {
  return {
    id: row.id,
    reminderOutboxId: row.reminder_outbox_id,
    eventState: row.event_state,
    attemptNumber: Number(row.attempt_number),
    providerEventId: row.provider_event_id,
    detailCode: row.detail_code,
    occurredAt: row.occurred_at,
  };
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch { throw new Error(`Invalid IANA timezone: ${timezone}`); }
}

function validateClock(value: string, name: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${name} must be HH:MM`);
  return value;
}

function validateLocalDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("localDate must be YYYY-MM-DD");
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== value) throw new Error("localDate is invalid");
}

function localParts(date: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/**
 * DST policy for reminder wall-clock input:
 * - A nonexistent time (the spring-forward gap) advances to the first valid
 *   instant after the gap (for example, 02:30 becomes 03:00).
 * - An ambiguous time (the fall-back overlap) chooses the earlier occurrence.
 *
 * This is intentionally implemented here instead of relying on a runtime's
 * implicit Date parsing policy, so scheduling and quiet-hour deferral use the
 * same behavior on SQLite and PostgreSQL deployments.
 */
export const REMINDER_DST_POLICY =
  "nonexistent wall times advance to the first valid instant after the gap; ambiguous wall times choose the earlier occurrence";

function wallClockMs(date: Date, timezone: string): number {
  const local = localParts(date, timezone);
  const [year, month, day] = local.date.split("-").map(Number);
  const [hour, minute] = local.time.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour, minute);
}

function localToUtc(localDate: string, localTime: string, timezone: string): Date {
  validateLocalDate(localDate); validateClock(localTime, "localTime"); validateTimezone(timezone);
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);

  // Collect offsets surrounding the target. Checking the resulting candidates
  // finds both occurrences during a fall-back overlap; sorting chooses the
  // earlier instant explicitly. Sampling by hour is sufficient to observe a
  // timezone offset on either side of modern DST transitions and avoids any
  // dependency on Temporal or a third-party timezone package.
  const offsets = new Set<number>();
  for (let h = -36; h <= 36; h++) {
    const instant = new Date(target + h * 60 * 60 * 1000);
    offsets.add(wallClockMs(instant, timezone) - instant.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(target - offset))
    .filter((instant) => {
      const local = localParts(instant, timezone);
      return local.date === localDate && local.time === localTime;
    })
    .sort((a, b) => a.getTime() - b.getTime());
  if (candidates.length) return candidates[0];

  // No candidate means the wall time is in a spring-forward gap. Walk the
  // represented wall clock from before the target until it first reaches or
  // passes the requested value. The first such instant is the transition's
  // post-gap boundary, not a minute-preserving normalization such as 03:30.
  const scanStart = target - 36 * 60 * 60 * 1000;
  const scanEnd = target + 36 * 60 * 60 * 1000;
  for (let instantMs = scanStart; instantMs <= scanEnd; instantMs += 60 * 1000) {
    const instant = new Date(instantMs);
    if (wallClockMs(instant, timezone) >= target) return instant;
  }
  throw new Error(`Could not resolve local time ${localDate}T${localTime} in ${timezone}`);
}

function addDays(date: string, count: number): string {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}

function isQuiet(localTime: string, start: string, end: string): boolean {
  if (start === end) return false;
  return start < end ? localTime >= start && localTime < end : localTime >= start || localTime < end;
}

function deferQuietHours(instant: Date, timezone: string, start: string, end: string): Date {
  const local = localParts(instant, timezone);
  if (!isQuiet(local.time, start, end)) return instant;
  const overnight = start > end;
  const endDate = overnight && local.time >= start ? addDays(local.date, 1) : local.date;
  return localToUtc(endDate, end, timezone);
}

/**
 * Delivery is deliberately disabled unless an operator explicitly enables it.
 * There is still no provider adapter in this module; the gate only prevents a
 * future adapter from treating an approved-recipient row as accidental dry
 * run data when the deployment has not opted in.
 */
export const REMINDER_PRODUCTION_DELIVERY_ENV = "REMINDER_PRODUCTION_DELIVERY_ENABLED";
export function isReminderProductionDeliveryEnabled(): boolean {
  return process.env[REMINDER_PRODUCTION_DELIVERY_ENV] === "1";
}

function assertDeliveryModeEnabled(deliveryMode: ReminderDeliveryMode, stagingDryRun: boolean): void {
  if ((!stagingDryRun || deliveryMode === "approved_recipient") && !isReminderProductionDeliveryEnabled()) {
    // An approved-recipient dry run remains provider-neutral, but production
    // recipient mode and any non-dry-run setting require the explicit gate.
    if (!stagingDryRun) throw new Error("Production reminder delivery is disabled; set REMINDER_PRODUCTION_DELIVERY_ENABLED=1 to opt in");
  }
}

/** Always derive the internal action link from the action id; callers cannot override it. */
function safeActionPath(actionId: string): string {
  return `/action/${encodeURIComponent(actionId)}`;
}

export async function getReminderPreferences(householdId: string): Promise<ReminderPreferences> {
  const row = await queryOne<any>("SELECT * FROM household_reminder_preferences WHERE household_id=$1", [householdId]);
  return toPreferences(row, householdId);
}

export async function upsertReminderPreferences(input: {
  householdId: string;
  remindersEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  deliveryMode?: ReminderDeliveryMode;
  stagingDryRun?: boolean;
  approvedRecipient?: string | null;
  timezone?: string;
}): Promise<ReminderPreferences> {
  const current = await getReminderPreferences(input.householdId);
  const start = validateClock(input.quietHoursStart ?? current.quietHoursStart, "quietHoursStart");
  const end = validateClock(input.quietHoursEnd ?? current.quietHoursEnd, "quietHoursEnd");
  const mode = input.deliveryMode ?? current.deliveryMode;
  const dryRun = input.stagingDryRun ?? (mode === "staging_dry_run");
  assertDeliveryModeEnabled(mode, dryRun);
  if (input.timezone) validateTimezone(input.timezone);
  if (mode === "approved_recipient" && !(input.approvedRecipient ?? current.approvedRecipient)?.trim()) {
    throw new Error("approved_recipient mode requires an approved recipient");
  }
  const recipient = input.approvedRecipient !== undefined ? input.approvedRecipient?.trim() || null : current.approvedRecipient;
  const now = nowIso();
  await exec(`INSERT INTO household_reminder_preferences
    (household_id,reminders_enabled,quiet_hours_start,quiet_hours_end,delivery_mode,staging_dry_run,approved_recipient,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(household_id) DO UPDATE SET reminders_enabled=excluded.reminders_enabled,
      quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,
      delivery_mode=excluded.delivery_mode,staging_dry_run=excluded.staging_dry_run,
      approved_recipient=excluded.approved_recipient,updated_at=excluded.updated_at`,
    [input.householdId, (input.remindersEnabled ?? current.remindersEnabled) ? 1 : 0, start, end, mode, dryRun ? 1 : 0, recipient, now]);
  return toPreferences(await queryOne<any>("SELECT * FROM household_reminder_preferences WHERE household_id=$1", [input.householdId]), input.householdId);
}

export async function pauseReminders(householdId: string): Promise<ReminderPreferences> {
  const preferences = await upsertReminderPreferences({ householdId, remindersEnabled: false });
  // Pausing is a cancellation boundary, not merely a future enqueue guard.
  // Keep every outbox/event row for auditability while canceling active work.
  await reconcileReminders(householdId);
  return preferences;
}
export async function resumeReminders(householdId: string): Promise<ReminderPreferences> {
  return upsertReminderPreferences({ householdId, remindersEnabled: true });
}

// A single query is deliberately the eligibility boundary. It prevents a
// caller from enqueueing a demo, stale-term, unverified, low-confidence,
// inapplicable, or source-less action by guessing an id.
async function eligibleAction(actionInstanceId: string): Promise<any | null> {
  const row = await queryOne<any>(`SELECT ai.*, r.institution_id, r.status AS rule_status, r.confidence,
      r.applicability, r.research_term, r.source_id, r.evidence_quote, r.updated_at AS rule_updated_at,
      rel.student_id, rel.active AS relationship_active, s.attributes, s.household_id,
      h.timezone, src.institution_id AS source_institution_id
    FROM action_instances ai
    JOIN rules r ON r.id=ai.rule_id
    JOIN institution_relationships rel ON rel.id=ai.relationship_id
    JOIN students s ON s.id=rel.student_id
    JOIN households h ON h.id=s.household_id
    LEFT JOIN sources src ON src.id=r.source_id
    WHERE ai.id=$1
      AND rel.active=1
      AND ai.state NOT IN ('completed','done','canceled')
      AND r.status='verified'
      AND r.confidence IN ('high','medium')
      AND r.applicability='applies'
      AND r.source_id IS NOT NULL
      AND NULLIF(TRIM(r.evidence_quote),'') IS NOT NULL
      AND src.id IS NOT NULL
      AND src.institution_id=r.institution_id`, [actionInstanceId]);
  if (!row) return null;
  let attrs: any = {};
  try { attrs = JSON.parse(row.attributes || "{}"); } catch { return null; }
  if (attrs.enteringTerm !== row.research_term) return null;
  const excluded = await queryOne<any>(`SELECT 1 AS excluded FROM demo_households
      WHERE household_id=$1 OR template_household_id=$1
      UNION ALL SELECT 1 FROM demo_invites WHERE template_household_id=$1 LIMIT 1`, [row.household_id]);
  if (excluded || process.env.DEMO_TEMPLATE_HOUSEHOLD_ID?.trim() === row.household_id) return null;
  return row;
}

export type EnqueueReminderInput = {
  actionInstanceId: string;
  localDate: string;
  localTime: string;
  timezone?: string;
  idempotencyKey?: string;
  directActionPath?: string;
  maxAttempts?: number;
};

export async function enqueueReminder(input: EnqueueReminderInput): Promise<{ created: boolean; reminder: ReminderOutbox | null; reason?: string }> {
  return withTransaction(async () => {
    const existingKey = input.idempotencyKey ?? `action:${input.actionInstanceId}:${input.localDate}:${input.localTime}:${input.timezone ?? "household"}`;
    // Check the action identity before returning an idempotent row. A caller
    // may not use a key belonging to another action as an oracle for its data.
    const existing = await queryOne<any>("SELECT * FROM reminder_outbox WHERE idempotency_key=$1", [existingKey]);
    if (existing) {
      if (existing.action_instance_id !== input.actionInstanceId) {
        return { created: false, reminder: null, reason: "idempotency_key_conflict" };
      }
      return { created: false, reminder: toOutbox(existing) };
    }
    const action = await eligibleAction(input.actionInstanceId);
    if (!action) return { created: false, reminder: null, reason: "not_eligible" };
    const prefs = await getReminderPreferences(action.household_id);
    if (!prefs.remindersEnabled) return { created: false, reminder: null, reason: "household_paused" };
    const timezone = input.timezone ?? action.timezone;
    validateTimezone(timezone);
    const initial = localToUtc(input.localDate, input.localTime, timezone);
    const scheduled = deferQuietHours(initial, timezone, prefs.quietHoursStart, prefs.quietHoursEnd);
    const local = localParts(scheduled, timezone);
    const mode = prefs.deliveryMode;
    assertDeliveryModeEnabled(mode, prefs.stagingDryRun);
    if (mode === "approved_recipient" && !prefs.approvedRecipient) return { created: false, reminder: null, reason: "no_approved_recipient" };
    const now = nowIso();
    const id = newId("rem");
    // directActionPath remains accepted in the input type for source
    // compatibility, but is intentionally ignored: links are action-derived.
    const path = safeActionPath(input.actionInstanceId);
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
    const values = [id, action.household_id, action.id, action.rule_id, existingKey,
      mode === "approved_recipient" ? prefs.approvedRecipient : null, mode, prefs.stagingDryRun ? 1 : 0,
      prefs.approvedRecipient, timezone, `${local.date}T${local.time}`, scheduled.toISOString(), path, maxAttempts,
      action.due_at ?? null, action.rule_updated_at, action.research_term, action.source_id, now, now];
    // INSERT ... DO NOTHING closes the check/insert race on PostgreSQL. A
    // concurrent winner is fetched below and returned as the idempotent row;
    // SQLite's serialized transaction path supports the same statement.
    await exec(`INSERT INTO reminder_outbox
      (id,household_id,action_instance_id,rule_id,idempotency_key,recipient_address,delivery_mode,staging_dry_run,
       approved_recipient,timezone,scheduled_for_local,due_at,direct_action_path,delivery_state,attempt_count,max_attempts,
       next_attempt_at,last_error,cancellation_reason,action_due_at_snapshot,rule_updated_at_snapshot,research_term_snapshot,
       source_id_snapshot,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'queued',0,$14,NULL,NULL,NULL,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (idempotency_key) DO NOTHING`, values);
    const inserted = await queryOne<any>("SELECT * FROM reminder_outbox WHERE id=$1", [id]);
    if (!inserted) {
      const winner = await queryOne<any>("SELECT * FROM reminder_outbox WHERE idempotency_key=$1", [existingKey]);
      if (!winner) throw new Error("Reminder idempotency insert was not observable");
      if (winner.action_instance_id !== input.actionInstanceId) {
        return { created: false, reminder: null, reason: "idempotency_key_conflict" };
      }
      return { created: false, reminder: toOutbox(winner) };
    }
    await exec(`INSERT INTO reminder_delivery_events
      (id,reminder_outbox_id,event_state,attempt_number,provider_event_id,detail_code,occurred_at)
      VALUES($1,$2,'queued',0,NULL,'enqueued',$3)`, [newId("rde"), id, now]);
    return { created: true, reminder: toOutbox(inserted) };
  });
}

// Alias keeps the scheduling vocabulary available to callers without
// introducing another code path.
export const scheduleReminder = enqueueReminder;

export async function getReminder(id: string): Promise<ReminderOutbox | null> {
  const row = await queryOne<any>("SELECT * FROM reminder_outbox WHERE id=$1", [id]);
  return row ? toOutbox(row) : null;
}
export async function getReminderByIdempotencyKey(key: string): Promise<ReminderOutbox | null> {
  const row = await queryOne<any>("SELECT * FROM reminder_outbox WHERE idempotency_key=$1", [key]);
  return row ? toOutbox(row) : null;
}
export async function listRemindersForHousehold(householdId: string): Promise<ReminderOutbox[]> {
  return (await queryRows<any>("SELECT * FROM reminder_outbox WHERE household_id=$1 ORDER BY created_at", [householdId])).map(toOutbox);
}
export async function listReminderDeliveryEvents(reminderId: string): Promise<ReminderDeliveryEvent[]> {
  return (await queryRows<any>("SELECT * FROM reminder_delivery_events WHERE reminder_outbox_id=$1 ORDER BY occurred_at,id", [reminderId])).map(toEvent);
}

const ALLOWED: Record<ReminderState, ReminderState[]> = {
  queued: ["queued", "sent", "delivered", "bounced", "complained", "suppressed", "failed", "canceled"],
  sent: ["sent", "delivered", "bounced", "complained", "suppressed", "failed", "canceled"],
  delivered: ["delivered"], bounced: ["bounced"], complained: ["complained"], suppressed: ["suppressed"],
  failed: ["failed", "queued", "canceled"],
  // Cancellation is the final outbox control state. A provider may still
  // report a post-cancel delivery/bounce; retain that evidence in the event
  // ledger, but never resurrect the canceled outbox row.
  canceled: ["canceled", "delivered", "bounced", "complained", "suppressed"],
};
const LATE_PROVIDER_EVIDENCE = new Set<ReminderState>(["delivered", "bounced", "complained", "suppressed"]);

export async function recordReminderDeliveryEvent(input: {
  reminderId: string;
  state: ReminderState;
  attemptNumber?: number;
  providerEventId?: string | null;
  detailCode?: string | null;
}): Promise<ReminderDeliveryEvent> {
  return withTransaction(async () => {
    // PostgreSQL row locking serializes concurrent provider callbacks for one
    // outbox row. SQLite's top-level transaction serialization supplies the
    // equivalent behavior without emitting FOR UPDATE syntax.
    const lock = usingPostgres ? " FOR UPDATE" : "";
    const outbox = await queryOne<any>(`SELECT * FROM reminder_outbox WHERE id=$1${lock}`, [input.reminderId]);
    if (!outbox) throw new Error("Reminder not found");

    // Provider IDs are idempotency keys for callbacks. Check them before
    // transition validation so a harmless retry remains harmless even after a
    // later terminal/out-of-order state has been recorded.
    if (input.providerEventId) {
      const prior = await queryOne<any>("SELECT * FROM reminder_delivery_events WHERE reminder_outbox_id=$1 AND provider_event_id=$2", [input.reminderId, input.providerEventId]);
      if (prior) return toEvent(prior);
    }

    const current = outbox.delivery_state as ReminderState;
    if (!ALLOWED[current].includes(input.state)) throw new Error(`Invalid reminder transition ${current} -> ${input.state}`);
    const currentAttemptCount = Number(outbox.attempt_count);
    const attempt = input.attemptNumber ?? (input.state === "sent" ? currentAttemptCount + 1 : currentAttemptCount);
    if (!Number.isInteger(attempt) || attempt < 0) throw new Error("attemptNumber must be a non-negative integer");
    // attempt_count is a count of actual send attempts. A failed/delivery
    // callback records the result of an existing attempt and does not add one.
    if (input.state === "sent" && attempt !== currentAttemptCount + 1) {
      throw new Error("Send attempt number must increment exactly once");
    }
    if ((input.state === "sent" || input.state === "failed") && attempt > Number(outbox.max_attempts)) {
      throw new Error("Reminder retry limit reached");
    }

    const id = newId("rde");
    const now = nowIso();
    await exec(`INSERT INTO reminder_delivery_events
      (id,reminder_outbox_id,event_state,attempt_number,provider_event_id,detail_code,occurred_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, input.reminderId, input.state, attempt, input.providerEventId ?? null, input.detailCode ?? null, now]);

    const lateEvidence = current === "canceled" && LATE_PROVIDER_EVIDENCE.has(input.state);
    if (!lateEvidence) {
      const next = input.state === "failed" && attempt < Number(outbox.max_attempts) ? new Date(Date.now() + 5 * 60_000).toISOString() : null;
      // The row lock above is the PostgreSQL race barrier; the state predicate
      // also makes the intended transition conditional if this SQL is adapted
      // for a different transaction runner in the future.
      await exec(`UPDATE reminder_outbox SET delivery_state=$1,attempt_count=$2,next_attempt_at=$3,last_error=$4,
        updated_at=$5,cancellation_reason=$6 WHERE id=$7 AND delivery_state=$8`,
        [input.state, attempt, next, input.state === "failed" ? (input.detailCode ?? "delivery_failed") : null, now,
          input.state === "canceled" ? (input.detailCode ?? "canceled") : outbox.cancellation_reason, input.reminderId, current]);
    }
    return toEvent(await queryOne<any>("SELECT * FROM reminder_delivery_events WHERE id=$1", [id]));
  });
}

export async function cancelReminder(reminderId: string, reason: string): Promise<ReminderOutbox | null> {
  const current = await getReminder(reminderId);
  if (!current || current.deliveryState === "canceled") return current;
  await recordReminderDeliveryEvent({ reminderId, state: "canceled", detailCode: reason });
  return getReminder(reminderId);
}

export async function retryFailedReminder(reminderId: string): Promise<ReminderOutbox | null> {
  const current = await getReminder(reminderId);
  if (!current || current.deliveryState !== "failed" || current.attemptCount >= current.maxAttempts) return current;
  await recordReminderDeliveryEvent({ reminderId, state: "queued", detailCode: "retry" });
  return getReminder(reminderId);
}

/** Re-checks mutable eligibility and cancels stale/paused rows without deleting history. */
export async function reconcileReminders(householdId?: string): Promise<{ canceled: number; checked: number }> {
  const rows = await queryRows<any>(`SELECT * FROM reminder_outbox
    WHERE delivery_state NOT IN ('canceled','delivered','bounced','complained','suppressed')
      ${householdId ? "AND household_id=$1" : ""} ORDER BY created_at`, householdId ? [householdId] : []);
  let canceled = 0;
  for (const row of rows) {
    const pref = await getReminderPreferences(row.household_id);
    let reason: string | null = !pref.remindersEnabled ? "household_paused" : null;
    const current = await eligibleAction(row.action_instance_id);
    if (!reason && !current) {
      const state = await queryOne<any>("SELECT state FROM action_instances WHERE id=$1", [row.action_instance_id]);
      reason = state && ["completed", "done"].includes(state.state) ? "action_completed" : "research_unsafe_or_not_applicable";
    }
    if (!reason && (current.due_at ?? null) !== (row.action_due_at_snapshot ?? null)) reason = "action_date_changed";
    if (!reason && current.rule_updated_at !== row.rule_updated_at_snapshot) reason = "rule_changed";
    if (!reason && current.source_id !== row.source_id_snapshot) reason = "research_unsafe_or_source_changed";
    if (reason) { await cancelReminder(row.id, reason); canceled++; }
  }
  return { canceled, checked: rows.length };
}

// Useful for tests and future adapters; no provider operation is performed.
export function reminderLocalTime(instant: Date, timezone: string): { date: string; time: string } {
  validateTimezone(timezone); return localParts(instant, timezone);
}
