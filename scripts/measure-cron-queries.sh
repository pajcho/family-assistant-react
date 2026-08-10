#!/usr/bin/env bash
#
# Measure how many SQL queries one tick of `send-due-pushes` costs.
#
# The function runs every minute through pg_cron, so its cost is constant and
# independent of whether anything actually needs sending. This is the tool that
# measures it before and after a change - the starting picture was 512 PostgREST
# requests per tick for 40 users, and 12 after the move to bulk queries.
#
# Runs against the LOCAL Supabase stack (`supabase start`) and reads the numbers
# from `pg_stat_statements`. The same approach works in production, only
# DB_CONTAINER / FUNCTIONS_URL change (in production psql against the pooler
# replaces docker exec).
#
# Usage:
#
#   scripts/measure-cron-queries.sh seed      # create the synthetic load
#   scripts/measure-cron-queries.sh measure   # reset the stats, then measure
#   scripts/measure-cron-queries.sh cleanup   # delete the synthetic load
#
# The synthetic load is limited to families whose `name` starts with
# "ZZ scaling probe" and to auth users with an `@scaling-probe.local` email, so
# `cleanup` cannot touch real demo data.
#
# Prerequisite for `measure`: edge functions have to run with the custom secrets
# (CRON_SECRET, VAPID_*), which `supabase start` on its own does NOT do:
#
#   supabase functions serve --env-file supabase/functions/.env.local
#
set -euo pipefail

MODE="${1:-measure}"

DB_CONTAINER="${DB_CONTAINER:-supabase_db_family-assistant}"
FUNCTIONS_URL="${FUNCTIONS_URL:-http://127.0.0.1:54321/functions/v1/send-due-pushes}"
ENV_FILE="${ENV_FILE:-supabase/functions/.env.local}"

# Size of the synthetic load. 10 families x 4 members = 40 users by default,
# which is ~1/4 of the planned scenario (100 families / 150 users).
FAMILIES="${FAMILIES:-10}"
MEMBERS="${MEMBERS:-4}"
ITEMS="${ITEMS:-5}"   # events and payments per family
RUNS="${RUNS:-3}"     # how many ticks to measure

PROBE_FAMILY_PREFIX="ZZ scaling probe"
PROBE_EMAIL_DOMAIN="scaling-probe.local"

psql_q() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

require_stack() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    echo "Container '$DB_CONTAINER' is not running. Run 'supabase start'." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# seed
# ---------------------------------------------------------------------------

seed() {
  require_stack
  echo "Creating $FAMILIES families x $MEMBERS members, $ITEMS events and $ITEMS payments per family..."
  psql_q <<SQL
DO \$\$
DECLARE
  f INT;
  m INT;
  i INT;
  fam_id UUID;
  user_id UUID;
BEGIN
  FOR f IN 1..$FAMILIES LOOP
    INSERT INTO families (name)
    VALUES (format('$PROBE_FAMILY_PREFIX %s', f))
    RETURNING id INTO fam_id;

    FOR m IN 1..$MEMBERS LOOP
      user_id := gen_random_uuid();
      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at
      ) VALUES (
        user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        format('probe-%s-%s@$PROBE_EMAIL_DOMAIN', f, m), '', now(), now(), now()
      );
      INSERT INTO profiles (id, family_id, first_name, last_name)
      VALUES (user_id, fam_id, format('Probe%s', f), format('Member%s', m));

      -- Both digests enabled: with ?force=morning every user goes through
      -- processDigest, which is the most expensive path in the old code.
      INSERT INTO notification_preferences (
        user_id, morning_enabled, morning_time, evening_enabled, evening_time, timezone
      ) VALUES (user_id, true, '08:00', true, '20:00', 'Europe/Belgrade');
    END LOOP;

    FOR i IN 1..$ITEMS LOOP
      -- An event today with a reminder: inside the +-1 day window every tick.
      INSERT INTO events (family_id, name, date, start_time, remind_minutes_before)
      VALUES (fam_id, format('Probe event %s-%s', f, i), CURRENT_DATE, '18:00', 30);

      -- An unpaid payment with a reminder: inside the [-1, +14] window.
      INSERT INTO payments (family_id, name, amount, due_date, remind_days_before, is_paid, is_paused)
      VALUES (fam_id, format('Probe payment %s-%s', f, i), 1000, CURRENT_DATE + 3, 2, false, false);
    END LOOP;

    INSERT INTO birthdays (family_id, name, birth_date)
    VALUES (fam_id, format('Probe birthday %s', f), CURRENT_DATE - INTERVAL '30 years');
  END LOOP;
