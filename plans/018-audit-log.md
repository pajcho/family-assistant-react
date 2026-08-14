# 018 - Change history for every module ("Ko je šta menjao")

**Status:** TODO
**Priority:** P2 (feature)
**Effort:** L
**Depends on:** nothing (branches from `main`)
**Branches:** three stacked PRs, see section 9.

Design document this plan implements (it carries the mockups and the rejected
alternatives): <https://claude.ai/code/artifact/79b20a29-53b8-435c-b70a-b68ed241446f>

Writing rules for this repo, enforced by `pnpm check`: no em dash, no en dash,
no Unicode minus anywhere - ASCII `-` only. Comments, identifiers, migrations,
commit messages and docs are English; Serbian appears only inside string
literals a person reads.

---

## 1. What this builds

Every module gets an answer to three questions that only lists can answer today:
who added this, who changed what, and who deleted it.

`lists` and `tasks` already carry `created_by_id` / `updated_by_id`, filled by
`set_list_defaults()` / `update_task_audit_fields()`, and `ListInfoPanel`
already renders them. This plan is that pattern generalized, plus a real change
log underneath it. It is not a new concept in this codebase.

| Question                          | Answered by | Where it shows                        |
| --------------------------------- | ----------- | ------------------------------------- |
| Who added this, and when?         | Layer 1     | Quiet line at the bottom of the sheet |
| Who last touched it?              | Layer 1     | Same line                             |
| What exactly changed, from what?  | Layer 2     | `Istorija izmena` sub-view            |
| Who deleted the thing that's gone | Layer 2     | Per-module view (deferred, see 9)     |

## 2. Decisions already locked (do not re-open)

Settled with the maintainer on 2026-08-14. All five follow the recommendation in
the design document.

1. **Both layers ship.** Layer 1 (columns) and layer 2 (`audit_log`) are
   separate PRs but both are in scope.
2. **Deletions are logged**, and `audit_log.label` exists solely so a deleted
   row stays readable after its source is gone.
3. **The entry point is a quiet line**, not a `DetailActionRow`. It sits below
   the action list, `text-muted-foreground`, with a chevron. Detail sheets are
   already dense and a sixth action row makes them worse.
4. **Retention is 12 months**, pruned by pg_cron, same guarded
   unschedule-then-schedule shape as `purge-notification-log`
   (20260729000000_notification_log_retention.sql).
5. **A per-module view ("what changed in Novac this week") is deferred** until
   after PR 3. It is the only way to see a deletion, because a deleted row has
   no sheet left to open, so it is wanted - just not first.

## 3. Storage cost (measured, do not re-measure)

Measured on Postgres 17.6 in a throwaway database, 100k rows, indexes included,
via `pg_total_relation_size`. The mix was 25% create, 65% update with 1-3
changed fields, 10% delete.

| Variant                                | Bytes/row | 100k rows |
| -------------------------------------- | --------- | --------- |
| Rich: `label` + 2 indexes (**chosen**) | 341 B     | 33 MB     |
| Lean: 1 index, no `label`              | 255 B     | 24 MB     |
| Field names only, no values            | 187 B     | 18 MB     |

The shape in section 5 adds `owner_id` and `visibility` on top of what was
measured, so budget **~365 B/row**. At a realistic 50 writes/day that is
**~6.7 MB/year per family**, and 12-month retention holds it at that plateau.
Storage is not a constraint here; do not spend effort shrinking the row.

Layer 1 is 32 B per existing row, one time.

## 4. Layer 1 - `created_by_id` / `updated_by_id` everywhere

### 4.1 Tables that get the two columns

`payments`, `events`, `expenses`, `incomes`, `income_entries`, `activities`,
`birthdays`, `expense_categories`.

Not `lists` / `tasks` (they already have them). Not `external_calendar_events`
(written by sync, never by a person). Not join tables
(`*_participants`, `task_assignees`) - a participant change is an edit of its
parent and shows there.

```sql
ALTER TABLE payments
  ADD COLUMN created_by_id UUID REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN updated_by_id UUID REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE;
```

`REFERENCES profiles`, never `auth.users` - the same rule
20260811000000_tasks.sql applies to `completed_by_person_id`, and the reason is
kid profiles, which have no `auth.users` row. `ON UPDATE CASCADE` matches
20260808010000_person_fk_on_update_cascade.sql.

**No backfill.** Rows written before this migration have an unknown author and
NULL is the honest value. The UI must render that as absence, not as a broken
name (see 4.3).

### 4.2 One shared actor helper

Every trigger and both layers need the same answer to "who is acting", and
`auth.uid()` alone is wrong for kids.

```sql
CREATE OR REPLACE FUNCTION public.audit_actor_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$ SELECT COALESCE(public.kid_profile_id(), auth.uid()) $$;
```

