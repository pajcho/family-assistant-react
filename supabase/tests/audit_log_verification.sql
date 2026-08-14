-- Verification for the change-history triggers and policies (plan 018).
--
-- Run by hand against a LOCAL database; CI has no Supabase instance, so none of
-- this can live in vitest:
--
--   docker exec -i supabase_db_family-assistant \
--     psql -U postgres -d postgres -X -q -f - < supabase/tests/audit_log_verification.sql
--
-- Everything runs inside ONE transaction that ROLLS BACK, so it writes nothing
-- and is safe against a database with real data in it. It picks its own family
-- and two of its members, so it needs no local ids baked in - any family with
-- two login-capable members will do.
--
-- The RLS section is the reason this file exists. `lists.scope = 'personal'` is
-- the app's only per-row privacy boundary, and audit_log is the one table that
-- can leak it AFTER the subject row is gone. A JS test cannot reach that; this
-- can, and it should be re-run whenever the policy or the trigger is touched.

\set ON_ERROR_STOP on
BEGIN;

-- Two members of one family, both with a real login.
SELECT p.family_id AS fam, min(p.id::text) AS a, max(p.id::text) AS b
FROM profiles p
JOIN auth.users u ON u.id = p.id
GROUP BY p.family_id
HAVING count(*) >= 2
LIMIT 1
\gset

\if :{?fam}
\else
  \echo 'SKIP: no family with two login-capable members in this database'
  \quit
\endif

\set a_claims '{"sub":"' :a '","role":"authenticated"}'
\set b_claims '{"sub":"' :b '","role":"authenticated"}'

\echo ''
\echo '=== Authorship columns (20260814140000) ==='

SET LOCAL request.jwt.claims = :'a_claims';

INSERT INTO payments (family_id, name, amount, due_date)
VALUES (:'fam', 'AUDIT VERIFICATION', 3500, '2026-09-01')
RETURNING id AS pid \gset

SELECT 'insert stamps both columns with the actor' AS assertion,
       (created_by_id::text = :'a' AND updated_by_id::text = :'a') AS pass
FROM payments WHERE id = :'pid';

SET LOCAL request.jwt.claims = :'b_claims';
UPDATE payments SET amount = 4200, due_date = '2026-09-05' WHERE id = :'pid';

SELECT 'an edit re-stamps the editor and leaves the creator alone' AS assertion,
       (created_by_id::text = :'a' AND updated_by_id::text = :'b') AS pass
FROM payments WHERE id = :'pid';

RESET request.jwt.claims;
UPDATE payments SET amount = 4300 WHERE id = :'pid';

SELECT 'a service-role write keeps the known author instead of nulling it' AS assertion,
       (public.audit_actor_id() IS NULL AND updated_by_id::text = :'b') AS pass
FROM payments WHERE id = :'pid';

-- An authenticated session whose uid has no profiles row - an orphaned kid
-- token outliving its kid_access row is the real-world case. This MUST NOT
-- fail the write; the author simply becomes unknown.
SET LOCAL request.jwt.claims = '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}';

INSERT INTO payments (family_id, name, amount, due_date)
VALUES (:'fam', 'AUDIT VERIFICATION ORPHAN', 100, '2026-09-01')
RETURNING id AS orphan_pid \gset

SELECT 'a session with no profile can still write, unattributed' AS assertion,
       (created_by_id IS NULL) AS pass
FROM payments WHERE id = :'orphan_pid';

SELECT 'and logs nothing, rather than an unattributable entry' AS assertion,
       (count(*) = 0) AS pass
FROM audit_log WHERE entity_id = :'orphan_pid';

\echo ''
\echo '=== Change log (20260814150000) ==='

SET LOCAL request.jwt.claims = :'a_claims';

SELECT 'a create is logged with the name, and with no diff' AS assertion,
       (action = 'create' AND label = 'AUDIT VERIFICATION' AND changes IS NULL) AS pass
FROM audit_log WHERE entity_id = :'pid' AND action = 'create';

SELECT 'an edit logs exactly the audited columns, old and new' AS assertion,
       (changes = '{"amount": [3500.00, 4200.00], "due_date": ["2026-09-01", "2026-09-05"]}'::jsonb) AS pass
FROM audit_log WHERE entity_id = :'pid' AND action = 'update' LIMIT 1;

SELECT 'the service-role edit above logged nothing' AS assertion,
       (count(*) = 1) AS pass
FROM audit_log WHERE entity_id = :'pid' AND action = 'update';

UPDATE payments SET updated_at = NOW() WHERE id = :'pid';
SELECT 'an update that changed no audited column logs nothing' AS assertion,
       (count(*) = 1) AS pass
FROM audit_log WHERE entity_id = :'pid' AND action = 'update';

DELETE FROM payments WHERE id = :'pid';
SELECT 'a delete keeps the name of a row that no longer exists' AS assertion,
       (label = 'AUDIT VERIFICATION') AS pass
FROM audit_log WHERE entity_id = :'pid' AND action = 'delete';

-- bump_parent_list_on_item_change() touches the parent list on EVERY item
-- change. Without the empty-diff rule, every shopping-list tick would append a
-- contentless entry against the list.
INSERT INTO lists (family_id, name, scope, owner_id)
VALUES (:'fam', 'AUDIT VERIFICATION LIST', 'family', :'a')
RETURNING id AS lid \gset

INSERT INTO tasks (family_id, list_id, name)
VALUES (:'fam', :'lid', 'AUDIT VERIFICATION TASK')
RETURNING id AS tid \gset

SELECT 'adding a task does not also log a contentless parent-list edit' AS assertion,
       ((SELECT count(*) FROM audit_log WHERE entity_id = :'lid' AND action = 'update') = 0
        AND (SELECT count(*) FROM audit_log WHERE entity_id = :'tid' AND action = 'create') = 1) AS pass;

\echo ''
\echo '=== Personal-list privacy (the boundary this file exists for) ==='

INSERT INTO lists (family_id, name, scope, owner_id)
VALUES (:'fam', 'AUDIT VERIFICATION PRIVATE', 'personal', :'a')
RETURNING id AS plid \gset

SELECT 'a personal list is logged owner-visible, a family one family-visible' AS assertion,
       ((SELECT visibility FROM audit_log WHERE entity_id = :'plid') = 'owner'
        AND (SELECT visibility FROM audit_log WHERE entity_id = :'lid') = 'family') AS pass;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = :'b_claims';

SELECT 'another member of the same family cannot read the personal history' AS assertion,
       ((SELECT count(*) FROM audit_log WHERE entity_id = :'plid') = 0) AS pass;

SELECT 'but can read the family one' AS assertion,
       ((SELECT count(*) FROM audit_log WHERE entity_id = :'lid') = 1) AS pass;

SET LOCAL request.jwt.claims = :'a_claims';
SELECT 'the owner still reads their own' AS assertion,
       ((SELECT count(*) FROM audit_log WHERE entity_id = :'plid') = 1) AS pass;

-- History a client could write is not history.
DO $$
BEGIN
  BEGIN
    INSERT INTO audit_log (family_id, entity_type, entity_id, action, visibility)
    VALUES ((SELECT family_id FROM profiles LIMIT 1), 'payments', gen_random_uuid(),
            'create', 'family');
    RAISE EXCEPTION 'FAILED: a client was able to INSERT into audit_log';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASSED: a client cannot forge an audit entry';
  END;
END $$;

RESET ROLE;
ROLLBACK;

\echo ''
\echo 'Done. Every "pass" column above must read t.'
