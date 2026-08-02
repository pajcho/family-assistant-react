// supabase/functions/send-due-pushes/plan.ts
//
// The pure half of send-due-pushes: given every row the job needs plus the
// current instant, decide which pushes are due. No Supabase client, no
// web-push, no Deno globals - so it runs under vitest (see plan.test.ts) and
// the whole timezone / idempotency surface is unit-testable.
//
// `index.ts` is the I/O shell around this: it bulk-loads the rows, calls
// `planDispatch`, claims every planned slot with one `notification_log`
// upsert, sends what the claim granted, and bulk-deletes dead subscriptions.
//
// Five dispatch paths, in the order their results are reported:
//
//   1. digests            - per user, at their configured morning/evening time
//   2. event reminders    - per event, to subscribed family members
//   3. payment reminders  - per unpaid payment, at each recipient's morning time
//   4. activity reminders - per weekly-schedule occurrence, per participant
//   5. external reminders - per mirrored Google event occurrence
//
// Paths 2-5 fan out per family member but only to members with a push
// subscription (see `claimableSubs` for why that filter must happen before
// the claim).
//
// Idempotency is unchanged: every planned push carries a
// (user_id, kind, ref_id) key that `notification_log` protects with a UNIQUE
// constraint. Planning only decides *what* to claim; the claim itself still
// happens in Postgres.

export type DigestKind = "morning_digest" | "evening_digest";

export type NotificationKind =
  | DigestKind
  | "event_reminder"
  | "payment_reminder"
  | "activity_reminder"
  | "external_reminder";

// --- input rows -------------------------------------------------------------

export interface PrefsRow {
  user_id: string;
  morning_enabled: boolean;
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  timezone: string;
}

export interface PushSubRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface ProfileRow {
  id: string;
  family_id: string;
  first_name: string | null;
  last_name: string | null;
}

export interface EventRow {
  id: string;
  family_id: string;
  name: string;
  date: string;
  start_time: string | null;
  remind_minutes_before: number | null;
}

export interface PaymentRow {
  id: string;
  family_id: string;
  name: string;
  amount: number;
  due_date: string;
  remind_days_before: number | null;
}

export interface BirthdayRow {
  id: string;
  family_id: string;
  name: string;
  birth_date: string;
}

export interface ExternalLocalRow {
  family_id: string;
  ical_uid: string;
  remind_minutes_before: number;
}

export interface ExternalEventRow {
  id: string;
  family_id: string;
  title: string | null;
  local_date: string;
  start_time: string;
  ical_uid: string;
}

export interface ActivityRow {
  id: string;
  family_id: string;
  name: string;
  active_from: string | null;
  active_to: string | null;
  is_paused: boolean;
  remind_minutes_before: number;
  created_at: string;
}

export interface ScheduleRuleRow {
  id: string;
  activity_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  week_pattern: "every" | "A" | "B";
  recurrence_interval_weeks: number;
}

export interface ParticipantRow {
  activity_id: string;
  person_id: string;
}

export interface ActivityOverrideRow {
  id: string;
  schedule_id: string;
  person_id: string;
  date: string;
  action: "cancel" | "reschedule";
  override_start_time: string | null;
  override_end_time: string | null;
  override_date: string | null;
}

export interface ShiftAnchorRow {
  person_id: string;
  anchor_week_start: string;
  anchor_shift: "morning" | "afternoon";
  flip_interval_weeks: number;
  is_alternating: boolean;
}

/** Everything `loadDispatchContext` pulls, plus the instant being evaluated. */
export interface DispatchInput {
  now: Date;
  force: DigestKind | null;
  prefs: PrefsRow[];
  profiles: ProfileRow[];
  subs: PushSubRow[];
  events: EventRow[];
  payments: PaymentRow[];
  birthdays: BirthdayRow[];
  externalLocals: ExternalLocalRow[];
  externalEvents: ExternalEventRow[];
  activities: ActivityRow[];
  schedule: ScheduleRuleRow[];
  participants: ParticipantRow[];
  overrides: ActivityOverrideRow[];
  anchors: ShiftAnchorRow[];
}

