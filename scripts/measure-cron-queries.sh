#!/usr/bin/env bash
#
# Izmeri koliko SQL upita kosta jedan tick `send-due-pushes` funkcije.
#
# Funkcija se vrti svakog minuta preko pg_cron, pa je njen trosak stalan i
# nezavisan od toga da li ista treba poslati. Ovo je alat kojim se to meri pre
# i posle izmene - polazna slika je bila 512 PostgREST zahteva po ticku na 40
# korisnika, posle prelaska na bulk upite 12.
#
# Radi nad LOKALNIM Supabase stack-om (`supabase start`) i cita brojeve iz
# `pg_stat_statements`. Isti pristup radi i na produkciji, samo se promene
# DB_CONTAINER / FUNCTIONS_URL (na prod-u se umesto docker exec koristi psql
# prema pooler-u).
#
# Upotreba:
#
#   scripts/measure-cron-queries.sh seed      # napravi sinteticki teret
#   scripts/measure-cron-queries.sh measure   # resetuj statistiku pa meri
#   scripts/measure-cron-queries.sh cleanup   # obrisi sinteticki teret
#
# Sinteticki teret je ogranicen na porodice ciji `name` pocinje sa
# "ZZ scaling probe" i na auth korisnike sa `@scaling-probe.local` mejlom, pa
# `cleanup` ne moze da dodirne stvarne demo podatke.
#
# Preduslov za `measure`: edge funkcije moraju da se vrte sa custom secret-ima
# (CRON_SECRET, VAPID_*), sto `supabase start` sam po sebi NE radi:
#
#   supabase functions serve --env-file supabase/functions/.env.local
#
set -euo pipefail

MODE="${1:-measure}"

DB_CONTAINER="${DB_CONTAINER:-supabase_db_family-assistant}"
FUNCTIONS_URL="${FUNCTIONS_URL:-http://127.0.0.1:54321/functions/v1/send-due-pushes}"
ENV_FILE="${ENV_FILE:-supabase/functions/.env.local}"

# Velicina sintetickog tereta. Podrazumevano 10 porodica x 4 clana = 40
# korisnika, sto je ~1/4 scenarija iz plana (100 porodica / 150 korisnika).
FAMILIES="${FAMILIES:-10}"
MEMBERS="${MEMBERS:-4}"
ITEMS="${ITEMS:-5}"   # dogadjaja i placanja po porodici
RUNS="${RUNS:-3}"     # koliko tickova se meri

PROBE_FAMILY_PREFIX="ZZ scaling probe"
PROBE_EMAIL_DOMAIN="scaling-probe.local"

psql_q() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

require_stack() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    echo "Kontejner '$DB_CONTAINER' ne radi. Pokreni 'supabase start'." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# seed
# ---------------------------------------------------------------------------

seed() {
  require_stack
  echo "Pravim $FAMILIES porodica x $MEMBERS clanova, $ITEMS dogadjaja i $ITEMS placanja po porodici..."
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
      VALUES (user_id, fam_id, format('Probe%s', f), format('Clan%s', m));

      -- Oba digesta ukljucena: sa ?force=morning svaki korisnik prolazi kroz
      -- processDigest, sto je najskuplja putanja u starom kodu.
      INSERT INTO notification_preferences (
        user_id, morning_enabled, morning_time, evening_enabled, evening_time, timezone
      ) VALUES (user_id, true, '08:00', true, '20:00', 'Europe/Belgrade');
    END LOOP;

    FOR i IN 1..$ITEMS LOOP
      -- Dogadjaj danas sa podsetnikom: ulazi u +-1 dan prozor svakog ticka.
      INSERT INTO events (family_id, name, date, start_time, remind_minutes_before)
      VALUES (fam_id, format('Probe dogadjaj %s-%s', f, i), CURRENT_DATE, '18:00', 30);

      -- Neplaceno placanje sa podsetnikom: ulazi u [-1, +14] prozor.
      INSERT INTO payments (family_id, name, amount, due_date, remind_days_before, is_paid, is_paused)
      VALUES (fam_id, format('Probe placanje %s-%s', f, i), 1000, CURRENT_DATE + 3, 2, false, false);
    END LOOP;

    INSERT INTO birthdays (family_id, name, birth_date)
    VALUES (fam_id, format('Probe rodjendan %s', f), CURRENT_DATE - INTERVAL '30 years');
  END LOOP;
END
\$\$;
SQL
  echo "Gotovo."
  summary
}

# ---------------------------------------------------------------------------
# cleanup
# ---------------------------------------------------------------------------

cleanup() {
  require_stack
  echo "Brisem sinteticki teret..."
  psql_q <<SQL
DELETE FROM auth.users WHERE email LIKE '%@$PROBE_EMAIL_DOMAIN';
DELETE FROM families WHERE name LIKE '$PROBE_FAMILY_PREFIX%';
SQL
  echo "Gotovo."
  summary
}

summary() {
  psql_q -tAc "
    SELECT 'probe porodica: ' || count(*) FROM families WHERE name LIKE '$PROBE_FAMILY_PREFIX%'
    UNION ALL
    SELECT 'probe korisnika: ' || count(*) FROM auth.users WHERE email LIKE '%@$PROBE_EMAIL_DOMAIN';"
}

# ---------------------------------------------------------------------------
# measure
# ---------------------------------------------------------------------------

measure() {
  require_stack

  if [ ! -f "$ENV_FILE" ]; then
    echo "Nema '$ENV_FILE' - u njemu je CRON_SECRET." >&2
    exit 1
  fi
  local secret
  secret="$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | tr -d "\"'\r")"
  if [ -z "$secret" ]; then
    echo "CRON_SECRET nije postavljen u '$ENV_FILE'." >&2
    exit 1
  fi

  echo "Polazno stanje:"
  summary
  echo

  for force in "" "morning"; do
    local url="$FUNCTIONS_URL"
    local label="bez force (obican tick)"
    if [ -n "$force" ]; then
      url="$FUNCTIONS_URL?force=$force"
      label="?force=$force (jutarnji digest za sve)"
    fi

    psql_q -tAc "SELECT pg_stat_statements_reset();" > /dev/null

    local codes=""
    for _ in $(seq 1 "$RUNS"); do
      codes="$codes $(curl -s -o /dev/null -w '%{http_code}' -m 120 -X POST "$url" -H "X-Cron-Secret: $secret")"
    done

    echo "=== $label ==="
    echo "HTTP odgovori:$codes ($RUNS tickova)"
    psql_q -tAc "
      SELECT 'SQL upita ukupno: ' || COALESCE(sum(calls), 0) ||
             ' (po ticku: ' || round(COALESCE(sum(calls), 0)::numeric / $RUNS, 1) || ')'
      FROM pg_stat_statements s
      JOIN pg_roles r ON r.oid = s.userid
      WHERE r.rolname IN ('authenticator', 'service_role', 'anon', 'authenticated');"
    echo "Najcesci upiti:"
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
    echo "Upotreba: $0 [seed|measure|cleanup]" >&2
    exit 1
    ;;
esac
