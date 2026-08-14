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
   * When the user dismissed the "Prvi koraci" onboarding card on Danas
   * ("Sakrij"). NULL = never dismissed. Per-user so it syncs across devices.
   */
  onboarding_hidden_at: string | null;
  /**
   * Personalized bottom-nav: section keys for the free slots after the fixed
   * "Danas" (see `navSections.ts`). NULL = never customized (default layout);
   * `[]` = deliberately minimal bar. Read through `normalizeNavSlots` - raw
   * values are not trusted. Per-user so the bar follows them across devices.
   */
  nav_slots: string[] | null;
  /**
   * In-app accent color (the app colour setting): "blue" (default) | "purple" |
   * "green" | "brown" - English because it is stored, Serbian only in the
   * labels. NULL = never picked. Read through `normalizeAccent`.
   * The brand outside the app (PWA icon, login mark, splash) stays blue.
   */
  accent: string | null;
  /**
   * The emoji that stands for THIS PERSON - picked by a parent in Porodica,
   * next to the colour. NULL = never picked, and then `resolveMemberAvatar`
   * falls back to a stable animal derived from the id, so nothing renders
   * blank. Never derived from the name: see `utils/memberAvatar.ts`.
   */
  avatar_emoji: string | null;
  /**
   * How THIS USER sees other members in the main app: "initials" (default) |
   * "emoji" - English because it is stored, Serbian only in the labels. NULL =
   * never picked. Read through `normalizeMemberAvatarStyle`. Per user like
   * `accent`, so one parent can run initials while the other runs emoji. The
   * kid app ignores it and always draws emoji.
   */
  member_avatar_style: string | null;
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
  /**
   * Inclusive LAST day of a multi-day event (konferencija, odmor, ekskurzija);
   * NULL = single-day. When set it is strictly after `date` (DB CHECK). Times
   * apply to the span edges - `start_time` starts the first day, `end_time`
   * ends the last day; both NULL = whole days. The agenda expands the span
   * into per-day slices client-side (`eventDaySlices`), mirroring how the
   * gcal sync expands multi-day Google events into one row per day.
   */
  end_date: string | null;
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
  /**
   * Day of the month (1-31) the series is anchored to - the day the user
   * originally picked. Every monthly step re-derives its day from this anchor
   * (capped to the target month's length) instead of from the previous, already
   * capped result, so a bill due on the 31st does not permanently become the
   * 28th after its first February. `null` (or absent) falls back to the day of
   * `due_date`, which is what pre-anchor rows and hand-built fixtures get.
   */
  due_anchor_day?: number | null;
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
   * When true, `amount` is only a rough default used for
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
   * a gift). Part of the same `payments_single_link` CHECK - a payment
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
  /** suf.purs.gov.rs verification URL for a scanned receipt; else null.
   *  Kept alongside receipt_id (the open-receipt link + duplicate-jump
   *  lookup read it directly). */
  receipt_url: string | null;
  /** The {@link Receipt} this expense was carved out of; null for non-receipt
   *  rows (and for stragglers saved by pre-receipts clients, healed on their
   *  first refresh of the items). */
  receipt_id: string | null;
  /** Legacy mirror of receipts.checked_at (still written by the refresh claim
   *  so deployed clients keep their countdown). Null until the first refresh. */
  receipt_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One scanned fiscal receipt (SUF/PURS). `receipt_url` is the globally-unique
 * dedup key (the old expenses.receipt_url unique index moved here);
 * `total_amount` / `issued_on` are the receipt's own facts, which an expense's
 * amount/spent_on will diverge from once receipt-splitting lands. `checked_at`
 * is the refresh-items cooldown claim (was expenses.receipt_checked_at).
 * pib / company_name / store_name are parse extras (null on backfilled rows).
 */
export interface Receipt {
  id: string;
  family_id: string;
  receipt_url: string;
  merchant: string | null;
  pib: string | null;
  company_name: string | null;
  store_name: string | null;
  total_amount: number;
  /** YYYY-MM-DD (Belgrade-local date of issue). */
  issued_on: string;
  checked_at: string | null;
  created_at: string;
}

