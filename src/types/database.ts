export interface Family {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  family_id: string;
  /**
   * Computed by a Postgres trigger from `first_name` + `last_name` —
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
   * Family admin — may create/disable logins, manage the roster (add/remove
   * members, set colors, mark students), and rename the family. Backfilled
   * `true` for everyone who had a login when the role was introduced; new
   * login-less members default `false`. Enforced in RLS via `is_family_admin()`.
   */
  is_admin: boolean;
  /**
   * True iff this profile's `id` matches a row in `auth.users` — i.e. the
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
  created_at: string;
  updated_at: string;
}

export type RecurrencePeriod = "monthly" | "weekly" | "limited" | "one-time";

export interface Payment {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  amount: number;
  due_date: string;
  is_recurring: boolean;
  recurrence_period: RecurrencePeriod | null;
  /**
   * "Every N periods" knob — meaningful for `monthly` (every N months) and
   * `weekly` (every N weeks). `one-time` and `limited` ignore this and always
   * behave as if interval = 1. Column is NOT NULL with a default of 1 in the
   * DB so old rows back-fill correctly.
   */
  recurrence_interval: number;
  remaining_occurrences: number | null;
  is_paid: boolean;
  is_paused: boolean;
  paid_date: string | null;
  remind_days_before: number | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentHistory {
  id: string;
  payment_id: string;
  family_id: string;
  amount: number;
  due_date: string;
  paid_date: string;
  created_at: string;
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
// Activities (recurring weekly schedule per family member)
// ---------------------------------------------------------------------------

export type SchoolShift = "morning" | "afternoon";

/**
 * `'every'` — runs on each matching week (default; combined with
 *             `recurrence_interval_weeks` for "every N weeks" patterns).
 * `'A'`     — only on weeks when the activity's person is in the MORNING shift.
 * `'B'`     — only on weeks when the activity's person is in the AFTERNOON shift.
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
  /** "HH:MM" or "HH:MM:SS" — Postgres TIME column. */
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
 * AFTER deciding whether the underlying rule fires that day — if the rule
 * is silent (shift flipped, season ended, activity paused), the override
 * lies dormant in the database and reactivates when conditions return.
 */
export interface ActivityOverride {
  id: string;
  schedule_id: string;
  family_id: string;
  /**
   * Who this override applies to. Same termin can have separate overrides
   * for different participants — e.g. one sibling sick, the other still
   * goes. UNIQUE constraint is on (schedule_id, date, person_id).
   */
  person_id: string;
  /** YYYY-MM-DD — the day the rule WOULD have fired. The override is keyed by this. */
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
  /** Primary key — one row per person. */
  person_id: string;
  family_id: string;
  /** Monday of the anchor week. The UI normalizes to Monday before insert. */
  anchor_week_start: string;
  anchor_shift: SchoolShift;
  /** "Every N weeks the shift flips". Default 1 = true week-by-week alternation. */
  flip_interval_weeks: number;
  /**
   * Whether the shift actually rotates. False for a child with a single,
   * never-changing timetable — the derivation skips the flip math and returns
   * the anchor straight back.
   *
   * NOTE: this is NOT the lever for 1st/2nd graders. Those kids DO rotate
   * (their subjects flip A↔B weekly), they just never change their time of
   * day — that's `fixed_time_band` below. Keep `is_alternating` true for them.
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
 * (veliki odmor). Concrete class times are computed from this — never stored
 * on the timetable rows themselves.
 */
export interface BellSchedule {
  family_id: string;
  period_minutes: number;
  small_break_minutes: number;
  big_break_minutes: number;
  /** Cap on how many class slots a band's derived grid can have. */
  max_periods: number;
  /** "HH:MM[:SS]" — Postgres TIME. */
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
 * rota variant. No wall-clock time here — the resolver maps `period_index`
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
  /** Creator of the list — also used as the access guard for personal scope. */
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
  /** "HH:MM" or "HH:MM:SS" — Postgres TIME column */
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
  | "activity_reminder";

export interface NotificationLogRow {
  id: string;
  user_id: string;
  kind: NotificationKind;
  /** Date (YYYY-MM-DD) for digests, item UUID for reminders */
  ref_id: string;
  sent_at: string;
}
