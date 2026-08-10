# Plan 012: Backend hardening - atomic PIN lockout, missing realtime triggers, personal lists stop pushing

> **Executor instructions**: Follow step by step, verify each step, touch only
> in-scope files, STOP rather than improvise. Your reviewer maintains
> `plans/README.md`. Run final verifications UNPIPED.
>
> **NO PRODUCTION DEPLOY.** This plan writes migrations and edits an edge
> function. Apply and verify LOCALLY only. Never run `supabase db push`,
> `supabase functions deploy`, or anything targeting the prod project ref.
> Deploying is the owner's separate, explicit decision.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- supabase src/hooks/useFamilyChannel.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (auth-adjacent logic + new triggers on hot tables)
- **Depends on**: none for the SQL; branch from `main` (independent of 001-011)
- **Category**: bug / security
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

Three independent backend defects, grouped because they are all
migration-shaped and all verified at f46bc51:

1. **The kid PIN lockout is not atomic** (BUG-02). `gateOnPin` reads
   `failed_attempts` from a row fetched earlier, adds one in JS, and writes the
   ABSOLUTE value back. Concurrent wrong-PIN attempts all read the same value
   and all write the same result, so a batch of N guesses costs ONE strike. The
   file's own header says the lockout, not the hash, is what makes a 4-digit
   secret defensible - so this weakens exactly the control the design leans on.
2. **Four tables have no realtime trigger** (BUG-03). `receipts`,
   `receipt_items`, `profiles` and `families` are missing from both the trigger
   list and `TABLE_INVALIDATIONS`. Member A splits a receipt; member B's open
   receipt view keeps the stale line ownership indefinitely and then hits
   avoidable PT409 claim conflicts. Same staleness for renamed families and
   changed member names/avatars.
3. **Personal lists push their name to the whole family** (SEC-04). The
   `notify_on_list_create` trigger is `FOR EACH ROW` with no `WHEN` clause, and
   the edge function fans out to every profile in the family - so a
   `scope = 'personal'` list, whose entire point is that others cannot see it,
   announces its title on everyone's lock screen. The realtime migration
   explicitly reasons about this same privacy rule; the push path just never
   got it.

Conventions: Serbian user-visible strings, English code comments in TS, and
migrations use ASCII-only Serbian comments (no diacritics) - match the
surrounding files. NO em dash / en dash / Unicode minus anywhere.

## Current state

**(1) PIN counter** - `supabase/functions/kid-auth/index.ts:359-375`:

```ts
const attempts = (access.failed_attempts ?? 0) + 1;
if (attempts >= MAX_PIN_ATTEMPTS) {
  const lockSeconds = LOCKOUT_MINUTES * 60;
  await admin
    .from("kid_access")
    .update({
      failed_attempts: 0,
      locked_until: new Date(Date.now() + lockSeconds * 1000).toISOString(),
    })
    .eq("profile_id", access.profile_id);
  return fail(lockedMessage(lockSeconds), "locked", 429, { retryAfterSeconds: lockSeconds });
}
await admin.from("kid_access").update({ failed_attempts: attempts });
```

`MAX_PIN_ATTEMPTS = 5` and `LOCKOUT_MINUTES` are constants near `:58`.
`access` comes from an earlier `loadAccess` (~`:319-326`). This function runs
with `verify_jwt = false` (documented at `:7`).

**(2) Missing triggers** - `supabase/migrations/20260729010000_family_broadcast_channel.sql:68-93`
attaches `broadcast_family_change` by looping a `tables TEXT[]` array (22
entries; `receipts`, `receipt_items`, `profiles`, `families` absent - the
receipt tables were created later, in `20260803000000_receipt_entities.sql`).
The array loop skips missing tables with a RAISE WARNING, and the file's comment
says to keep the list in sync with `TABLE_INVALIDATIONS`.
Client side: `src/hooks/useFamilyChannel.ts:42-68` - the map; `familyKey(root)`
at `:29-31` builds `[root, familyId]`; `paymentHistoryKey` at `:33` shows the
family-less form. Receipt query keys in use: `["receipt-context", receiptId]`
(`src/hooks/useExpenses.ts:300-308`) and `["receipt_items", expenseId]`
(`src/hooks/useReceiptImport.ts:148`).

**(3) Personal lists** - `supabase/migrations/20260520250000_notify_on_create.sql:98-101`:

```sql
CREATE TRIGGER notify_on_list_create
  AFTER INSERT ON lists
  FOR EACH ROW EXECUTE FUNCTION notify_family_on_entity_create('list');
```

The current function body lives in
`supabase/migrations/20260802095749_notify_on_create_vault_url.sql:56-70`.
`lists.scope` is `CHECK (scope IN ('personal','family'))`
(`20260520200000_lists_feature.sql:64`), and the RLS policy at `:187-190`
restricts personal lists to `owner_id`.
Recipient fan-out: `supabase/functions/notify-on-create/index.ts:121-124`
selects every profile with that `family_id`; the title lands in the body at
`:161-167`.

## Commands you will need

| Purpose   | Command                                    | Expected   |
| --------- | ------------------------------------------ | ---------- |
| Install   | `pnpm install`                             | exit 0     |
| Local DB  | `supabase start`, then `supabase db reset` | exit 0     |
| Full gate | `pnpm check && pnpm test && pnpm build`    | all exit 0 |

If local Supabase is unavailable, say so plainly and mark the SQL verifications
NOT RUN - do not claim them.

## Scope

**In scope**:

- NEW `supabase/migrations/<ts>_kid_pin_attempt_rpc.sql`
- NEW `supabase/migrations/<ts>_broadcast_missing_tables.sql`
- NEW `supabase/migrations/<ts>_notify_family_lists_only.sql`
- `supabase/functions/kid-auth/index.ts` (use the RPC)
- `src/hooks/useFamilyChannel.ts` (four map entries)
- Tests: `supabase/functions/kid-auth/` if a testable seam exists without
  restructuring; otherwise state why not

**Out of scope**: `manage-family-login` kid teardown (SEC-07), the
`update-user-email` reauth gate (SEC-03), `receipt-import` redirect validation
(SEC-05), JWT signature verification (SEC-06) - each is its own plan. Any
production deploy. The `profiles` RLS fix (that is plan 008).

## Git workflow

- Branch: `git checkout -b advisor/012-backend-hardening main`
- One commit per numbered defect (3 commits). English imperative. Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No push, no PR, no deploy.

## Steps

### Step 1: Atomic PIN attempt counter

Migration creating a `SECURITY DEFINER` function that does the read-modify-write
in ONE statement and returns the resulting state, following the style of
`kid_set_theme` (`20260808000000_kid_mode.sql:213-232`) - `SET search_path = ''`,
schema-qualified tables, a `COMMENT ON FUNCTION`:

```sql
CREATE OR REPLACE FUNCTION public.kid_register_pin_failure(
  p_profile_id UUID, p_max_attempts INT, p_lock_seconds INT
) RETURNS TABLE (failed_attempts SMALLINT, locked_until TIMESTAMPTZ)
```

Behavior it must implement in a single `UPDATE ... RETURNING`:

- increment `failed_attempts` by 1;
- when the incremented value reaches `p_max_attempts`, set `locked_until = now() + p_lock_seconds * interval '1 second'` and reset `failed_attempts` to 0 (matching today's semantics exactly);
- return the resulting row so the caller can decide the response.

Grant EXECUTE to whatever role the edge function uses (it calls with the service
role - confirm and grant accordingly; do NOT grant to `authenticated` or `anon`).

Then rewrite `gateOnPin` in `supabase/functions/kid-auth/index.ts` to call
`admin.rpc("kid_register_pin_failure", {...})` and branch on the returned row
instead of computing `attempts` in JS. Keep the response shapes, messages and
status codes byte-identical (`fail(lockedMessage(lockSeconds), "locked", 429, { retryAfterSeconds: lockSeconds })`).

**Verify**: `supabase db reset` exit 0. Then, locally, call the RPC twice
concurrently for the same profile and assert `failed_attempts` advanced by TWO
(that is the whole point). Report the actual numbers. Also verify the success
path still clears the counter.

### Step 2: The four missing broadcast triggers

Migration attaching `broadcast_family_change` to `receipts`, `receipt_items`,
`profiles`, `families`, reusing the array-loop pattern from
`20260729010000_family_broadcast_channel.sql:68-93` (including the
`to_regclass` guard).

Caution to check BEFORE writing it: read `broadcast_family_change`'s body and
confirm how it derives the family id. If it reads `NEW.family_id`, then
`families` (whose own key is `id`, not `family_id`) will NOT work with the same
function - in that case either handle `families` separately or leave `families`
out and say so in your report. Do not guess; read the function.

Then add the matching entries to `TABLE_INVALIDATIONS` in
`src/hooks/useFamilyChannel.ts`:

- `receipts` -> the receipt-context key AND the expenses key
- `receipt_items` -> the receipt items key (note it is keyed by expense id, so a
  family-less root key is the right shape - follow `paymentHistoryKey`)
- `profiles` -> `familyKey("family-members")` and `["profile"]`
- `families` -> whatever the family query key is (grep for it)

Match the existing comment style and keep the map alphabetical.

**Verify**: `supabase db reset` exit 0; `pnpm check && pnpm test && pnpm build`
exit 0. State in your report which key each table maps to and how you confirmed
the key strings (grep the hooks, do not guess).

### Step 3: Personal lists stop pushing

Migration replacing the list trigger with a scope-guarded one:

```sql
DROP TRIGGER IF EXISTS notify_on_list_create ON lists;
CREATE TRIGGER notify_on_list_create
  AFTER INSERT ON lists
  FOR EACH ROW WHEN (NEW.scope = 'family')
  EXECUTE FUNCTION notify_family_on_entity_create('list');
```

Belt and braces: in `supabase/functions/notify-on-create/index.ts`, when the
entity type is `list`, re-read the row and skip when `scope <> 'family'`. Keep
this cheap and fail-closed (if the re-read fails, do NOT send).

**Verify**: `supabase db reset` exit 0. Locally insert a personal list and
assert no notification work is planned/queued for it; insert a family list and
assert it still is. Report both observations.

### Step 4: Full gate

**Verify**: `pnpm check && pnpm test && pnpm build` all exit 0, unpiped.

## Test plan

- If `gateOnPin` can be tested by extracting it into a sibling module that takes
  an injected `admin` client (the file already parameterizes on `admin`), add
  `supabase/functions/kid-auth/gate.test.ts` covering: first failure increments;
  reaching the max sets `locked_until` and clears the counter; a live
  `locked_until` short-circuits BEFORE any hash comparison; success clears.
  Model the fake-client style on `src/hooks/__tests__/useSaveReceiptExpense.test.tsx`.
- If extraction would restructure the function significantly, do NOT force it -
  say so, and rely on the local RPC verification instead.
- No test should assert against real timers or the network.

## Done criteria

- [ ] `grep -n "failed_attempts: attempts" supabase/functions/kid-auth/index.ts` -> no hits (JS-computed absolute write is gone)
- [ ] Concurrent RPC check shows the counter advancing by 2, not 1
- [ ] The four tables appear in BOTH the trigger migration and `TABLE_INVALIDATIONS` (or a documented exception for `families`)
- [ ] The list trigger carries `WHEN (NEW.scope = 'family')` and the function re-checks
- [ ] `supabase db reset` applies cleanly
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0
- [ ] Nothing deployed

## STOP conditions

- Local Supabase unavailable -> complete what you can, report which
  verifications were NOT run, do not fabricate results.
- `broadcast_family_change` cannot serve `families` (see Step 2 caution) -
  handle or omit with a written reason; do not invent a second trigger function
  without saying so.
- Changing `gateOnPin` to the RPC would alter any response code or message -
  STOP; the client (`useKidLogin`) parses `code`/`attemptsLeft`/`retryAfterSeconds`.
- Adding triggers to `profiles` produces recursion or a visible slowdown in
  `db reset` - report.

## Maintenance notes

- New family-scoped tables need BOTH a trigger and a `TABLE_INVALIDATIONS`
  entry; the migration comment already says so, and this plan is evidence the
  reminder gets missed. Worth a review checklist line.
- Still open on the security side, each verified and each its own plan: kid
  credentials survive "Ugasi nalog" (SEC-07); `update-user-email` has no reauth
  and accepts kid sessions (SEC-03); `receipt-import` follows redirects off the
  allowlisted host (SEC-05); six functions trust an unverified JWT `sub`
  (SEC-06); Google connections freeze `family_id` at connect time (SEC-08).
- Deploying these three fixes needs the owner's explicit go-ahead; the DB
  changes are backward-compatible with the currently-deployed frontend.