/**
 * One line of a scanned receipt, child of a {@link Receipt}. `idx` is the
 * line's position in the parsed journal - UNIQUE per receipt, so a line can
 * never be stored (or claimed) twice. `expense_id` is the claim: which expense
 * owns this line (NULL = unclaimed; deleting an expense releases its lines).
 * `total` is authoritative (discount-safe); `quantity` / `unit_price` are
 * best-effort (nullable). Not realtime-published - loaded lazily on detail.
 */
export interface ReceiptItem {
  id: string;
  receipt_id: string;
  family_id: string;
  idx: number;
  name: string;
  quantity: number | null;
  unit_price: number | null;
  total: number;
  expense_id: string | null;
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
   * On this child's afternoon weeks, use the early band (13:00 start, big
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
  /** Early afternoon band: earlier start, big break one class later. */
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
  /**
   * Optional classroom / cabinet. Mirrors the column, but NOTHING renders it:
   * the schedule screens showed a bare number next to the time ("08:00 - 08:45
   * · 10"), which read as a mystery rather than a room, and no editor ever
   * collected it - existing values came from seeding. Left on the row (and in
   * the database) so the data survives if it is ever wanted again.
   */
  room: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A period without classes ("raspust"). The timetable is a pure weekly
 * pattern, so without this it would keep rendering through July and August.
 *
 * Deliberately stores month + day and NO year: a raspust repeats every year.
 * Full dates would mean re-entering the summer break each August (and getting
 * the timetable back mid-July whenever that was forgotten). A break whose end
 * falls before its start wraps the New Year (30.12 - 20.01).
 */
export interface SchoolBreak {
  id: string;
  family_id: string;
  name: string;
  /** 1-12 / 1-31, both ends inclusive. Compared as month * 100 + day. */
  start_month: number;
  start_day: number;
  end_month: number;
  end_day: number;
  created_at: string;
  updated_at: string;
}

/**
 * Which children a break applies to. NO rows is the default and means "every
 * child with a timetable" - siblings in different grades get their own breaks
 * by listing only them.
 */
export interface SchoolBreakMember {
  break_id: string;
  person_id: string;
  family_id: string;
  created_at: string;
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

// ---------------------------------------------------------------------------
// Tasks - the one completable entity
// ---------------------------------------------------------------------------

/** Only consulted for a LISTLESS task; one inside a list carries its list's. */
export type TaskScope = "personal" | "family";

export type TaskRecurrencePeriod = "one-time" | "daily" | "weekly" | "monthly";

/**
 * Who a tick speaks for. `shared` - one tick finishes the occurrence for
 * everybody (one `task_occurrences` row with `person_id` NULL); `per_assignee` -
 * every assignee ticks their own copy (one row per person).
 */
export type TaskCompletionMode = "shared" | "per_assignee";

export type TaskOccurrenceStatus = "done" | "skipped" | "moved";

/**
 * Every completable thing in the app: a shopping item, a dated reminder and a
 * recurring chore are the same row with more or fewer dimensions filled in.
 * A shopping item is `list_id` only, a reminder is a `due_date`, a chore is a
 * `due_date` plus a recurrence plus an assignee.
 */
export interface Task {
  id: string;
  /** Null for a standalone task - it lands in the Inbox smart list. */
  list_id: string | null;
  family_id: string;
  /** Creator, and the access guard for a listless personal task. */
  owner_id: string | null;
  scope: TaskScope;
  name: string;
  /** Optional free-text description. Markdown is rendered inside the item popup. */
  description: string | null;
  /** Truth for non-recurring tasks only. See utils/task.ts::isTaskDoneOn. */
  is_completed: boolean;
  completed_at: string | null;
  /** References `profiles`, never `auth.users` - a child has no login. */
  completed_by_person_id: string | null;
  /** Null = someday, list only. For a recurring task this is the series anchor. */
  due_date: string | null;
  /** "HH:MM:SS" from Postgres; normalize with normalizeTime before display. */
  due_time: string | null;
  recurrence_period: TaskRecurrencePeriod | null;
  /** "Every N periods". NOT NULL with a default of 1 in the DB. */
  recurrence_interval: number;
  /** 0 = Monday .. 6 = Sunday, matching activity_schedule.day_of_week. */
  recurrence_weekdays: number[] | null;
  /** Inclusive last day of the series; null = open-ended. */
  recurrence_until: string | null;
  completion_mode: TaskCompletionMode;
  /** Push this many minutes before `due_time`, for timed tasks. */
  remind_minutes_before: number | null;
  /** Push this many days before `due_date`, for all-day tasks. */
  remind_days_before: number | null;
  sort_order: number;
  created_by_id: string | null;
  updated_by_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Who a task belongs to. Junction table mirroring `EventParticipant`: NO rows
 * means family-wide and nobody's in particular, not hidden. Drives the person
 * filter, the member badges and what a child can see.
 */
export interface TaskAssignee {
  task_id: string;
  person_id: string;
  family_id: string;
}

/**
 * Sparse per-occurrence row for a recurring task - no row is the normal state,
 * the same convention as `PaymentOverride` / `ActivityOverride`. Unlike those it
 * is not only a display layer: for a recurring task this IS the completion
 * record, because `tasks.is_completed` is structurally forbidden from carrying
 * it (a CHECK constraint enforces the split).
 */
export interface TaskOccurrence {
  id: string;
  task_id: string;
  family_id: string;
  /** The ORIGINAL projected date from the series, even when the row moves it. */
  occurrence_date: string;
  /** Null = the occurrence as a whole (`shared`); set = this person's own copy. */
  person_id: string | null;
  status: TaskOccurrenceStatus;
  /** Where a moved occurrence actually shows. Required for status `moved`. */
  moved_to_date: string | null;
  completed_at: string | null;
  completed_by_person_id: string | null;
  /**
   * Who put this occurrence into its CURRENT state, and when - the one stamp
   * that also covers skipping and moving, which `completed_*` never did.
   * Written by a trigger, never by the client. Superseded states are not kept:
   * a slot that was skipped, restored and skipped again reads as one skip.
   */
  acted_by_person_id: string | null;
  acted_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** A list returned together with its tasks via the nested `select` query. */
export interface ListWithTasks extends List {
  tasks: Task[];
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
  /** Only a task with a due date triggers this push - an undated list item never does. */
  notify_on_task_create: boolean;
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
   * reconnect prompt until the member re-consents.
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

// ---------------------------------------------------------------------------
// Kid mode - see src/types/kid.ts for the model and the edge-function contract
// ---------------------------------------------------------------------------

/**
 * Per-child access row (`kid_access`). Its existence IS the feature flag for a
 * child: no row means no kid login at all. `profile_id` stays the child's
 * original profile id; `auth_user_id` points at the synthetic auth user that
 * has no `profiles` row of its own (which is what makes every legacy RLS
 * policy deny a kid session by default).
 *
 * `pin_hash` and the counters are service-role only - the client never selects
 * them (the SELECT policies expose the row, so treat those columns as opaque).
 */
export interface KidAccess {
  profile_id: string;
  family_id: string;
  auth_user_id: string | null;
  is_enabled: boolean;
  /** One of KID_THEME_KEYS - the only setting a kid may change (via RPC). */
  theme: string;
  /** Set while the account is locked out after too many wrong PINs. */
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A device a parent linked for a child (`kid_devices`). The row stores only the
 * SHA-256 of the device token; the raw token lives in that device's
 * localStorage and is presented on every sign-in. Revoking = deleting the row.
 */
export interface KidDevice {
  id: string;
  profile_id: string;
  family_id: string;
  /** Human-readable device hint derived from the User-Agent at claim time. */
  label: string | null;
  created_at: string;
  last_seen_at: string | null;
}

/**
 * Which child may see a birthday, and what note they see with it
 * (`birthday_visibility`). Birthdays carry no participants of their own, so
 * without a row here a birthday is invisible to every kid - deliberately
 * opt-in, so a parent's friends' birthdays never reach the children.
 *
 * `note` is per child on purpose: one kid gets "pozovi baku", another
 * a different one for the same birthday.
 */
export interface BirthdayVisibility {
  birthday_id: string;
  person_id: string;
  family_id: string;
  note: string | null;
  created_at: string;
}