// --- output -----------------------------------------------------------------

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * One (user, kind, ref_id) slot to claim in `notification_log`.
 *
 * The claim is always attempted, even when nothing ends up being sent - that
 * mirrors the pre-refactor code, where the digest path inserted its log row
 * before it knew whether the day had any content.
 */
export interface PlannedClaim {
  userId: string;
  kind: NotificationKind;
  refId: string;
  /** Identifying fields of the response entry for this claim. */
  result: Record<string, unknown>;
  /** What to send once the claim is granted; null means "claim only". */
  push: PushPayload | null;
  /** Reported status when `push` is null (e.g. "nothing_to_send"). */
  emptyStatus: string | null;
  /** Extra response fields, only when the push actually goes out. */
  sentResult?: Record<string, unknown>;
  /** Recipient's subscriptions; empty with a non-null push = no_subscriptions. */
  subs: PushSubRow[];
}

const FAMILY_TZ_DEFAULT = "Europe/Belgrade";
const DEFAULT_MORNING_TIME = "08:00";

/**
 * How far around UTC "today" the bulk reads have to reach. Local dates run
 * from UTC-12 to UTC+14, so a user's *tomorrow* (the evening digest target)
 * can be two days past the UTC date, and their *yesterday* one day behind.
 */
export const EVENT_WINDOW_DAYS_BEFORE = 1;
export const EVENT_WINDOW_DAYS_AFTER = 2;
/** Longest `remind_days_before` preset plus a day of timezone slack. */
export const PAYMENT_WINDOW_DAYS_AFTER = 14;

