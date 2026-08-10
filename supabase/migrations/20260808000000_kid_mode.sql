-- Kid mode - a separate, read-only shell for children who sign in with a
-- device and a PIN instead of an email and a password.
--
-- The security model in one paragraph: a child's auth user is SYNTHETIC. It has
-- a generated address nobody ever sees, no password and - most importantly here
-- - no row in `profiles`. Every RLS policy written so far resolves the caller
-- through `profiles WHERE id = auth.uid()`, so by default a child's session
-- matches NOTHING. Access is then handed back table by table, with narrow
-- SELECT-ONLY policies keyed on `public.kid_profile_id()`. A table we forget is
-- invisible to the child rather than leaked - the mistake falls on the safe
-- side.
--
-- `kid_access.profile_id` stays the child's ORIGINAL profile id. That is
-- deliberately the opposite of `manage-family-login`, which re-points
-- `profiles.id` at a new auth user. The link between the profile and the
-- synthetic user lives only in `kid_access.auth_user_id`, so the child can go
-- on being a participant in events and activities under their old id, with no
-- data migration at all.
--
-- Turning access off is an FK, not a column. `kid_access.auth_user_id`
-- references `auth.users(id)` ON DELETE CASCADE, so deleting the synthetic auth
-- user (which the `kid-access` edge function does, action `disable`) removes
-- the `kid_access` row on its own. That is the INTENDED off switch, not an
-- accident: one move takes away both the session and every row the policies
-- below hang off. `is_enabled` is only a soft pause (turn it off for a while
-- without unlinking the devices).
--
-- Signing in takes TWO factors: a device token (which a parent plants with a
-- single-use QR link) AND a PIN. There is no username field, so the sign-in
-- screen cannot even be used to enumerate the children in a family.
--
-- No pgcrypto - we do not install it. The PIN is hashed in Deno (PBKDF2-SHA256,
-- 100000 iterations, 16 bytes of salt) and arrives here as a finished string
-- `pbkdf2$<iters>$<saltB64>$<hashB64>`. The database never computes or verifies
-- it.