A kid acts through a synthetic auth user that has **no row in `profiles`**
(see 20260808000000_kid_mode.sql). Storing the raw `auth.uid()` would produce a
FK violation on insert, or - if the FK were dropped - a row the UI renders as
"nepoznat korisnik". `kid_profile_id()` maps it to the child's real profile.

**The result must then be checked against `profiles`, and the function must be
SECURITY DEFINER to do it.** Found during verification, not by reasoning: the
local database had five authenticated users with no profile row, four of them
orphaned kid identities. Disabling a child's access clears
`kid_access.auth_user_id` but leaves the synthetic auth user standing, so an
orphaned token still authenticates, `kid_profile_id()` stops resolving it, and
`auth.uid()` names somebody `profiles` has never heard of. The FK then rejects
the stamp and **the person's write fails** - the audit machinery breaking the
thing it exists to observe. Filtering through `profiles` degrades that to NULL,
which the schema and the UI already model as "we do not know who did this".

SECURITY DEFINER because `profiles` is RLS-protected and a child cannot select
from it, so an invoker-rights lookup would return NULL for exactly the callers
this is meant to resolve. It leaks nothing: the only value it can return is the
caller's own id.

Generic BEFORE INSERT and BEFORE UPDATE triggers then fill the pair, mirroring
`update_task_audit_fields()`. Both must tolerate `audit_actor_id()` returning
NULL (pg_cron, edge functions on the service role) by leaving the prior value
in place rather than nulling it:

```sql
NEW.updated_by_id = COALESCE(public.audit_actor_id(), OLD.updated_by_id);
```

### 4.3 The quiet line

One shared component, rendered by every detail sheet below its
`DetailActionList`:

```
Dodala Marija · 12.08.  ·  izmenjeno juče                              ›
```

Rules:

- Name resolution goes through `useFamilyMembers().byId`, exactly as
  `ListInfoPanel` does. A missing person renders as the existing neutral
  fallback, never as a crash or a raw UUID.
- **Never write a verb that needs gender agreement.** The app does not know a
  member's gender. "Dodala Marija" is wrong for Nikola. Use the noun form
  (`Dodato · Marija`) or drop the verb entirely (`Marija · 12.08.`). The same
  constraint already shaped `TaskHistoryPanel`'s progress line ("count first, no
  verb") and `progressLine()` there is the reference.
- The "izmenjeno" half is hidden when `updated_at == created_at`, the rule
  `ListInfoPanel` already applies per item.
- With both columns NULL (a pre-migration row) the line shows only the date, and
  no chevron in PR 1.

Sheets to wire: `PaymentDetailDialog`, `EventDetailDialog`, `TaskDetailSheet`,
`ActivityDetailDialog`, `BirthdayDetailDialog`, `CategoryDetailSheet`. Not
`ExternalEventDetailDialog` - a Google event has no local author.

Two deviations found while wiring, both applied:

- **`PaymentOccurrenceDialog` is out.** It is a frozen snapshot of a
  `payment_history` or projected row, not the series. Its authorship columns do
  not exist, and showing the series' author on a sheet about one occurrence
  answers a question nobody asked. The series has its own sheet.
- **`TaskDetailSheet` already answered this**, as two `DetailInfoText` rows
  ("Kreirao/la" and "Poslednja izmena") inside the facts card. Both were
  removed in favour of the shared line, so the six sheets say the same thing
  the same way - and the "Kreirao/la" slash, which was the app admitting it
  cannot pick a gender, disappears with them.

## 5. Layer 2 - `audit_log`

```sql
CREATE TABLE audit_log (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id    UUID        NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  entity_type  TEXT        NOT NULL,
  entity_id    UUID        NOT NULL,
  action       TEXT        NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  actor_id     UUID        REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  visibility   TEXT        NOT NULL DEFAULT 'family' CHECK (visibility IN ('family', 'owner')),
  owner_id     UUID        REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  label        TEXT,
  changes      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_log_family ON audit_log (family_id, created_at DESC);
```

`id` is `BIGINT`, not `UUID`: nothing references an audit row, and the table is
always read in `created_at` order.

### 5.1 Privacy: `visibility` is written, not derived

`lists.scope = 'personal'` is invisible to the rest of the family. An RLS policy
of "same family" on `audit_log` would leak the name of every personal task
through its change log.

The visibility therefore has to be **copied onto the audit row at write time**.
It cannot be resolved at read time by joining back to the source, because for a
`delete` the source row is gone - which is exactly the case that matters most.

```sql
CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (
  (visibility = 'family' AND family_id = public.auth_user_family_id())
  OR (visibility = 'owner' AND owner_id = public.audit_actor_id())
);
```

No INSERT / UPDATE / DELETE policy at all: the table is written only by the
trigger, which is SECURITY DEFINER, and pruned only by the cron job. A client
must never be able to forge or rewrite history.