export function utcDateOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function planDispatch(input: DispatchInput): PlannedClaim[] {
  const idx = buildIndex(input);
  return [
    ...planDigests(input, idx),
    ...planEventReminders(input, idx),
    ...planPaymentReminders(input, idx),
    ...planActivityReminders(input, idx),
    ...planExternalReminders(input, idx),
  ];
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

interface Index {
  prefsByUser: Map<string, PrefsRow>;
  tzByUser: Map<string, string>;
  profileById: Map<string, ProfileRow>;
  profilesByFamily: Map<string, ProfileRow[]>;
  subsByUser: Map<string, PushSubRow[]>;
  eventsByFamilyDate: Map<string, EventRow[]>;
  paymentsByFamilyDate: Map<string, PaymentRow[]>;
  birthdaysByFamily: Map<string, BirthdayRow[]>;
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function buildIndex(input: DispatchInput): Index {
  const prefsByUser = new Map(input.prefs.map((p) => [p.user_id, p]));
  const tzByUser = new Map(input.prefs.map((p) => [p.user_id, p.timezone]));
  const profileById = new Map(input.profiles.map((p) => [p.id, p]));

  const profilesByFamily = new Map<string, ProfileRow[]>();
  for (const p of input.profiles) pushInto(profilesByFamily, p.family_id, p);

  const subsByUser = new Map<string, PushSubRow[]>();
  for (const s of input.subs) pushInto(subsByUser, s.user_id, s);

  const eventsByFamilyDate = new Map<string, EventRow[]>();
  for (const e of input.events) pushInto(eventsByFamilyDate, `${e.family_id}|${e.date}`, e);

  const paymentsByFamilyDate = new Map<string, PaymentRow[]>();
  for (const p of input.payments) pushInto(paymentsByFamilyDate, `${p.family_id}|${p.due_date}`, p);

  const birthdaysByFamily = new Map<string, BirthdayRow[]>();
  for (const b of input.birthdays) pushInto(birthdaysByFamily, b.family_id, b);

  return {
    prefsByUser,
    tzByUser,
    profileById,
    profilesByFamily,
    subsByUser,
    eventsByFamilyDate,
    paymentsByFamilyDate,
    birthdaysByFamily,
  };
}

/**
 * Subscriptions for a family member who may take a `notification_log` claim,
 * or null when the member must be skipped BEFORE the claim.
 *
 * Skipping sub-less members up front is load-bearing, not an optimisation:
 * kid profiles exist in `profiles` without an `auth.users` row, and
 * `notification_log.user_id` references `auth.users`, so a claim for them is
 * rejected - and because `index.ts` claims the whole tick in one batched
 * upsert, that single bad row used to void every push of the minute.
 * Subscription holders are always safe: `push_subscriptions.user_id` carries
 * the same FK, so a sub proves the auth user exists. Digests don't need this
 * guard - their recipients come from `notification_preferences`, which is
 * FK'd to `auth.users` too.
 */
function claimableSubs(idx: Index, memberId: string): PushSubRow[] | null {
  const subs = idx.subsByUser.get(memberId);
  return subs !== undefined && subs.length > 0 ? subs : null;
}

// ---------------------------------------------------------------------------
// 1. Digests
// ---------------------------------------------------------------------------

function planDigests(input: DispatchInput, idx: Index): PlannedClaim[] {
  const out: PlannedClaim[] = [];
  // Only users who opted into at least one digest are candidates - `force`
  // skips the clock check, not the opt-in.
  for (const pref of input.prefs) {
    if (!pref.morning_enabled && !pref.evening_enabled) continue;

    if (pref.morning_enabled || input.force === "morning_digest") {
      if (
        input.force === "morning_digest" ||
        isCurrentMinute(pref.timezone, pref.morning_time, input.now)
      ) {
        out.push(planDigest(input, idx, pref, "morning_digest"));
      }
    }
    if (pref.evening_enabled || input.force === "evening_digest") {
      if (
        input.force === "evening_digest" ||
        isCurrentMinute(pref.timezone, pref.evening_time, input.now)
      ) {
        out.push(planDigest(input, idx, pref, "evening_digest"));
      }
    }
  }
  return out;
}

function planDigest(
  input: DispatchInput,
  idx: Index,
  pref: PrefsRow,
  kind: DigestKind,
): PlannedClaim {
  const todayLocal = localDateISO(pref.timezone, input.now);
  const targetDate = kind === "morning_digest" ? todayLocal : addDays(todayLocal, 1);
  const summaryNoun = kind === "morning_digest" ? "Danas" : "Sutra";
  const title = kind === "morning_digest" ? "Dobro jutro" : "Pregled za sutra";

  const base = {
    userId: pref.user_id,
    kind,
    refId: targetDate,
    result: { user_id: pref.user_id, kind },
    subs: idx.subsByUser.get(pref.user_id) ?? [],
  };

  const familyId = idx.profileById.get(pref.user_id)?.family_id;
  if (!familyId) {
    return { ...base, push: null, emptyStatus: "no_family" };
  }

  const events = idx.eventsByFamilyDate.get(`${familyId}|${targetDate}`) ?? [];
  const payments = idx.paymentsByFamilyDate.get(`${familyId}|${targetDate}`) ?? [];
  const birthdays = (idx.birthdaysByFamily.get(familyId) ?? []).filter((b) =>
    sameMonthDay(b.birth_date, targetDate),
  );

  if (events.length === 0 && payments.length === 0 && birthdays.length === 0) {
    return { ...base, push: null, emptyStatus: "nothing_to_send" };
  }

  const counts: string[] = [];
  if (events.length)
    counts.push(`${events.length} ${plural(events.length, "događaj", "događaja")}`);
  if (payments.length)
    counts.push(`${payments.length} ${plural(payments.length, "plaćanje", "plaćanja")}`);
  if (birthdays.length)
    counts.push(`${birthdays.length} ${plural(birthdays.length, "rođendan", "rođendana")}`);

  const body = `${summaryNoun}: ${counts.join(", ")}.`;

  return {
    ...base,
    push: { title, body, url: "/", tag: `${kind}-${targetDate}` },
    emptyStatus: null,
    sentResult: { ref_id: targetDate, body },
  };
}

// ---------------------------------------------------------------------------
// 2. Event reminders
// ---------------------------------------------------------------------------

function planEventReminders(input: DispatchInput, idx: Index): PlannedClaim[] {
  const utcToday = utcDateOf(input.now);
  const reminderWindow = new Set([addDays(utcToday, -1), utcToday, addDays(utcToday, 1)]);

  const out: PlannedClaim[] = [];
  for (const ev of input.events) {
    if (ev.remind_minutes_before == null || ev.start_time == null) continue;
    if (!reminderWindow.has(ev.date)) continue;

    const members = idx.profilesByFamily.get(ev.family_id) ?? [];
    if (members.length === 0) continue;

    const fire = eventLocalFireTime(ev.date, ev.start_time, ev.remind_minutes_before);
    for (const member of members) {
      const subs = claimableSubs(idx, member.id);
      if (!subs) continue; // no push -> not a recipient (see claimableSubs)
      const tz = idx.tzByUser.get(member.id) ?? FAMILY_TZ_DEFAULT;
      if (localDateISO(tz, input.now) !== fire.date || localTime(tz, input.now) !== fire.time) {
        continue;
      }
      const startHHMM = ev.start_time.slice(0, 5);
      out.push({
        userId: member.id,
        kind: "event_reminder",
        refId: ev.id,
        result: { user_id: member.id, kind: "event_reminder", event_id: ev.id },
        push: {
          title: ev.name,
          body: `Počinje za ${ev.remind_minutes_before} min (u ${startHHMM}).`,
          url: "/events",
          tag: `event-reminder-${ev.id}`,
        },
        emptyStatus: null,
        subs,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Payment reminders
// ---------------------------------------------------------------------------

function planPaymentReminders(input: DispatchInput, idx: Index): PlannedClaim[] {
  const out: PlannedClaim[] = [];
  for (const pay of input.payments) {
    if (pay.remind_days_before == null) continue;

    const members = idx.profilesByFamily.get(pay.family_id) ?? [];
    if (members.length === 0) continue;

    const fireDate = addDays(pay.due_date, -pay.remind_days_before);
    const refId = `${pay.id}:${pay.due_date}`;

    for (const member of members) {
      const subs = claimableSubs(idx, member.id);
      if (!subs) continue; // no push -> not a recipient (see claimableSubs)
      // morning_time + timezone live on notification_preferences; a user who
      // never opened settings falls back to the table defaults.
      const pref = idx.prefsByUser.get(member.id);
      const tz = pref?.timezone ?? FAMILY_TZ_DEFAULT;
      const fireHHMM = (pref?.morning_time ?? DEFAULT_MORNING_TIME).slice(0, 5);

      if (localDateISO(tz, input.now) !== fireDate || localTime(tz, input.now) !== fireHHMM) {
        continue;
      }

      out.push({
        userId: member.id,
        kind: "payment_reminder",
        refId,
        result: { user_id: member.id, kind: "payment_reminder", payment_id: pay.id },
        push: {
          title: pay.name,
          body: paymentReminderBody(pay),
          url: "/payments",
          tag: `payment-reminder-${pay.id}-${pay.due_date}`,
        },
        emptyStatus: null,
        subs,
      });
    }
  }
  return out;
}

function paymentReminderBody(pay: PaymentRow): string {
  const amount = formatAmount(pay.amount);
  if (pay.remind_days_before === 0) return `Dospeva danas: ${amount} RSD.`;
  if (pay.remind_days_before === 1) return `Dospeva sutra: ${amount} RSD.`;
  return `Dospeva za ${pay.remind_days_before} dana: ${amount} RSD.`;
}

function formatAmount(amount: number): string {
  // Serbian thousands separator is ".", and these amounts are always
  // whole-RSD in this app - keep formatting minimal and locale-correct.
  return new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 0 }).format(amount);
}

// ---------------------------------------------------------------------------
// 4. Activity reminders
// ---------------------------------------------------------------------------
//
// Activities are weekly recurring schedules with multi-person participants
// and per-occurrence overrides. To decide if a reminder fires *now*, we
// replicate the frontend resolver inline (Deno can't import frontend utils)
// and then match against each recipient's local clock.
//
// Idempotency key extends the event_reminder pattern with the date and
// person - `<schedule_id>:<YYYY-MM-DD>:<person_id>` - so the same rule firing
// in different weeks logs independently and each participant claims their own
// slot.

function planActivityReminders(input: DispatchInput, idx: Index): PlannedClaim[] {
  if (input.activities.length === 0) return [];

  const activityById = new Map(input.activities.map((a) => [a.id, a]));
  const ruleById = new Map(input.schedule.map((r) => [r.id, r]));
  const anchorByPerson = new Map(input.anchors.map((a) => [a.person_id, a]));

  const overrideByKey = new Map<string, ActivityOverrideRow>();
  for (const o of input.overrides) {
    overrideByKey.set(overrideKey(o.schedule_id, o.date, o.person_id), o);
  }
  const personsByActivity = new Map<string, string[]>();
  for (const p of input.participants) pushInto(personsByActivity, p.activity_id, p.person_id);

  // Pick a "family timezone" for day-of-week / override lookups. Any auth
  // user's tz works because we assume family members share a locale; falls
  // back to Belgrade so kid-only activities still resolve.
  const familyTz = (familyId: string): string => {
    for (const p of idx.profilesByFamily.get(familyId) ?? []) {
      const tz = idx.tzByUser.get(p.id);
      if (tz) return tz;
    }
    return FAMILY_TZ_DEFAULT;
  };

  const out: PlannedClaim[] = [];

  // Pass 1 - walk rules x participants against today in the family's clock.
  for (const rule of input.schedule) {
    const activity = activityById.get(rule.activity_id);
    if (!activity) continue;
    const persons = personsByActivity.get(activity.id);
    if (!persons || persons.length === 0) continue;

    const familyToday = localDateISO(familyTz(activity.family_id), input.now);

    for (const personId of persons) {
      if (!matchesRuleOnDate(activity, rule, anchorByPerson.get(personId), familyToday)) continue;

      const override = overrideByKey.get(overrideKey(rule.id, familyToday, personId));
      let effectiveStart = rule.start_time.slice(0, 5);
      if (override) {
        if (override.action === "cancel") continue;
        if (override.action === "reschedule") {
          const movedAway = !!override.override_date && override.override_date !== familyToday;
          if (movedAway) continue; // fires on a different day; pass 2 handles it
          if (override.override_start_time) {
            effectiveStart = override.override_start_time.slice(0, 5);
          }
        }
      }

      out.push(
        ...planActivityOccurrence(
          input,
          idx,
          activity,
          personId,
          rule.id,
          familyToday,
          effectiveStart,
        ),
      );
    }
  }

  // Pass 2 - moved-here overrides whose new date is today in the family tz.
  for (const ov of input.overrides) {
    if (ov.action !== "reschedule") continue;
    if (!ov.override_date) continue;
    if (ov.override_date === ov.date) continue; // same-day handled in pass 1
    if (!ov.override_start_time) continue;

    const rule = ruleById.get(ov.schedule_id);
    if (!rule) continue;
    const activity = activityById.get(rule.activity_id);
    if (!activity) continue;
    if (!activity.remind_minutes_before) continue;

    const familyToday = localDateISO(familyTz(activity.family_id), input.now);
    if (ov.override_date !== familyToday) continue;

    if (activity.active_from && ov.override_date < activity.active_from) continue;
    if (activity.active_to && ov.override_date > activity.active_to) continue;
    // Participant might have been removed from the activity after the override
    // was set - same silent-skip-and-reactivate semantic.
    const persons = personsByActivity.get(activity.id);
    if (!persons?.includes(ov.person_id)) continue;

    out.push(
      ...planActivityOccurrence(
        input,
        idx,
        activity,
        ov.person_id,
        rule.id,
        ov.override_date,
        ov.override_start_time.slice(0, 5),
      ),
    );
  }

  return out;
}

/**
 * Fan one occurrence out to every push-subscribed family member.
 *
 * The participant is who the activity is FOR (often a kid without a login);
 * the recipients are whoever in the family actually has push subscriptions
 * (typically the parents). Members without a subscription are skipped before
 * the claim, so they never take a `notification_log` slot.
 *
 * Body wording flips based on whether the recipient is also the participant -
 * "Trening fudbala" for self, "Lucija • Trening fudbala" for a parent
 * receiving a kid's reminder.
 */
function planActivityOccurrence(
  input: DispatchInput,
  idx: Index,
  activity: ActivityRow,
  participantPersonId: string,
  scheduleId: string,
  occurrenceDate: string,
  effectiveStart: string,
): PlannedClaim[] {
  const refId = `${scheduleId}:${occurrenceDate}:${participantPersonId}`;
  const participant = idx.profileById.get(participantPersonId);
  const participantName = participant
    ? [participant.first_name, participant.last_name].filter(Boolean).join(" ").trim()
    : "";

  const fire = eventLocalFireTime(occurrenceDate, effectiveStart, activity.remind_minutes_before);
  const out: PlannedClaim[] = [];

  for (const recipient of idx.profilesByFamily.get(activity.family_id) ?? []) {
    const subs = claimableSubs(idx, recipient.id);
    if (!subs) continue; // no push -> not a recipient (see claimableSubs)

    const recipientTz = idx.tzByUser.get(recipient.id) ?? FAMILY_TZ_DEFAULT;
    if (
      localDateISO(recipientTz, input.now) !== fire.date ||
      localTime(recipientTz, input.now) !== fire.time
    ) {
      continue;
    }

    const isForSelf = recipient.id === participantPersonId;
    const title =
      isForSelf || !participantName ? activity.name : `${participantName} • ${activity.name}`;

    out.push({
      userId: recipient.id,
      kind: "activity_reminder",
      refId,
      result: { user_id: recipient.id, kind: "activity_reminder", ref_id: refId },
      push: {
        title,
        body: `Počinje za ${activity.remind_minutes_before} min (u ${effectiveStart}).`,
        url: "/activities",
        tag: `activity-reminder-${refId}-${recipient.id}`,
      },
      emptyStatus: null,
      subs,
    });
  }
  return out;
}

function overrideKey(scheduleId: string, date: string, personId: string): string {
  return `${scheduleId}|${date}|${personId}`;
}

/**
 * Returns true if `rule` fires on `localDate` for the person owning
 * `shiftAnchor`, ignoring any override row (override application happens after
 * this check so a cancel can still see the underlying "would have fired" state).
 */
function matchesRuleOnDate(
  activity: ActivityRow,
  rule: ScheduleRuleRow,
  shiftAnchor: ShiftAnchorRow | undefined,
  localDate: string,
): boolean {
  // Day-of-week
  if (rule.day_of_week !== mondayFirstDowFor(localDate)) return false;

  // Active window
  if (activity.active_from && localDate < activity.active_from) return false;
  if (activity.active_to && localDate > activity.active_to) return false;

  // Every-N-weeks modulo against the activity's anchor (Monday of active_from
  // or created_at).
  const interval = Math.max(1, Math.floor(rule.recurrence_interval_weeks || 1));
  if (interval > 1) {
    const anchorSource = (activity.active_from ?? activity.created_at).slice(0, 10);
    const diff = weeksBetweenMondays(mondayOfWeek(anchorSource), mondayOfWeek(localDate));
    if (diff < 0 || diff % interval !== 0) return false;
  }

  // A/B pattern via this person's shift anchor.
  if (rule.week_pattern !== "every") {
    if (!shiftAnchor) return false;
    const shift = deriveShiftForWeek(shiftAnchor, mondayOfWeek(localDate));
    if (rule.week_pattern === "A" && shift !== "morning") return false;
    if (rule.week_pattern === "B" && shift !== "afternoon") return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// 5. External (mirrored Google) reminders
// ---------------------------------------------------------------------------
//
// The reminder offset lives on external_event_local (per family + ical_uid);
// the fire time comes from the matching mirrored event instance(s) in
// external_calendar_events. Recurring events share an ical_uid, so the
// reminder applies to each occurrence. Only TIMED events get reminders
// (all-day has no start). ref_id `<ical_uid>:<local_date>` is stable across
// re-syncs (the event row's own id is not) so an occurrence fires exactly once.

function planExternalReminders(input: DispatchInput, idx: Index): PlannedClaim[] {
  if (input.externalLocals.length === 0) return [];

  const remindByKey = new Map<string, number>();
  for (const r of input.externalLocals) {
    remindByKey.set(`${r.family_id}|${r.ical_uid}`, r.remind_minutes_before);
  }

  const out: PlannedClaim[] = [];
  for (const ev of input.externalEvents) {
    const remind = remindByKey.get(`${ev.family_id}|${ev.ical_uid}`);
    if (remind == null) continue;

    const members = idx.profilesByFamily.get(ev.family_id) ?? [];
    if (members.length === 0) continue;

    const fire = eventLocalFireTime(ev.local_date, ev.start_time, remind);
    const refId = `${ev.ical_uid}:${ev.local_date}`;

    for (const member of members) {
      const subs = claimableSubs(idx, member.id);
      if (!subs) continue; // no push -> not a recipient (see claimableSubs)
      const tz = idx.tzByUser.get(member.id) ?? FAMILY_TZ_DEFAULT;
      if (localDateISO(tz, input.now) !== fire.date || localTime(tz, input.now) !== fire.time) {
        continue;
      }
      const startHHMM = ev.start_time.slice(0, 5);
      out.push({
        userId: member.id,
        kind: "external_reminder",
        refId,
        result: { user_id: member.id, kind: "external_reminder", ref_id: refId },
        push: {
          title: ev.title ?? "Google događaj",
          body: `Počinje za ${remind} min (u ${startHHMM}).`,
          url: "/uskoro",
          tag: `external-reminder-${refId}`,
        },
        emptyStatus: null,
        subs,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Given an item's date + start_time + offset, return the wall-clock date+time
 * of the reminder. Handles day-rollover when an item near midnight has an
 * offset that crosses the previous day boundary (e.g. 00:15 start with
 * `remind_minutes_before=30` -> previous day 23:45).
 */
export function eventLocalFireTime(
  eventDate: string,
  startTimeHHMMSS: string,
  remindMinutesBefore: number,
): { date: string; time: string } {
  const [h, m] = startTimeHHMMSS.split(":").map(Number);
  const totalMinutes = h * 60 + m - remindMinutesBefore;
  if (totalMinutes >= 0) {
    return {
      date: eventDate,
      time: `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`,
    };
  }
  const prev = addDays(eventDate, -1);
  const prevMinutes = 24 * 60 + totalMinutes;
  return { date: prev, time: `${pad2(Math.floor(prevMinutes / 60))}:${pad2(prevMinutes % 60)}` };
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function mondayFirstDowFor(yyyymmdd: string): number {
  // JS Date.getUTCDay returns 0=Sun..6=Sat; the frontend uses 0=Mon..6=Sun.
  const d = new Date(yyyymmdd + "T12:00:00Z");
  return (d.getUTCDay() + 6) % 7;
}

function mondayOfWeek(yyyymmdd: string): string {
  const d = new Date(yyyymmdd + "T12:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0=Mon
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function weeksBetweenMondays(fromMondayISO: string, toMondayISO: string): number {
  const from = Date.parse(fromMondayISO + "T12:00:00Z");
  const to = Date.parse(toMondayISO + "T12:00:00Z");
  return Math.round((to - from) / (7 * 24 * 60 * 60 * 1000));
}

function deriveShiftForWeek(
  anchor: ShiftAnchorRow,
  targetMondayISO: string,
): "morning" | "afternoon" {
  if (!anchor.is_alternating) return anchor.anchor_shift;
  const interval = Math.max(1, Math.floor(anchor.flip_interval_weeks || 1));
  const diff = weeksBetweenMondays(anchor.anchor_week_start, targetMondayISO);
  const flips = Math.floor(diff / interval);
  const flipsMod = ((flips % 2) + 2) % 2;
  if (flipsMod === 0) return anchor.anchor_shift;
  return anchor.anchor_shift === "morning" ? "afternoon" : "morning";
}

function isCurrentMinute(tz: string, pgTime: string, now: Date): boolean {
  // Postgres TIME can come back as "HH:MM:SS"; the digest setting is a
  // wall-clock time, so we only care about the HH:MM portion.
  return localTime(tz, now) === pgTime.slice(0, 5);
}

export function localTime(tz: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return "";
  }
}

export function localDateISO(tz: string, now: Date): string {
  // en-CA gives us YYYY-MM-DD, which lines up with Postgres DATE
  // representation regardless of the user's locale preferences.
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sameMonthDay(birthISO: string, dateISO: string): boolean {
  // birthISO can be "YYYY-MM-DD"; we only compare MM-DD so birthdays recur
  // every year.
  return birthISO.slice(5) === dateISO.slice(5);
}

function plural(n: number, singular: string, many: string): string {
  return n === 1 ? singular : many;
}