END
\$\$;
SQL
  echo "Done."
  summary
}

# ---------------------------------------------------------------------------
# cleanup
# ---------------------------------------------------------------------------

cleanup() {
  require_stack
  echo "Deleting the synthetic load..."
  psql_q <<SQL
DELETE FROM auth.users WHERE email LIKE '%@$PROBE_EMAIL_DOMAIN';
DELETE FROM families WHERE name LIKE '$PROBE_FAMILY_PREFIX%';
SQL
  echo "Done."
  summary
}

summary() {
  psql_q -tAc "
    SELECT 'probe families: ' || count(*) FROM families WHERE name LIKE '$PROBE_FAMILY_PREFIX%'
    UNION ALL
    SELECT 'probe users: ' || count(*) FROM auth.users WHERE email LIKE '%@$PROBE_EMAIL_DOMAIN';"
}

# ---------------------------------------------------------------------------
# measure
# ---------------------------------------------------------------------------

measure() {
  require_stack

  if [ ! -f "$ENV_FILE" ]; then
    echo "No '$ENV_FILE' - that is where CRON_SECRET lives." >&2
    exit 1
  fi
  local secret
  secret="$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | tr -d "\"'\r")"
  if [ -z "$secret" ]; then
    echo "CRON_SECRET is not set in '$ENV_FILE'." >&2
    exit 1
  fi

  echo "Starting state:"
  summary
  echo

  for force in "" "morning"; do
    local url="$FUNCTIONS_URL"
    local label="no force (plain tick)"
    if [ -n "$force" ]; then
      url="$FUNCTIONS_URL?force=$force"
      label="?force=$force (morning digest for everyone)"
    fi

    psql_q -tAc "SELECT pg_stat_statements_reset();" > /dev/null

    local codes=""
    for _ in $(seq 1 "$RUNS"); do
      codes="$codes $(curl -s -o /dev/null -w '%{http_code}' -m 120 -X POST "$url" -H "X-Cron-Secret: $secret")"
    done

    echo "=== $label ==="
    echo "HTTP responses:$codes ($RUNS ticks)"
    psql_q -tAc "
      SELECT 'SQL queries total: ' || COALESCE(sum(calls), 0) ||
             ' (per tick: ' || round(COALESCE(sum(calls), 0)::numeric / $RUNS, 1) || ')'
      FROM pg_stat_statements s
      JOIN pg_roles r ON r.oid = s.userid
      WHERE r.rolname IN ('authenticator', 'service_role', 'anon', 'authenticated');"
    echo "Most frequent queries:"
    psql_q -c "
      SELECT calls, round(calls::numeric / $RUNS, 1) AS per_tick, left(regexp_replace(query, '\s+', ' ', 'g'), 88) AS query
      FROM pg_stat_statements s
      JOIN pg_roles r ON r.oid = s.userid
      WHERE r.rolname IN ('authenticator', 'service_role', 'anon', 'authenticated')
      ORDER BY calls DESC
      LIMIT 12;"
    echo
  done
}

case "$MODE" in
  seed) seed ;;
  cleanup) cleanup ;;
  measure) measure ;;
  *)
    echo "Usage: $0 [seed|measure|cleanup]" >&2
    exit 1
    ;;
esac
