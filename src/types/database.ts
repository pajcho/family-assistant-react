export interface Family {
  id: string;
  name: string;
  /** Currencies the entry forms offer ('RSD' is the base and always present -
   *  DB CHECK `families_rsd_always_enabled`). Disabling one never touches
   *  existing rows, it only narrows the choice for NEW entries. */
  enabled_currencies: string[];
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  family_id: string;
  /**
   * Computed by a Postgres trigger from `first_name` + `last_name` -
   * still present on the row but the UI no longer writes to it directly.
   */
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  /**
   * Hex color (e.g. "#3b82f6") used to render this person's activities and
   * other per-person UI. Null = no color picked yet; the UI falls back to a
   * deterministic placeholder derived from the id.
   */
  color: string | null;
  /**
   * Family admin - may create/disable logins, manage the roster (add/remove
   * members, set colors, mark students), and rename the family. Backfilled
   * `true` for everyone who had a login when the role was introduced; new
   * login-less members default `false`. Enforced in RLS via `is_family_admin()`.
   */
  is_admin: boolean;
  /**
   * True iff this profile's `id` matches a row in `auth.users` - i.e. the
   * person has their own Supabase login. Derived at query time by the
   * `profiles_with_login` view; not stored on the row itself. Optional
   * here because not every read path goes through the view.
   */
  has_login?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  remind_minutes_before: number | null;
  /**
   * Soft cancel. NULL = active; an ISO timestamp = canceled (and when).
   * Canceled events drop off the dashboard / upcoming list but are kept so
   * the calendar can still show them struck-through. "Rescheduling" an event
   * changes `date` (and optionally the times) - no history is kept.
   */
  canceled_at: string | null;
  /** Optional free-text reason entered when canceling. Cleared on restore. */
  cancel_reason: string | null;
  /**
   * Set when the event was created via "Organizuj proslavu" on the birthdays
   * page - links the celebration back to its birthday so the birthday row can
   * show a "proslava zakazana" chip. ON DELETE SET NULL.
   */
  birthday_id: string | null;
  /**
   * Optional free-text reason entered the last time the event was moved
   * ("Pomeri"). A reschedule overwrites `date`/times in place with no history,
   * so this reflects only the MOST RECENT move (NULL when left blank).
   * Independent of `cancel_reason`.
   */
  reschedule_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Who an event is for. Junction table mirroring `ActivityParticipant`, but an
 * event may have ZERO participants (a family-wide event needs no assignee).
 */
export interface EventParticipant {
  event_id: string;
  person_id: string;
  family_id: string;
  created_at: string;
}

export type RecurrencePeriod = "monthly" | "weekly" | "limited" | "one-time";

export interface Payment {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  /** ALWAYS the RSD value (converted at entry for foreign-currency payments) -
   *  projections and month summaries sum it currency-blind. */
  amount: number;
  /** Currency the payment was DEFINED in ("RSD" | "EUR" | …). */
  currency: string;
  /** What was actually typed for a foreign-currency payment; null for RSD. */
  original_amount: number | null;
  /** NBS middle rate frozen at entry (1 unit of `currency` = N RSD); null for
   *  RSD. Occurrences and history stay RSD - only the definition carries this. */
  exchange_rate: number | null;
  due_date: string;
  is_recurring: boolean;
  recurrence_period: RecurrencePeriod | null;
  /**
   * "Every N periods" knob - meaningful for `monthly` (every N months) and
   * `weekly` (every N weeks). `one-time` and `limited` ignore this and always
   * behave as if interval = 1. Column is NOT NULL with a default of 1 in the
   * DB so old rows back-fill correctly.
   */
  recurrence_interval: number;
  remaining_occurrences: number | null;
  is_paid: boolean;
  is_paused: boolean;
  /**
   * Marks a recurring bill whose amount varies each period (struja, infostan…).
   * When true, `amount` is only a rough default ("okvirni iznos") used for
   * projections, and each "mark as paid" prompts for the actual amount - which
   * is snapshotted into `payment_history.amount` (and the auto-expense). Only
   * ever true for recurring payments; the form gates the toggle. Defaults false.
   */
  is_variable_amount: boolean;
  paid_date: string | null;
  remind_days_before: number | null;
  /**
   * Optional link to the activity this payment pays for (e.g. "Engleski
   * Lucija" ← monthly tuition). A payment links to AT MOST ONE thing - one
   * activity OR one event - enforced by the `payments_single_link` CHECK
   * (`num_nonnulls(activity_id, event_id) <= 1`). The reverse direction is
   * unbounded: an activity/event can have many linked payments. ON DELETE
   * SET NULL, so removing the activity detaches the link but keeps the
   * payment (and its history) intact.
   */
  activity_id: string | null;
  /** Optional link to the event this payment pays for. XOR with `activity_id` - see above. */
  event_id: string | null;
  /**
   * Optional link to a birthday (poklon-tracking: "poklon za Markov
   * rođendan"). Part of the same `payments_single_link` CHECK - a payment
   * links to at most ONE of activity/event/birthday. ON DELETE SET NULL.
   */
  birthday_id: string | null;
  /**
   * Optional budget category (Faza 3). Categorize a recurring bill once and
   * every paid occurrence's auto-expense inherits it. ON DELETE SET NULL, so
   * removing a category detaches without touching the payment.
   */
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentHistoryStatus = "paid" | "canceled";

export interface PaymentHistory {
  id: string;
  payment_id: string;
  family_id: string;
  /** ALWAYS the RSD value paid for this occurrence. */
  amount: number;
  /** Currency this occurrence was CONFIRMED in ("RSD" | "EUR" | …). */
  currency: string;
  /** Typed foreign amount + the rate used for THIS occurrence (default: NBS
   *  middle rate on the pay date, editable in the confirm step); null for RSD.
   *  Each occurrence freezes its own conversion - not the definition-time one. */
  original_amount: number | null;
  exchange_rate: number | null;
  due_date: string;
  /** When it was actually paid. NULL for canceled occurrences. */
  paid_date: string | null;
  /** Whether this occurrence was paid or canceled (skipped). */
  status: PaymentHistoryStatus;
  /** Optional reason - currently used for cancellations. */
  note: string | null;
  /**
   * Snapshot of the payment's name at the moment this occurrence was
   * paid/canceled - frozen so a later rename on the live payment doesn't
   * rewrite history. NULL only for rows created before this column existed
   * (the UI falls back to the live payment name).
   */
  name: string | null;
  created_at: string;
}

/**
 * Who a payment is for. Junction table mirroring `EventParticipant` - a
 * payment may have ZERO participants (a shared household bill).
 */
export interface PaymentParticipant {
  payment_id: string;
  person_id: string;
  family_id: string;
  created_at: string;
}

export type PaymentOverrideAction = "cancel" | "reschedule";

/**
 * Per-occurrence override on a recurring payment, applied as a display layer
 * by the frontend occurrence synthesizer (never mutates the live row or the
 * mark-paid accounting). Keyed by the ORIGINAL projected due date.
 */
export interface PaymentOverride {
  id: string;
  payment_id: string;
  family_id: string;
  /** YYYY-MM-DD - the original projected due date this override keys on. */
  occurrence_date: string;
  action: PaymentOverrideAction;
  /** Required for `'reschedule'` (the new date); NULL for `'cancel'`. */
  override_date: string | null;
  /** Optional free-text reason for either action. */
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Birthday {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  birth_date: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Budget (Faza 3/4) - expense categories + the expenses ledger + incomes
// ---------------------------------------------------------------------------

/**
 * A family-editable spend bucket. `icon` is a short key the UI maps to a
 * heroicon (see `categoryIcon`); `color` is a hex string like profiles.color.
 * `monthly_limit` (Faza 4) is an optional RSD ceiling - NULL = untracked.
 */
export interface ExpenseCategory {
  id: string;
  family_id: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  monthly_limit: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * How an expense entered the ledger. `manual` = typed in the quick-add;
 * `payment` = auto-written by the payment trigger when an occurrence is marked
 * paid (read-only in the UI); `receipt` = fiscal QR import (Faza 5).
 */
export type ExpenseSource = "manual" | "payment" | "receipt";

/**
 * One spend entry. Auto rows (`source='payment'`) carry `payment_id` +
 * `payment_due_date` (the occurrence they came from - also the trigger's
 * idempotency key) and inherit the payment's category/link. Receipt rows
 * (`source='receipt'`) carry `merchant` + `receipt_url` (the SUF verification
 * link, globally-unique dedup key) and own a set of `expense_items` loaded
 * lazily on detail. `activity_id` / `event_id` are XOR, mirroring payments.
 */
export interface Expense {
  id: string;
  family_id: string;
  /** ALWAYS the RSD value (converted at entry for foreign-currency rows) -
   *  every aggregation sums it currency-blind. */
  amount: number;
  currency: string;
  /** What was actually typed for a foreign-currency entry (e.g. 50 = 50 EUR);
   *  null for RSD rows. */
  original_amount: number | null;
  /** NBS middle rate frozen at entry (1 unit of `currency` = N RSD); null for
   *  RSD rows. History is never re-converted, so rate drift can't change it. */
  exchange_rate: number | null;
  /** YYYY-MM-DD - the day the money is counted against (occurrence date for auto rows). */
  spent_on: string;
  category_id: string | null;
  person_id: string | null;
  note: string | null;
  source: ExpenseSource;
  payment_id: string | null;
  payment_due_date: string | null;
  activity_id: string | null;
  event_id: string | null;
  /** Store name parsed from a scanned receipt (source='receipt'); else null. */
  merchant: string | null;
  /** suf.purs.gov.rs verification URL for a scanned receipt; else null. */
  receipt_url: string | null;
  /** Last "Osveži stavke" re-fetch claim (server-enforced cooldown); the
   *  client renders the countdown from it. Null until the first refresh. */
  receipt_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One line of a scanned receipt, child of an `expenses` row (source='receipt').
 * `total` is authoritative (discount-safe); `quantity` / `unit_price` are
 * best-effort (nullable) since odd receipt layouts hide the price×qty split.
 * Immutable + not realtime-published - loaded lazily with the parent's detail.
 */
export interface ExpenseItem {
  id: string;
  expense_id: string;
  family_id: string;
  name: string;
  quantity: number | null;
  unit_price: number | null;
  total: number;
  sort_order: number;
  created_at: string;
}

/**
 * A recurring household income (Faza 4). `day_of_month` is the nominal pay-day
 * (1..31; the cycle math caps it to the month's last day). `active=false`
 * pauses it without deleting; `is_recurring=false` marks a one-off (still
 * counted in its month).
 */
export interface Income {
  id: string;
  family_id: string;
  person_id: string | null;
  name: string;
  amount: number;
  day_of_month: number;
  is_recurring: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * One actual income receipt for a given month - the frozen counterpart to a
 * recurring {@link Income} source, mirroring how `payment_history` freezes a
 * paid payment occurrence. Either a confirmation of a recurring source
 * (`income_id` set, one row per source per `month`) or a one-off
 * (`income_id = null`, `is_one_time = true`, e.g. a bonus). The monthly budget
 * cycle sums these - never the live sources - so editing a source today never
 * rewrites a past month's income. `month` is "YYYY-MM"; `received_on` is the
 * day it actually landed (informational).
 */
export interface IncomeEntry {
  id: string;
  family_id: string;
  income_id: string | null;
  person_id: string | null;
  name: string;
  amount: number;
  month: string;
  received_on: string | null;
  note: string | null;
  is_one_time: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Activities (recurring weekly schedule per family member)
// ---------------------------------------------------------------------------

export type SchoolShift = "morning" | "afternoon";

/**
 * `'every'` - runs on each matching week (default; combined with
 *             `recurrence_interval_weeks` for "every N weeks" patterns).
 * `'A'`     - only on weeks when the activity's person is in the MORNING shift.
 * `'B'`     - only on weeks when the activity's person is in the AFTERNOON shift.
 *
 * A/B is implicitly bound to the person's `school_shift_anchors` row. If the
 * person has no anchor, A/B rules are skipped (the UI prevents creating them).
 */
export type WeekPattern = "every" | "A" | "B";

export interface Activity {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  /** Optional season window (e.g., school year). NULL = open-ended on that side. */
  active_from: string | null;
  active_to: string | null;
  /** Pause without deleting (holidays, illness). */
  is_paused: boolean;
  /**
   * Minutes before each occurrence's start time to push a reminder. NULL
   * disables it. Same shape as `events.remind_minutes_before` so the
   * existing cron path (`send-due-pushes`) can fan out per-participant
   * pushes that respect overrides.
   */
  remind_minutes_before: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Who attends a given activity. Junction table so siblings can share the
 * same termin without duplicating the activity definition.
 */
export interface ActivityParticipant {
  activity_id: string;
  person_id: string;
  family_id: string;
  created_at: string;
}

export interface ActivitySchedule {
  id: string;
  activity_id: string;
  /** Denormalized for RLS / fast week queries. */
  family_id: string;
  /** 0 = Monday, 6 = Sunday (UI is Monday-first). */
  day_of_week: number;
  /** "HH:MM" or "HH:MM:SS" - Postgres TIME column. */
  start_time: string;
  end_time: string;
  week_pattern: WeekPattern;
  /**
   * "Every N weeks". 1 = each matching week (default). 2 = every other week,
   * 3 = every 3rd, etc. Anchor for the modulo is the activity's `active_from`
   * (Monday-normalized), falling back to the activity's `created_at`. A/B
   * patterns ignore this on the UI level (forced back to 1) but the
   * resolver applies it defensively if combined.
   */
  recurrence_interval_weeks: number;
  created_at: string;
  updated_at: string;
}

export type ActivityOverrideAction = "cancel" | "reschedule";

/**
 * Per-occurrence override on a schedule rule. Lookup key is
 * `(schedule_id, date)` (UNIQUE in the DB). The resolver applies overrides
 * AFTER deciding whether the underlying rule fires that day - if the rule
 * is silent (shift flipped, season ended, activity paused), the override
 * lies dormant in the database and reactivates when conditions return.
 */
export interface ActivityOverride {
  id: string;
  schedule_id: string;
  family_id: string;
  /**
   * Who this override applies to. Same termin can have separate overrides
   * for different participants - e.g. one sibling sick, the other still
   * goes. UNIQUE constraint is on (schedule_id, date, person_id).
   */
  person_id: string;
  /** YYYY-MM-DD - the day the rule WOULD have fired. The override is keyed by this. */
  date: string;
  action: ActivityOverrideAction;
  /** Required for `'reschedule'`. NULL for `'cancel'`. */
  override_start_time: string | null;
  override_end_time: string | null;
  /**
   * For reschedules that move the termin to a DIFFERENT day. NULL when the
   * reschedule keeps the same day and only changes times. When set, the
   * resolver renders a ghost "moved away" marker on the original `date`
   * and a full block on `override_date`.
   */
  override_date: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchoolShiftAnchor {
  /** Primary key - one row per person. */
  person_id: string;
  family_id: string;
  /** Monday of the anchor week. The UI normalizes to Monday before insert. */
  anchor_week_start: string;
  anchor_shift: SchoolShift;
  /** "Every N weeks the shift flips". Default 1 = true week-by-week alternation. */
  flip_interval_weeks: number;
  /**
   * Whether the shift actually rotates. False for a child with a single,
   * never-changing timetable - the derivation skips the flip math and returns
   * the anchor straight back.
   *
   * NOTE: this is NOT the lever for 1st/2nd graders. Those kids DO rotate
   * (their subjects flip A↔B weekly), they just never change their time of
   * day - that's `fixed_time_band` below. Keep `is_alternating` true for them.
   */
  is_alternating: boolean;
  /**
   * Pins the bell-schedule TIME band regardless of which shift the rota
   * resolves to that week. NULL = use the rota label as the band (normal
   * kids). `'morning'` = 1st/2nd graders: subjects still rotate A↔B, but the
   * school day always starts in the morning.
   */
  fixed_time_band: SchoolShift | null;
  /**
   * On this child's afternoon weeks, use the pred-čas band (13:00 start, big
   * break after the 3rd class) instead of the regular afternoon band (14:00,
   * after the 2nd). Defaults true. Irrelevant when `fixed_time_band` is
   * `'morning'`.
   */
  afternoon_uses_predcas: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// School timetable (subjects-per-day; times derived from the bell schedule)
// ---------------------------------------------------------------------------

/**
 * Which A/B rota a timetable row belongs to. `'A'` = the weeks the child's
 * shift resolves to morning, `'B'` = afternoon weeks. A non-alternating child
 * uses only the one variant their anchor shift maps to.
 */
export type TimetableVariant = "A" | "B";

/**
 * One editable bell schedule per family. Class/break lengths are uniform;
 * each band carries its own start time and the position of the big break
 * (veliki odmor). Concrete class times are computed from this - never stored
 * on the timetable rows themselves.
 */
export interface BellSchedule {
  family_id: string;
  period_minutes: number;
  small_break_minutes: number;
  big_break_minutes: number;
  /** Cap on how many class slots a band's derived grid can have. */
  max_periods: number;
  /** "HH:MM[:SS]" - Postgres TIME. */
  morning_start: string;
  /** Big break falls after this class index (0 = no big break). */
  morning_big_break_after: number;
  afternoon_start: string;
  afternoon_big_break_after: number;
  /** Pred-čas afternoon: earlier start, big break one class later. */
  afternoon_predcas_start: string;
  afternoon_predcas_big_break_after: number;
  created_at: string;
  updated_at: string;
}

/**
 * A single subject in one class slot of one weekday, for one child and one
 * rota variant. No wall-clock time here - the resolver maps `period_index`
 * onto the bell grid computed for the child's resolved band.
 */
export interface SchoolTimetableEntry {
  id: string;
  family_id: string;
  person_id: string;
  variant: TimetableVariant;
  /** 0 = Monday … 6 = Sunday. */
  day_of_week: number;
  /** 1-based class slot within the band (slot 1 = first class of the day). */
  period_index: number;
  subject: string;
  /** Optional classroom / cabinet. */
  room: string | null;
  created_at: string;
  updated_at: string;
}

export type ListScope = "personal" | "family";

export interface List {
  id: string;
  family_id: string;
  /** Creator of the list - also used as the access guard for personal scope. */
  owner_id: string;
  /** Who last modified the list (metadata or items inside it). */
  updated_by_id: string | null;
  name: string;
  /** Optional free-text description. Markdown is rendered in the list's popup / detail page. */
  description: string | null;
  scope: ListScope;
  sort_order: number;
  /**
   * When true, the per-list UI keeps the items grouped by aisle (smart
   * sort) and triggers a re-sort after any item insert or rename. Toggled
   * via the Sparkles button in the full-page header.
   */
  smart_sort_enabled: boolean;
  /**
   * Per-list retention window for completed items, in hours. NULL means
   * "never auto-delete" (the default). A pg_cron job purges items whose
   * `completed_at` is older than this value.
   */
  auto_delete_completed_after_hours: number | null;
  created_at: string;
  updated_at: string;
}

export interface ListItem {
  id: string;
  list_id: string;
  family_id: string;
  name: string;
  /** Optional free-text description. Markdown is rendered inside the item popup. */
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
  sort_order: number;
  created_by_id: string | null;
  updated_by_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A list returned together with its items via the nested `select` query. */
export interface ListWithItems extends List {
  list_items: ListItem[];
}

// ---------------------------------------------------------------------------
// Notification system (Phase 2)
// ---------------------------------------------------------------------------

export interface NotificationPreferences {
  user_id: string;
  morning_enabled: boolean;
  /** "HH:MM" or "HH:MM:SS" - Postgres TIME column */
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  /** IANA timezone, e.g. "Europe/Belgrade" */
  timezone: string;
  /**
   * Instant per-entity-create push opt-ins. Default true on the column
   * so existing notification-enabled users start receiving these out of
   * the box; the settings UI lets them turn each kind off.
   */
  notify_on_list_create: boolean;
  notify_on_event_create: boolean;
  notify_on_payment_create: boolean;
  notify_on_birthday_create: boolean;
  created_at: string;
  updated_at: string;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  last_used_at: string;
}

export type NotificationKind =
  | "morning_digest"
  | "evening_digest"
  | "event_reminder"
  | "payment_reminder"
  | "activity_reminder"
  | "external_reminder";

export interface NotificationLogRow {
  id: string;
  user_id: string;
  kind: NotificationKind;
  /** Date (YYYY-MM-DD) for digests, item UUID for reminders */
  ref_id: string;
  sent_at: string;
}

/**
 * Token-free view of a member's Google Calendar connection
 * (`google_connections_safe`). The OAuth tokens live only on the base
 * `google_connections` table, reachable solely by the sync Edge Functions; the
 * client only ever sees this status row.
 */
export interface GoogleConnectionSafe {
  id: string;
  user_id: string;
  family_id: string;
  google_account_email: string;
  scopes: string | null;
  /**
   * True after a token refresh failed (e.g. the 7-day refresh-token expiry that
   * applies while the OAuth app is in Google "Testing" mode) - the UI shows a
   * "Poveži ponovo" prompt until the member re-consents.
   */
  needs_reauth: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A read-only event mirrored from Google (`external_calendar_events`). Surfaced
 * in the agenda alongside native events; never edited. `local_date` /
 * `start_time` / `end_time` are the wall-clock projection used for bucketing
 * (matching native `events`); `html_link` deep-links back to Google.
 */
export interface ExternalCalendarEvent {
  id: string;
  calendar_id: string;
  family_id: string;
  owner_user_id: string;
  visibility: "family" | "private";
  google_event_id: string;
  ical_uid: string | null;
  recurring_event_id: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  start_at: string | null;
  end_at: string | null;
  local_date: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: boolean;
  /** default | fromGmail | birthday | outOfOffice | focusTime | workingLocation */
  event_type: string | null;
  status: string | null;
  html_link: string | null;
  /** fromGmail events: deep link to the originating Gmail/source item. */
  source_url: string | null;
  /** Source calendar's hex color, for tinting the event in the agenda. */
  color: string | null;
  /**
   * Local enrichment, merged client-side from `external_event_local` by
   * `ical_uid` (not columns on this row). `assigned_person_id` puts the event in
   * a family member's person filter + shows their badge; `remind_minutes_before`
   * drives a family push reminder.
   */
  assigned_person_id?: string | null;
  remind_minutes_before?: number | null;
}

/**
 * App-local metadata for a mirrored Google event (`external_event_local`), keyed
 * by the stable `ical_uid` so it survives re-syncs. Never written back to Google.
 */
export interface ExternalEventLocal {
  ical_uid: string;
  assigned_person_id: string | null;
  remind_minutes_before: number | null;
}

/** Per-calendar privacy gate for what gets mirrored into the family agenda. */
export type GoogleCalendarSharing = "none" | "private" | "family";

/**
 * A calendar under a connected Google account (`google_calendars`), as shown in
 * the Settings picker. `sharing` controls whether - and to whom - this
 * calendar's events are mirrored: 'none' = don't import, 'private' = only the
 * connecting member, 'family' = the whole family. The OAuth tokens stay on
 * `google_connections`; this row carries no secrets.
 */
export interface GoogleCalendar {
  id: string;
  connection_id: string;
  google_calendar_id: string;
  summary: string | null;
  /** Hex background color from Google (e.g. "#0088aa"), or null. */
  color: string | null;
  /** owner | writer | reader | freeBusyReader. */
  access_role: string | null;
  is_primary: boolean;
  sharing: GoogleCalendarSharing;
  /**
   * Events found in the sync window, surfaced by the picker `list` action so a
   * member can judge whether importing a calendar is worth it. Null if the count
   * couldn't be fetched; `event_count_capped` = more than the 2500 probe cap.
   */
  event_count?: number | null;
  event_count_capped?: boolean;
}

/**
 * Per-member "what to import from Google" preferences. `default` events are
 * always mirrored; these gate the special event types (skip-list semantics).
 * One row per connecting member; applies across all their calendars.
 */
export interface GoogleSyncPreferences {
  /** Gmail-auto travel events (flights / hotels / reservations). */
  import_from_gmail: boolean;
  /** Contact birthdays + anniversaries. */
  import_birthdays: boolean;
  /** Out-of-office / focus-time / working-location markers. */
  import_work_markers: boolean;
}
