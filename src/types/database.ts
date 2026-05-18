export interface Family {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  family_id: string;
  full_name: string | null;
  avatar_url: string | null;
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

export type RecurrencePeriod = "monthly" | "limited" | "one-time";

export interface Payment {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  amount: number;
  due_date: string;
  is_recurring: boolean;
  recurrence_period: RecurrencePeriod | null;
  remaining_occurrences: number | null;
  is_paid: boolean;
  is_paused: boolean;
  paid_date: string | null;
  remind_minutes_before: number | null;
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

export interface Expense {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  amount: number;
  is_paid: boolean;
  paid_date: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
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
  | "payment_reminder";

export interface NotificationLogRow {
  id: string;
  user_id: string;
  kind: NotificationKind;
  /** Date (YYYY-MM-DD) for digests, item UUID for reminders */
  ref_id: string;
  sent_at: string;
}