Consequence to accept deliberately: **kid sessions see nothing**. A kid has no
`profiles`-backed family membership through `auth_user_family_id()`, so the
policy denies by default. That is the safe direction, but it is a decision - if
the kid app should ever show "mama je dodala ovo", it needs its own policy arm.

### 5.2 The trigger and its noise rules

One generic `AFTER INSERT OR UPDATE OR DELETE` function, attached per table,
taking the audited column list from a lookup rather than diffing `to_jsonb` of
the whole row. It must skip, in this order:

1. **No actor.** `audit_actor_id()` IS NULL means pg_cron, an edge function, or
   the service role. Skip the row entirely rather than writing an unattributable
   entry. (`gcal` sync is the big one; see also
   [Reference: service_role bypasses RLS] - service role writes are invisible to
   RLS but very much visible to this trigger.)
2. **Empty diff.** If no audited column actually changed, write nothing.
   Mandatory, not an optimization: `bump_parent_list_on_item_change()` UPDATEs
   the parent list's `updated_at` on _every_ task change, so without this rule
   every shopping-list tick would append a contentless list entry.
3. **Unaudited tables.** `external_calendar_events` (rewritten on every sync
   poll - it would out-produce every other table combined) and
   `task_occurrences` (already has its own screen in `TaskHistoryPanel`;
   auditing it means two different answers to one question).

`changes` is `{"column": [old, new]}`. On `create` it is NULL, on `delete` it is
NULL and `label` carries the name.

### 5.3 Audited columns per entity

Deliberately short lists. `id`, `family_id`, `created_at`, `updated_at`,
`sort_order` and derived columns (`exchange_rate`, `original_amount`,
`due_anchor_day`, `paid_date`, `scope`) are never audited.

| Entity               | Audited columns                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `payments`           | `name`, `description`, `amount`, `currency`, `due_date`, `category_id`, `is_paid`, `is_paused`, `is_recurring`, `recurrence_period`, `recurrence_interval`, `remind_days_before`           |
| `events`             | `name`, `description`, `notes`, `date`, `end_date`, `start_time`, `end_time`, `canceled_at`, `cancel_reason`, `remind_minutes_before`                                                      |
| `expenses`           | `amount`, `currency`, `spent_on`, `category_id`, `person_id`, `note`, `merchant`                                                                                                           |
| `activities`         | `name`, `description`, `notes`, `active_from`, `active_to`, `is_paused`, `remind_minutes_before`                                                                                           |
| `birthdays`          | `name`, `description`, `birth_date`                                                                                                                                                        |
| `incomes`            | `name`, `amount`, `person_id`, `day_of_month`, `is_recurring`, `active`                                                                                                                    |
| `income_entries`     | `name`, `amount`, `month`, `received_on`, `person_id`, `note`, `is_one_time`                                                                                                               |
| `tasks`              | `name`, `description`, `due_date`, `due_time`, `list_id`, `recurrence_period`, `recurrence_interval`, `recurrence_until`, `completion_mode`, `remind_minutes_before`, `remind_days_before` |
| `lists`              | `name`, `description`, `scope`, `smart_sort_enabled`, `auto_delete_completed_after_hours`                                                                                                  |
| `expense_categories` | `name`, `color`, `icon`, `monthly_limit`                                                                                                                                                   |

`tasks.is_completed` is **not** audited. Ticking is the highest-frequency write
in the app, the current answer already lives in `completed_by_person_id`, and
repeats are covered by `TaskHistoryPanel`. Auditing it buys nothing and costs
the most rows.

### 5.4 Retention

```sql
SELECT cron.schedule('purge-audit-log', '43 3 * * *', $cron$
  DELETE FROM public.audit_log WHERE created_at < NOW() - INTERVAL '12 months';
$cron$);
```

03:43 UTC, off the digest minutes and off `purge-notification-log`'s 03:17.
Guard the schedule with the same `cron.unschedule` lookup those migrations use,
so re-running the migration replaces rather than duplicates the job.

## 6. Rendering the diff

This is the real work of the feature, and it is per-module and mechanical.
`{"category_id": ["a3f...", "9b1..."]}` is not history until it reads
`Kategorija: Ostalo -> Režije`.

One registry per entity: column -> `{ label: string, format: FormatterKind }`.
Ten formatter kinds cover every column in 5.3, and each one delegates to code
that already exists:

| Kind       | Columns                                         | Existing helper                       |
| ---------- | ----------------------------------------------- | ------------------------------------- |
| `money`    | `amount` (+ sibling `currency`)                 | `Amount`                              |
| `date`     | `due_date`, `spent_on`, `birth_date`, ...       | `formatDate`                          |
| `time`     | `start_time`, `due_time`, ...                   | existing time formatting              |
| `member`   | `person_id`                                     | `useFamilyMembers` + `getDisplayName` |
| `category` | `category_id`                                   | `useExpenseCategories`                |
| `list`     | `list_id`                                       | `useLists`                            |
| `bool`     | `is_paused`, `is_recurring`, `active`, ...      | new, trivial                          |
| `enum`     | `recurrence_period`, `completion_mode`, `scope` | existing label maps                   |
| `count`    | `remind_*_before`, `recurrence_interval`, ...   | `pluralSr`                            |
| `text`     | `name`, `note`, `merchant`, ...                 | truncate                              |

When a referenced row is gone (a deleted category), fall back to the field label
with no value rather than printing a UUID.

## 7. Naming

Three different things would otherwise all be called "Istorija":

| Screen                  | Answers                                 | Keep calling it     |
| ----------------------- | --------------------------------------- | ------------------- |
| `PaymentHistoryPanel`   | which months were paid or canceled      | `Istorija plaćanja` |
| `TaskHistoryPanel`      | which repeats were done, skipped, moved | `Istorija`          |
| **new** `AuditTimeline` | who edited which field, and from what   | `Istorija izmena`   |

The new sub-view is `Istorija izmena` everywhere, including its
`SheetStackHeader` title, so no sheet ever shows two rows with the same word.

## 8. UI mechanics

The sub-view is a `SheetStack` level pushed by the quiet line, per
[Project: SheetStack sub-modal convention]: a NEW overlay over the existing one,
`SheetStackHeader` with the back arrow, dismissal pops one level. It is not a
second `ResponsiveDialog` owned by the sheet.

Entries are grouped by day, newest first, and each is `avatar + name + time`
over one `Polje  staro -> novo` row per changed column. Empty state uses
`EmptyState` and says history is kept from the day the feature shipped, so an
old entity with nothing logged does not read as a bug.

## 9. PR breakdown

| PR  | Branch                | Contents                                                                                     | Independently useful           |
| --- | --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | `feat/audit-who`      | Section 4: columns, `audit_actor_id()`, generic triggers, quiet line on 7 sheets             | Yes - answers "who added this" |
| 2   | `feat/audit-log`      | Section 5: table, trigger, allowlist, RLS, retention. **No UI.** Let it fill for a few days. | No, but zero risk to ship      |
| 3   | `feat/audit-timeline` | Sections 6-8: field registry, `AuditTimeline`, wire the chevron on the quiet line            | Yes - the actual feature       |

Deferred to a fourth PR, per decision 5: the per-module view, which is the only
place a deletion can be seen.

## 10. STOP conditions

Stop and ask the maintainer rather than guessing if:

- A trigger would have to be attached to a table not listed in 5.3.
- `kid_profile_id()` turns out not to resolve for some kid path, which would
  mean audit rows with a NULL actor for real user actions.
- The measured row size in a real dataset exceeds 500 B, which would mean the
  allowlist is far wider than section 5.3 intends.
- Any change to the RLS policy in 5.1 becomes necessary - that policy is the
  privacy boundary for personal lists and must not be widened casually.

## 11. Verification

`supabase/tests/audit_log_verification.sql` carries 15 assertions covering both
migrations and is the file to re-run whenever the trigger or the policy is
touched. It runs in one transaction that rolls back, and it derives its own
family and members, so it is safe against a database with real data and needs no
local ids baked in:

```bash
docker exec -i supabase_db_family-assistant psql -U postgres -d postgres -X -q -f - < supabase/tests/audit_log_verification.sql
```

It lives there rather than in vitest because CI has no Supabase instance (see
[Project: CI has no Supabase env]) - and the personal-list boundary in 5.1 is
not reachable from JS at all. What it pins:

- Authorship: insert stamps both columns, an edit re-stamps only the editor, a
  service-role write keeps the known author, and a session with no profile row
  still writes (unattributed) instead of failing.
- Change log: a create carries the label and no diff, an edit carries exactly
  the audited columns old-and-new, a delete keeps the name of a row that is
  gone, and neither a service-role write nor an unaudited-column update logs
  anything.
- The empty-diff rule specifically: adding a task logs the task and does NOT log
  a contentless edit against the parent list that
  `bump_parent_list_on_item_change()` touched.
- Privacy: a personal list is logged owner-visible, another member of the same
  family reads zero rows for it while reading the family list fine, the owner
  still reads their own, and a client cannot INSERT an entry at all.

Still to check by hand, since neither is reachable from SQL:

- Kid actor end to end: have a kid session tick a chore, confirm `actor_id`
  resolves to the child's `profiles` row and the UI names them.
- Service role end to end: run the gcal sync and confirm it writes zero audit
  rows.
- CI: no test may import a module whose chain reaches `lib/supabase` - locally
  it passes on `.env` and fails on CI.
