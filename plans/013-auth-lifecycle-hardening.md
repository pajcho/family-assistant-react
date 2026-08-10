# Plan 013: Gate the email change (reauth + no kid sessions) and tear down kid credentials when a login is disabled

> **Executor instructions**: Follow step by step, verify each step, touch only
> in-scope files, STOP rather than improvise. Your reviewer maintains
> `plans/README.md`. Run final verifications UNPIPED.
>
> **NO PRODUCTION DEPLOY.** Edge functions are edited here but never deployed.
> Never run `supabase functions deploy`, `supabase db push`, or `supabase link`.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- supabase/functions/update-user-email supabase/functions/manage-family-login supabase/functions/kid-access src/components/settings/ProfileSection.tsx`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (auth flows; an over-tight gate locks a parent out of their own email change)
- **Depends on**: none (branch from `main`; independent of 001-012)
- **Category**: security
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

Two verified defects in the account-lifecycle surface:

1. **The email change is unguarded (SEC-03).** `update-user-email` takes the
   caller from the JWT `sub` and calls
   `admin.auth.admin.updateUserById(userId, { email, email_confirm: true })` -
   no reauthentication, the new address is marked verified immediately, and the
   OLD address is never notified. Anyone with a live session (a borrowed
   unlocked phone, a lifted token) can move the account to an address they
   control and then take it over through the ordinary password-reset flow. The
   password-change path in the same app DOES reauthenticate
   (`src/components/settings/PasswordCard.tsx:67-71` re-verifies via
   `createSessionlessClient().auth.signInWithPassword`), so the asymmetry looks
   accidental rather than decided.
   Second, sharper edge: a KID session carries a valid JWT with a `sub`, so it
   can call this function and rewrite exactly the address that
   `kid_access.login_email` points at. Both `kid-access` and `kid-auth` locate
   the child's auth user through that email and abort when the ids disagree
   (`kid-access/index.ts:426-432`, `kid-auth/index.ts:405-413`), so afterwards
   the parent's device-removal control fails closed forever and the child's own logins
   break - the revocation control a parent depends on stops working.

2. **"Ugasi nalog" leaves a working kid credential (SEC-07).**
   `manage-family-login`'s `disableLogin` (`:134-172`) deletes the member's real
   auth user, re-homes their lists and clears `is_admin`, but never touches
   `kid_access` / `kid_devices` / `kid_invites` and never ends live kid sessions.
   A member with kid mode enabled keeps signing in with device token + PIN. The
   mirror-image guard already exists on the other side (`kid-access/index.ts:161-164`
   refuses to enable kid mode for a member who has a login), so the invariant is
   intended - it is just enforced in one direction only.

Conventions: Serbian user-visible strings, English code comments, NO em dash /
en dash / Unicode minus - ASCII `-` only.

## Current state

**`supabase/functions/update-user-email/index.ts`**

- `:40-48` - a comment explaining why `auth.getUser()` is NOT used here (the
  service-role apikey is rejected by asymmetric-key GoTrue). Read it before
  changing anything; the chosen fix must respect that constraint.
- `:49-51` - caller id taken from the JWT `sub`, unverified beyond the platform
  gate.
- `:80-95` - a `listUsers` pagination scan used to detect an address already in
  use (also an existence oracle; out of scope here, note only).
- `:100-103` - `updateUserById(userId, { email, email_confirm: true })`.
- Client: `src/components/settings/ProfileSection.tsx:64-77` invokes it on form
  submit with no password step.
- Kid JWTs carry kid claims set at `supabase/functions/kid-access/index.ts:184` -
  read that line to learn the exact claim shape (`app_metadata.kid` or similar);
  do not assume the key name.

**`supabase/functions/manage-family-login/index.ts`**

- `:74-89` - admin + same-family authorization (correct, keep).
- `:107-110` - `createLogin` refuses only when the profile id already exists in
  `auth.users`; a kid's synthetic user has a DIFFERENT id
  (`supabase/migrations/20260808000000_kid_mode.sql:13-17`), so it passes.
- `:134-172` - `disableLogin`, the path missing the kid teardown.
- `:141-158` - self-disable and last-admin guards (keep them exactly).

**`supabase/functions/kid-access/index.ts`**

- `:382-420` - `endKidSessions`, with a long comment establishing that deleting
  a row does NOT end a live kid session; only the auth-user delete or a global
  sign-out does. This is the routine to reuse.
- Its `disable` action is the reference implementation of a full teardown -
  read it and mirror its ORDER (sessions ended before rows are deleted).

## Commands you will need

| Purpose   | Command                                 | Expected   |
| --------- | --------------------------------------- | ---------- |
| Install   | `pnpm install`                          | exit 0     |
| Full gate | `pnpm check && pnpm test && pnpm build` | all exit 0 |

Edge functions are Deno and are not exercised by `pnpm test` unless a sibling
`*.test.ts` exists; `pnpm check` DOES lint them.

## Scope

**In scope**:

- `supabase/functions/update-user-email/index.ts`
- `supabase/functions/manage-family-login/index.ts`
- `supabase/functions/_shared/` (a new module if you lift the kid teardown)
- `supabase/functions/kid-access/index.ts` (ONLY to extract/reuse the teardown - no behavior change there)
- `src/components/settings/ProfileSection.tsx` (the reauth step in the UI)
- Tests alongside the functions if a seam exists

**Out of scope**: SEC-05 (receipt-import redirects), SEC-06 (local JWT
signature verification), SEC-08 (frozen `family_id`) - separate plans. The
`listUsers` existence oracle. Any production deploy. Plan 008's RLS migration.

## Git workflow

- Branch: `git checkout -b advisor/013-auth-lifecycle-hardening main`
- Two commits (one per defect). English imperative. Trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No push, no PR, no deploy.

## Steps

### Step 1: Refuse kid sessions in `update-user-email`

Read `kid-access/index.ts:184` to learn the exact claim the kid session carries,
then in `update-user-email` reject such callers with 403 and a Serbian message
(the Serbian copy for "a kid account cannot change its email"). Place the check immediately
after the caller id is read, before any `listUsers` or update work.

**Verify**: `pnpm check` exit 0. In your report, quote the claim key you found
and the line you read it from - do not paraphrase.

### Step 2: Require proof of recent authentication

The client must prove the user knows the current password, and the function must
require that proof. Follow the existing pattern in
`src/components/settings/PasswordCard.tsx:67-71`: it calls
`createSessionlessClient().auth.signInWithPassword(...)` to verify without
disturbing the live session.

Implementation shape (pick the simpler one that works with this project's GoTrue
setup, and say which you chose and why):

- **(a) Fresh-token proof**: the client re-verifies the password on a sessionless
  client, takes the freshly-issued access token, and passes it to the function
  in the request body (NOT as the Authorization header). The function verifies
  that this token belongs to the same `sub` as the caller and was issued
  recently (small `iat`/`auth_time` window, e.g. 5 minutes).
- **(b) Claim check**: if the project's JWTs carry `aal`/`auth_time`, require a
  recent `auth_time` on the caller's own token and have the client refresh the
  session by re-signing-in first.

Client side: add the password step to `ProfileSection.tsx`'s email-change flow,
matching `PasswordCard`'s field/labels/error conventions. Serbian copy;
`Odustani` for dismissal per repo label rules.

Keep `email_confirm: true` (mail delivery may not be configured), but add a note
in the code that the previous address is not notified - a follow-up.

**Verify**: `pnpm check && pnpm test && pnpm build` all exit 0. Manually reason
through and REPORT: what happens when the password is wrong (no email change,
clear Serbian error), and when the proof is stale.

### Step 3: Tear down kid credentials on disable

Lift `kid-access`'s teardown into `supabase/functions/_shared/` as a function
taking the admin client and a profile id, doing exactly what `kid-access`'s
`disable` does today in the same order (end sessions, then invites, devices,
row, synthetic auth user). Have BOTH `kid-access` and
`manage-family-login`'s `disableLogin` call it, so the two cannot drift again.

Also close the reverse gap: in `createLogin`, refuse when a `kid_access` row
exists for that profile, with a Serbian message telling the admin to turn kid
mode off first (mirror the wording style of `kid-access/index.ts:161-164`).

**Verify**: `pnpm check` exit 0. Report how you confirmed `kid-access`'s own
`disable` behavior is unchanged after the extraction (read the diff; the
extracted body must be identical).

### Step 4: Full gate

**Verify**: `pnpm check && pnpm test && pnpm build` all exit 0, unpiped.

## Test plan

- If `disableLogin` and the extracted teardown can take an injected admin client
  (the functions already parameterize on one), add a test asserting the teardown
  is invoked and in the right order, modeled on the fake-client style in
  `src/hooks/__tests__/useSaveReceiptExpense.test.tsx`.
- Test the kid-claim rejection as a pure predicate if you can extract it.
- If neither is testable without restructuring, say so plainly instead of
  writing a test that asserts nothing.

## Done criteria

- [ ] A kid-session caller is rejected by `update-user-email` before any write
- [ ] The email change requires a password proof end to end (UI + function)
- [ ] `disableLogin` and `kid-access`'s disable call ONE shared teardown
- [ ] `createLogin` refuses when kid mode is enabled for that profile
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0
- [ ] Nothing deployed

## STOP conditions

- Neither reauth shape works with this project's GoTrue configuration - report
  what you observed; do NOT ship the email change ungated as a fallback.
- Extracting the teardown would change `kid-access`'s current behavior in any
  way - STOP; the extraction must be behavior-identical.
- The kid claim is not actually present on kid JWTs (i.e. you cannot distinguish
  a kid caller) - STOP and report; the whole Step 1 premise depends on it.
- `manage-family-login`'s existing self-disable / last-admin guards would have
  to move - leave them alone and report.

## Maintenance notes

- Still open after this, all verified: `receipt-import` follows redirects off
  its allowlisted host (SEC-05); six functions trust an unverified JWT `sub`
  because only `config.toml` gates them (SEC-06); `google_connections.family_id`
  is frozen at connect time (SEC-08); `update-user-email`'s `listUsers` scan is
  an address-existence oracle.
- The "old address is not notified" gap remains; if mail delivery is configured
  later, that notification is the cheapest remaining hardening.
