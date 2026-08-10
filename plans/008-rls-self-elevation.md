# Plan 008: Stop self-elevation and tenant reassignment through the self-update profiles policy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. Touch only in-scope files. On any
> STOP condition, stop and report. Your reviewer maintains `plans/README.md`.
>
> **THIS PLAN WRITES A DB MIGRATION BUT MUST NOT DEPLOY IT.** Do not run
> `supabase db push`, `supabase functions deploy`, or any command that touches
> the production project (`tiokicffpbzqgrsqrkgt`). Production deploys require
> the repo owner's explicit per-batch authorization, which this plan does NOT
> carry. Local verification only.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- supabase/migrations src/hooks/useFamilyMembers.ts src/hooks/useProfile.ts`
> On any change to the profiles policies since f46bc51, STOP.

## Status

- **Priority**: P0 (highest of the whole audit)
- **Effort**: S
- **Risk**: MED (an over-tight policy breaks the settings screen; an under-tight one does not fix the hole)
- **Depends on**: none (independent of 001-007; branch from `main`)
- **Category**: security
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

`profiles` carries two permissive UPDATE policies, and Postgres OR-s permissive
policies together:

- `supabase/migrations/20260130000000_initial_schema.sql:99` -
  `CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);`
  No `WITH CHECK`, no column restriction. Verified never dropped by any later
  migration.
- `supabase/migrations/20260602000000_family_admin.sql:100` -
  `CREATE POLICY "Admins can update family profiles" ON profiles FOR UPDATE USING (public.is_family_admin(family_id));`

The admin gate is therefore only enforced for OTHER people's rows. Any
authenticated member can update their OWN row without column limits. Verified
absent: any `BEFORE UPDATE` trigger on `profiles` guarding `is_admin` (the only
triggers are `update_profiles_updated_at` and `sync_profile_full_name_trigger`),
and any `WITH CHECK` on a profiles policy.

Consequences, both reachable from the ordinary client (`supabase.from("profiles").update(...)`):

1. **Self-elevation**: a member sets their own `is_admin = true` and gains
   every admin capability - kid PIN changes and device invites
   (`kid-access`), creating/disabling logins (`manage-family-login`), roster
   changes, family rename.
2. **Tenant reassignment**: a member rewrites their own `family_id`. Every
   family-scoped policy in the schema resolves tenancy through
   `family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid())`, so
   the session's whole data scope (events, payments, expenses, receipts,
   incomes, birthdays) moves with it.

The repo already knows this shape is wrong and already has the right pattern:
`supabase/migrations/20260808000000_kid_mode.sql:209-212` names this very
policy as the too-broad example not to repeat, and `kid_set_theme`
(`kid_mode.sql:213-232`) is the `SECURITY DEFINER`, one-column, `SET search_path = ''`
RPC pattern to follow.

Kid sessions are NOT affected (they have no `profiles` row; kid policies are
SELECT-only). This is an adult-member issue.

Conventions: Serbian user-visible strings, English code comments, and NO em
dash / en dash / Unicode minus anywhere - ASCII `-` only. Note the existing
migrations are written with ASCII-only Serbian comments (no diacritics) - match
that style in SQL.

## Current state

Columns on `profiles` (from all `ALTER TABLE profiles ADD COLUMN` statements
plus the initial schema): `id`, `family_id`, `full_name` (trigger-computed),
`first_name`, `last_name`, `avatar_url`, `color`, `is_admin`,
`onboarding_hidden_at`, `nav_slots`, `accent`, `avatar_emoji`,
`member_avatar_style`, `created_at`, `updated_at`.

Every legitimate SELF-update the client performs today (grep-verified, all
`.eq("id", <own user id>)`):

| Call site                                 | Columns written           |
| ----------------------------------------- | ------------------------- |
| `src/hooks/useProfile.ts:87-92`           | `first_name`, `last_name` |
| `src/hooks/useProfile.ts:135-137`         | `nav_slots`               |
| `src/hooks/useAccent.ts:96`               | `accent`                  |
| `src/hooks/useFirstSteps.ts:61-63`        | `onboarding_hidden_at`    |
| `src/hooks/useMemberAvatarStyle.ts:83-85` | `member_avatar_style`     |

Updates to OTHER members' rows (must keep working for admins, via the existing
admin policy): `src/hooks/useFamilyMembers.ts:150-152` (`color`), `:184-186`
(`avatar_emoji`), `:218-224` (`first_name`/`last_name`), `:248-250`
(`is_admin`).

Note the overlap: `color` and `avatar_emoji` are written through the
family-members path (admin policy) even when the target is the caller. The new
self-policy should still allow them so a self-edit does not depend on being an
admin - confirm the intent while implementing (see STOP conditions).

Migration file naming: timestamped `YYYYMMDDHHMMSS_slug.sql` in
`supabase/migrations/`, e.g. `20260808030000_profiles_with_login_avatar_emoji.sql`.
Use a timestamp AFTER the newest existing migration.

## Commands you will need

| Purpose                  | Command             | Expected                       |
| ------------------------ | ------------------- | ------------------------------ |
| Install                  | `pnpm install`      | exit 0                         |
| Local Supabase up        | `supabase start`    | exit 0 (containers running)    |
| Apply migrations locally | `supabase db reset` | exit 0, all migrations applied |
| Check                    | `pnpm check`        | exit 0                         |
| Tests                    | `pnpm test`         | all pass                       |
| Build                    | `pnpm build`        | exit 0                         |

If `supabase start`/`db reset` is unavailable in your environment, say so
plainly in the report and mark the SQL verification as NOT RUN - do not claim
a verification you did not perform.

## Scope

**In scope**:

- ONE new file: `supabase/migrations/<timestamp>_profiles_self_update_guard.sql`

**Out of scope**:

- Any production deploy (see the banner above).
- `src/**` - no client change should be needed; if you believe one is, that is
  a STOP condition, not a scope extension.
- The `Admins can update family profiles` policy - leave it exactly as is.
- The kid-mode policies, `families`, and every other table.
- SEC-03/SEC-04/other security findings - separate plans.

## Git workflow

- Branch from main: `git checkout -b advisor/008-rls-self-elevation main`
- One commit, English imperative, e.g.
  `RLS: a member can no longer grant themselves admin or change family`
  with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do NOT push, do NOT open a PR, do NOT deploy.

## Steps

### Step 1: Write the migration

Create the migration with this shape (adapt names/comments to match the
surrounding migration style - ASCII-only English comments):

```sql
-- Replace the too-wide self-update policy: the columns that decide privileges
-- (is_admin) and family membership (family_id, id) must not be writable
-- through a self-update. The old policy was
-- FOR UPDATE USING (auth.uid() = id) with no WITH CHECK, so a member could set
-- is_admin = true on themselves, or overwrite family_id and move the entire
-- data scope they can see.

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin = (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid())
    AND family_id = (SELECT p.family_id FROM public.profiles p WHERE p.id = auth.uid())
  );
```

Rationale to keep in the file: the `WITH CHECK` compares the NEW row's
privileged columns against the row as it exists in the table, so a self-update
may change anything except `is_admin` and `family_id`. `id` cannot change
because both `USING` and `WITH CHECK` pin it to `auth.uid()`.

Verify the subquery approach actually works under RLS for this policy (the
policy body runs as the invoking role; `public.profiles` is readable to the
caller for their own row via the existing SELECT policy). If the subquery is
rejected or recurses, use the documented alternative instead: keep the policy
simple (`USING (auth.uid() = id) WITH CHECK (auth.uid() = id)`) and add a
`BEFORE UPDATE` trigger that raises when `NEW.is_admin IS DISTINCT FROM OLD.is_admin`
or `NEW.family_id IS DISTINCT FROM OLD.family_id` AND the caller is not a
family admin (`public.is_family_admin(OLD.family_id)`) - the trigger form is
more robust and also covers the admin path consistently. Choose ONE, and say
in your report which and why.

**Verify**: `supabase db reset` -> exit 0, no SQL errors.

### Step 2: Prove the hole is closed and the app still works (local SQL checks)

With local Supabase running, execute checks as a NON-admin member. Use
`supabase db reset` fixtures or create two profiles in one family (one admin,
one not). For the non-admin session, assert:

1. `UPDATE profiles SET is_admin = true WHERE id = <own id>;` -> 0 rows
   affected or a policy violation error.
2. `UPDATE profiles SET family_id = '<other uuid>' WHERE id = <own id>;` ->
   0 rows / violation.
3. `UPDATE profiles SET first_name = 'Test' WHERE id = <own id>;` -> 1 row,
   succeeds.
4. `UPDATE profiles SET nav_slots = ARRAY['calendar','money'] WHERE id = <own id>;` -> succeeds.
5. `UPDATE profiles SET accent = 'blue', member_avatar_style = 'circle', onboarding_hidden_at = now() WHERE id = <own id>;` -> succeeds.
6. As an ADMIN session: `UPDATE profiles SET is_admin = true WHERE id = <other member id>;` -> still succeeds (the admin policy path must be untouched).

Record the exact commands and their results in your report. If you cannot run
a local Supabase, STOP and report - do not guess.

**Verify**: checks 1-2 blocked, 3-6 succeed.

### Step 3: Frontend sanity

**Verify**: `pnpm check && pnpm test && pnpm build` -> all exit 0 (no client
change is expected; this proves nothing broke).

## Test plan

The verification is the SQL matrix in Step 2 - there is no JS test layer for
RLS in this repo (tests mock `@/lib/supabase` entirely, so they cannot cover
policies). Do NOT add a JS test that pretends to test RLS. If you want a
durable regression guard, note in your report that a `supabase/tests/` pgTAP
suite would be the right home; do not create one in this plan.

## Done criteria

- [ ] Exactly one new file under `supabase/migrations/`, nothing else changed
- [ ] `supabase db reset` applies cleanly
- [ ] Step 2 checks 1-2 are blocked; 3-6 succeed; check 6 (admin path) succeeds
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0
- [ ] NOTHING was deployed (no `supabase db push`, no `functions deploy`)

## STOP conditions

- `supabase start` / `db reset` unavailable -> stop, report, mark SQL verification NOT RUN.
- The `WITH CHECK` subquery form fails, recurses, or blocks a legitimate
  self-update from the table in "Current state" -> switch to the trigger form;
  if that also fails, STOP with the error.
- Any client code turns out to need changing (e.g. a self-update path that
  legitimately writes `is_admin`) -> STOP and report which call site.
- You find an existing production data condition suggesting the hole was
  already exploited (e.g. profiles whose `family_id` does not match their
  family's members) -> STOP and report immediately; do not "fix" data.

## Maintenance notes

- Any future `ALTER TABLE profiles ADD COLUMN` is automatically self-writable
  under this policy. If a future column is privilege-bearing, it must be added
  to the `WITH CHECK` (or the trigger) in the same migration - call this out in
  review.
- The same "permissive policy with no column restriction" shape should be
  audited on any other table where a row's own owner can update it; this plan
  only fixes `profiles`.
- Deploying this to production is a separate, explicitly-authorized step. The
  fix is backward-compatible with the current client, so it can ship on its
  own ahead of the other plans.
- Related, NOT fixed here (separate plans): `update-user-email` accepts kid
  sessions and needs no reauth (SEC-03); `notify-on-create` pushes personal
  list names to the whole family (SEC-04); `receipt-import` follows redirects
  off the allowlisted host (SEC-05).