-- ---------------------------------------------------------------------------
-- kid_access - one row per child; the row existing IS the feature switch
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kid_access (
  -- Without ON UPDATE CASCADE this row would be orphaned if a parent later
  -- gives the child a real login (that re-points `profiles.id` at a new auth
  -- id). The invariant from 20260602000000_family_admin.sql: every FK onto
  -- profiles(id) reachable by a member without a login MUST cascade on UPDATE
  -- too.
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,

  -- The synthetic auth user. NULL only for the moment between two steps in the
  -- edge function; deleting the user deletes this row (see the header).
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- A generated address of the form first.last.<8 hex>@porodica.local. It is
  -- shown nowhere in the app; it exists only because GoTrue demands an email.
  login_email TEXT NOT NULL UNIQUE,

  -- "pbkdf2$<iters>$<saltB64>$<hashB64>", computed in Deno.
  pin_hash TEXT NOT NULL,

  is_enabled BOOLEAN NOT NULL DEFAULT true,

  -- The theme is the only thing a child may change, and only through
  -- kid_set_theme(). The keys are English (KID_THEME_KEYS in src/types/kid.ts);
  -- only the labels in the app are Serbian.
  theme TEXT NOT NULL DEFAULT 'ocean'
    CHECK (theme IN ('ocean', 'jungle', 'sun', 'candy', 'space')),

  -- Lockout after too many missed PINs. The `kid-auth` edge function counts and
  -- resets it; the database only stores the state.
  failed_attempts SMALLINT NOT NULL DEFAULT 0,
  locked_until TIMESTAMP WITH TIME ZONE,
  last_login_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kid_access_family ON kid_access(family_id);

COMMENT ON TABLE kid_access IS
  'Kid access: the link between a child profile and a synthetic, profile-less auth user. The row existing is the feature switch; deleting the auth user cascades the row away.';

-- ---------------------------------------------------------------------------
-- kid_devices - the devices a parent has linked for a child
-- ---------------------------------------------------------------------------
-- Only the sha256 of the token is stored. The raw token lives in that device's
-- localStorage and is sent on every sign-in; revoking access is a plain row
-- delete.
CREATE TABLE IF NOT EXISTS kid_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  -- A hint from the User-Agent header at link time ("iPhone", "Mac").
  label TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_kid_devices_profile ON kid_devices(profile_id);
CREATE INDEX IF NOT EXISTS idx_kid_devices_family ON kid_devices(family_id);

COMMENT ON TABLE kid_devices IS
  'A child''s linked devices. Only the sha256 of the token is stored; revoking access = deleting the row.';

-- ---------------------------------------------------------------------------
-- kid_invites - the single-use QR link a parent links a device with
-- ---------------------------------------------------------------------------
-- Short-lived (15 minutes) and single-use (`used_at`). As with devices, only
-- the hash is stored; the raw token is returned exactly once, in the edge
-- function's response.
CREATE TABLE IF NOT EXISTS kid_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  -- The parent who created the invite. Deliberately no FK: the row may outlive
  -- the parent's account, and it is only valid for 15 minutes anyway.
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kid_invites_profile ON kid_invites(profile_id);
CREATE INDEX IF NOT EXISTS idx_kid_invites_expires ON kid_invites(expires_at);

COMMENT ON TABLE kid_invites IS
  'Single-use device-link invites (15 minutes). Service role only: it carries no RLS policy at all.';

-- ---------------------------------------------------------------------------
-- birthday_visibility - which child sees which birthday, and with what note
-- ---------------------------------------------------------------------------
-- Birthdays have no participants, so without a row here no birthday is visible
-- to any child. Deliberately opt-in: the birthdays of a parent's friends and
-- colleagues have no business in a child's app.
--
-- `note` is per child, not per birthday: one child is asked to call grandma,
-- another to draw a card, for the same birthday.
CREATE TABLE IF NOT EXISTS birthday_visibility (
  birthday_id UUID NOT NULL REFERENCES birthdays(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Denormalized for RLS and for fetching the whole family in one query (the
  -- same pattern as school_break_members).
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (birthday_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_birthday_visibility_person ON birthday_visibility(person_id);
CREATE INDEX IF NOT EXISTS idx_birthday_visibility_family ON birthday_visibility(family_id);

COMMENT ON TABLE birthday_visibility IS
  'Opt-in birthday visibility for children, with a per-child note. Without a row here no child sees the birthday.';

-- ---------------------------------------------------------------------------
-- RLS enabled on all four new tables
-- ---------------------------------------------------------------------------
ALTER TABLE kid_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE kid_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE kid_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE birthday_visibility ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helper functions - "which child is asking?"
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason as `is_family_admin` and
-- `auth_user_family_id`: reading `kid_access` bypasses RLS, so a policy on
-- `kid_access` cannot recurse into itself. An empty search_path plus full
-- qualification guard against search_path injection.
--
-- Both return NULL when the caller is not a child (or access is paused through
-- `is_enabled`), so `column = public.kid_profile_id()` evaluates to NULL, which
-- RLS treats as "no" - with no extra condition needed.

CREATE OR REPLACE FUNCTION public.kid_profile_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT profile_id FROM public.kid_access
  WHERE auth_user_id = auth.uid()
    AND is_enabled;
$$;

CREATE OR REPLACE FUNCTION public.kid_family_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT family_id FROM public.kid_access
  WHERE auth_user_id = auth.uid()
    AND is_enabled;
$$;

COMMENT ON FUNCTION public.kid_profile_id() IS
  'The child profile id for the current session, or NULL when the caller is not an active child.';
COMMENT ON FUNCTION public.kid_family_id() IS
  'The child family id for the current session, or NULL when the caller is not an active child.';

REVOKE ALL ON FUNCTION public.kid_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kid_family_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kid_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.kid_family_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- kid_set_theme - the only write a child may perform
-- ---------------------------------------------------------------------------
-- Deliberately an RPC, not an UPDATE policy. A policy would cover the WHOLE
-- row, so the child could overwrite `pin_hash`, `is_enabled` or `family_id`.
-- PostgreSQL has no column restriction in USING/WITH CHECK - the `profiles`
-- policy "Users can update own profile" is exactly that too-wide shape, and we
-- do not want to repeat it here. This function touches exactly one column of
-- exactly one row.
CREATE OR REPLACE FUNCTION public.kid_set_theme(p_theme TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_theme IS NULL OR p_theme NOT IN ('ocean', 'jungle', 'sun', 'candy', 'space') THEN
    RAISE EXCEPTION 'Unknown theme: %', p_theme USING ERRCODE = '22023';
  END IF;

  UPDATE public.kid_access
    SET theme = p_theme
    WHERE auth_user_id = auth.uid()
      AND is_enabled;
END;
$$;

COMMENT ON FUNCTION public.kid_set_theme(TEXT) IS
  'Changes the calling child''s theme. The only write a kid session may perform.';

REVOKE ALL ON FUNCTION public.kid_set_theme(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kid_set_theme(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Kid policies - SELECT only, and why they do not recurse
-- ---------------------------------------------------------------------------
-- Postgres evaluates a policy expression with the asking user's rights, so RLS
-- APPLIES to every table that expression mentions. A policy on table A that
-- looks at table B drags in all of B's policies; if some policy of B looked
-- back at A, Postgres fails with
-- "infinite recursion detected in policy for relation".
--
-- That is why `kid_profile_id()` and `kid_family_id()` are SECURITY DEFINER:
-- reading `kid_access` inside them runs as the function owner and does NOT
-- trigger the policy on `kid_access`. Every policy below that merely compares a
-- column against those functions is therefore a LEAF - it mentions no table.
--
-- The dependency graph (an arrow = "this table's policy reads that table"):
--
--   events            -> event_participants     (leaf)
--   activities        -> activity_participants  (leaf)
--   activity_schedule -> activity_participants  (leaf)
--   birthdays         -> birthday_visibility    (leaf)
--   everything else   -> (leaf)
--
-- The depth is at most one hop and none of those four leaves looks back, so
-- there is no cycle. There is a second branch too: because permissive policies
-- combine with OR, the kid policy on e.g. `event_participants` runs alongside
-- the existing parent one, which reads `profiles`. That terminates as well:
-- both SELECT policies on `profiles` are leaves (`auth.uid() = id` and the
-- definer function `auth_user_family_id()`), and `profiles` looks at nothing
-- else. The same pattern has worked for `events` -> `profiles` for a year.
--
-- The rule for tomorrow: a new kid policy may only read a table that is a leaf.
-- If somebody added a policy on `event_participants` that reads `events`, the
-- cycle would appear that instant.

-- Who is in the family. Without this the child would not even see their name.
CREATE POLICY "Kid can view own family profiles" ON profiles FOR SELECT
  USING (family_id = public.kid_family_id());

-- IMPORTANT for whoever reads this later: `profiles` has a policy
-- "Users can update own profile" FOR UPDATE USING (auth.uid() = id), which does
-- NOT restrict columns. For a child it is a dead letter, because a child's auth
-- uid never equals any `profiles.id` (a child has no row in `profiles` - that
-- is the whole point of the model). Which is why there is NO UPDATE, INSERT or
-- DELETE policy for a child here, anywhere. If somebody "helpfully" adds a kid
-- UPDATE policy on `profiles`, they have opened the whole row to the child,
-- `is_admin` and `family_id` included. The only permitted write is the theme,
-- and it goes through public.kid_set_theme().

CREATE POLICY "Kid can view own family" ON families FOR SELECT
  USING (id = public.kid_family_id());

-- Events: only the ones the child is recorded as a participant in.
CREATE POLICY "Kid can view own event_participants" ON event_participants FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own events" ON events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM event_participants ep
      WHERE ep.event_id = events.id
        AND ep.person_id = public.kid_profile_id()
    )
  );

-- Activities: the same pattern, plus the schedule and its overrides.
CREATE POLICY "Kid can view own activity_participants" ON activity_participants FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own activities" ON activities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM activity_participants ap
      WHERE ap.activity_id = activities.id
        AND ap.person_id = public.kid_profile_id()
    )
  );

CREATE POLICY "Kid can view own activity_schedule" ON activity_schedule FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM activity_participants ap
      WHERE ap.activity_id = activity_schedule.activity_id
        AND ap.person_id = public.kid_profile_id()
    )
  );

-- Overrides already carry person_id, so they need no hop through participants.
CREATE POLICY "Kid can view own activity_overrides" ON activity_overrides FOR SELECT
  USING (person_id = public.kid_profile_id());

-- School: the timetable and the shift are personal, the bells and breaks are family-wide.
CREATE POLICY "Kid can view own timetable" ON school_timetable_entries FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own shift_anchors" ON school_shift_anchors FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own family bell_schedule" ON bell_schedules FOR SELECT
  USING (family_id = public.kid_family_id());

CREATE POLICY "Kid can view own family school_breaks" ON school_breaks FOR SELECT
  USING (family_id = public.kid_family_id());

CREATE POLICY "Kid can view own family school_break_members" ON school_break_members FOR SELECT
  USING (family_id = public.kid_family_id());

-- Birthdays: only the ones a parent has explicitly opened to this child.
CREATE POLICY "Kid can view own birthday_visibility" ON birthday_visibility FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own birthdays" ON birthdays FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM birthday_visibility bv
      WHERE bv.birthday_id = birthdays.id
        AND bv.person_id = public.kid_profile_id()
    )
  );

