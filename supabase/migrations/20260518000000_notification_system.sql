-- Notification system: per-user prefs, push subscriptions, per-item
-- reminders, and an idempotency log for the cron job that fires pushes.
--
-- Phase 2 of the PWA notification work. Phase 1 (PWA shell + service
-- worker push handlers) is already deployed; this migration is the
-- foundation for the Edge Functions that will run next.

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------
-- One row per user, lazily upserted from the settings page. Stores the
-- opt-in flags + local times for the morning/evening digests, plus the
-- user's timezone so the cron job can compare "is it 08:00 for them yet?"
-- against UTC `NOW()`.

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  morning_enabled BOOLEAN NOT NULL DEFAULT false,
  morning_time TIME NOT NULL DEFAULT '08:00',
  evening_enabled BOOLEAN NOT NULL DEFAULT false,
  evening_time TIME NOT NULL DEFAULT '20:00',
  timezone TEXT NOT NULL DEFAULT 'Europe/Belgrade',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
-- One row per (user, installed device). `endpoint` is unique across all
-- push services (Apple, FCM, Mozilla autopush etc.) and works as the
-- natural key — used by the client to upsert when re-installing the PWA.
-- The send job is responsible for deleting rows that return 410 Gone.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- ---------------------------------------------------------------------------
-- Per-item reminder offsets
-- ---------------------------------------------------------------------------
-- Number of minutes before the item's scheduled time that we should fire a
-- reminder push. NULL = no reminder for that specific item. Birthdays and
-- planned expenses don't get this column — birthdays have no time-of-day
-- and expenses have no due date, so per-item reminders don't make sense
-- there. Both are still surfaced inside the daily digest.

ALTER TABLE events ADD COLUMN IF NOT EXISTS remind_minutes_before INT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS remind_minutes_before INT;

-- ---------------------------------------------------------------------------
-- notification_log (idempotency)
-- ---------------------------------------------------------------------------
-- The cron-fired Edge Function inserts a row here for every push it
-- successfully hands to the push service. The UNIQUE constraint prevents
-- duplicate sends even if cron fires twice in the same minute or the
-- function crashes and is retried.
--
--   kind          → 'morning_digest' | 'evening_digest' | 'event_reminder' | 'payment_reminder'
--   ref_id        → for digests: 'YYYY-MM-DD' (the local date in user's tz)
--                   for reminders: the item's UUID

CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_log_sent_at ON notification_log(sent_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Everything is user-scoped. `notification_log` is read-only for users —
-- only the Edge Function (service role) inserts. The other two are full
-- read/write for the row's owner.

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notification prefs" ON notification_preferences
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own notification prefs" ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own notification prefs" ON notification_preferences
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own notification prefs" ON notification_preferences
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users read own push subscriptions" ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own push subscriptions" ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own push subscriptions" ON push_subscriptions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own push subscriptions" ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users read own notification log" ON notification_log
  FOR SELECT USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