-- Their own kid_access row - that is where the app reads the theme from.
-- Note: RLS is per row, not per column, so a child technically also sees the
-- `pin_hash` of their row. That is the hash of their OWN PIN, which they know
-- by heart anyway, so nothing new is gained. Columns are deliberately not taken
-- away with GRANT, because `select=*` from PostgREST would then fail rather
-- than return the row.
CREATE POLICY "Kid can view own kid_access" ON kid_access FOR SELECT
  USING (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- What a child DELIBERATELY does not see
-- ---------------------------------------------------------------------------
-- There is (and must be) no kid policy at all on: payments,
-- payment_participants, payment_overrides, payment_history, expenses,
-- expense_categories, expense_items, receipts, receipt_items,
-- receipt_import_rate, incomes, income_entries, exchange_rates, lists,
-- list_items, notification_log, notification_preferences, push_subscriptions,
-- google_connections, google_calendars, google_sync_preferences,
-- external_calendar_events, external_event_local, kid_devices, kid_invites.
--
-- Money, lists, notifications and other people's calendars are not a child's
-- business. Since RLS denies everything by default, not mentioning them here is
-- enough - which is why this list is a comment rather than code.

-- ---------------------------------------------------------------------------
-- The parent side
-- ---------------------------------------------------------------------------

-- birthday_visibility - the ordinary family block of four policies. UPDATE
-- exists for `note`, which is edited from the birthday form.
CREATE POLICY "Users can view own family birthday_visibility" ON birthday_visibility FOR SELECT
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own family birthday_visibility" ON birthday_visibility FOR INSERT
  WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own family birthday_visibility" ON birthday_visibility FOR UPDATE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own family birthday_visibility" ON birthday_visibility FOR DELETE
  USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- kid_access and kid_devices - READ only, and only for family admins. Every
-- write goes through the `kid-access` edge function with the service role,
-- because turning access on also creates an auth user, which a client cannot
-- do. There is no INSERT/UPDATE/DELETE policy - that is not an oversight.
CREATE POLICY "Admins can view own family kid_access" ON kid_access FOR SELECT
  USING (public.is_family_admin(family_id));

CREATE POLICY "Admins can view own family kid_devices" ON kid_devices FOR SELECT
  USING (public.is_family_admin(family_id));

-- kid_invites has NO policy at all, deliberately. The row holds the hash of
-- the device-link token; there is nothing to show a client but the expiry, and
-- the edge function returns that in its response. RLS is on, so the table is
-- empty for everyone but the service role.

-- ---------------------------------------------------------------------------
-- Realtime - a kid session on the family broadcast channel
-- ---------------------------------------------------------------------------
-- The sibling of the policy from 20260729010000_family_broadcast_channel.sql.
-- That one resolves the caller through `profiles`, which does not work for a
-- child (no row), so without this policy the child's subscription would be
-- rejected and their screen would not refresh until a refetch.
-- `kid_family_id()` returns NULL for everyone who is not a child, and
-- `topic() = 'family:' || NULL` is NULL, i.e. "no".
DROP POLICY IF EXISTS "Kids read their family topic" ON realtime.messages;

CREATE POLICY "Kids read their family topic"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (realtime.topic() = 'family:' || public.kid_family_id()::TEXT);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS update_kid_access_updated_at ON kid_access;
CREATE TRIGGER update_kid_access_updated_at BEFORE UPDATE ON kid_access
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Broadcast for birthday_visibility ONLY. The mapping onto query keys lives in
-- src/hooks/useFamilyChannel.ts (TABLE_INVALIDATIONS) - the two go together.
--
-- kid_access, kid_devices and kid_invites DELIBERATELY have no broadcast: they
-- change on every child sign-in (last_login_at, last_seen_at, failed_attempts),
-- so they would send every family pure noise. The parent screens that show them
-- refresh after their own mutation.
DROP TRIGGER IF EXISTS broadcast_family_change ON birthday_visibility;
CREATE TRIGGER broadcast_family_change
  AFTER INSERT OR UPDATE OR DELETE ON birthday_visibility
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_family_change();
