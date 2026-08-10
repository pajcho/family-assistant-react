# Plan 010: One payment recurrence engine, anchored so month-end due dates stop drifting

> **Executor instructions**: Follow step by step, verify each step, touch only
> in-scope files, STOP rather than improvise. Your reviewer maintains
> `plans/README.md`. Run final verifications UNPIPED.
>
> **This plan changes money math.** Numbers on the Payments page, the budget
> projection and the dashboard will move. That is intended - but only in the
> ways this plan names. Any OTHER number that moves is a STOP condition.
>
> **No production deploy.** This plan writes a DB migration; it must be applied
> LOCALLY only. Never run `supabase db push` or `supabase functions deploy`.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- src/utils/payment.ts src/utils/date.ts src/hooks/usePayments.ts src/components/payments/PaymentsPage.tsx`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH (money math + a persisted anchor + existing override rows)
- **Depends on**: plans/009-payment-recurrence-tests.md (MUST be DONE - it is the safety net)
- **Category**: bug
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

Three defects, one root cause - the recurrence walk clamps and then re-anchors
on its own clamped output:

1. A monthly payment due on the 29th/30th/31st permanently loses its day after
   the first February: `addMonth("2026-01-31")` -> `2026-02-28`, and the next
   step anchors on the 28th forever. The user's stated due day is silently
   rewritten, reminders fire early every month after, and undo cannot recover it
   (`subtractMonth("2026-02-28")` -> `2026-01-28`).
2. Because the Payments page uses a DIFFERENT, non-drifting derivation, the two
   surfaces disagree about the same bill's dates - and overrides keyed on the
   occurrence date written by one surface are invisible to the other. A canceled
   instalment keeps showing on the dashboard and keeps counting as unpaid.
3. `getWeeklyOccurrencesInMonth` can emit an occurrence dated BEFORE the series
   started.

Plan 009 has already pinned all of this in executable form. This plan makes the
two engines one, anchored on a day-of-month that survives every advance.

Conventions: Serbian user-visible strings, English code comments, NO em dash /
en dash / Unicode minus - ASCII `-` only. Migrations use ASCII-only Serbian
comments (no diacritics) - match the surrounding files.

## Current state

Read plan 009's "Current state" for both engines' code - it is accurate and not
repeated here. Additionally, the DB anchor itself is advanced by chaining, in
`src/hooks/usePayments.ts`:

- `:434` mark-paid: `due_date: addMonth(row.due_date, interval)`
- `:469` limited branch, `:554` and `:574` cancel-occurrence: same shape
- `:704` undo: `subtractMonth(...)`, which cannot restore a clamped day

`payments` table columns relevant here (from
`supabase/migrations/20260130000000_initial_schema.sql` plus later ALTERs):
`due_date DATE`, `recurrence_period TEXT` (`one-time` | `monthly` | `weekly` |
`limited`), `recurrence_interval INT`, `remaining_occurrences INT`,
`is_paid`, `is_paused`.

`payment_overrides` rows key on `(payment_id, occurrence_date)` - see
`overrideKey` in `src/utils/payment.ts:122`. Existing rows were written with
whatever date the writing surface computed, so some may be keyed on drifted
dates.

## Commands you will need

| Purpose   | Command                                   | Expected   |
| --------- | ----------------------------------------- | ---------- |
| Install   | `pnpm install`                            | exit 0     |
| Local DB  | `supabase start` then `supabase db reset` | exit 0     |
| Tests     | `pnpm test`                               | all pass   |
| Full gate | `pnpm check && pnpm test && pnpm build`   | all exit 0 |

## Scope

**In scope**:

- `supabase/migrations/<timestamp>_payments_due_anchor_day.sql` (NEW)
- `src/utils/payment.ts` (the unified engine)
- `src/utils/date.ts` (anchor-aware helpers; keep existing exports working)
- `src/components/payments/PaymentsPage.tsx` (consume the unified engine)
- `src/hooks/usePayments.ts` (advance without drift)
- `src/types/database.ts` (the new column)
- Test files under `src/utils/__tests__/` (update 009's assertions)

**Out of scope**: `src/utils/budget.ts` and `src/hooks/useAgenda.ts` - they
consume `expandPaymentOccurrences` and must keep working WITHOUT changes (that
is the proof the unification is source-compatible); the digest edge function
(`supabase/functions/send-due-pushes/plan.ts` has its own walk - note it in your
report, do NOT change it here); any production deploy.

## Git workflow

- Branch: `git checkout -b advisor/010-payment-recurrence-unify advisor/009-payment-recurrence-tests` (STOP if base missing).
- One commit per step. English imperative. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No push, no PR, no deploy.

## Steps

### Step 1: Add the anchor column

Migration (timestamp after the newest existing one):

```sql
-- The day of the month the payment was originally set to. Without it the
-- monthly due date is lost for good: addMonth(2026-01-31) returns 2026-02-28,
-- so the next step counts from the 28th and the series stays there forever.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS due_anchor_day SMALLINT;

UPDATE payments SET due_anchor_day = EXTRACT(DAY FROM due_date)::SMALLINT
  WHERE due_anchor_day IS NULL;

ALTER TABLE payments ADD CONSTRAINT payments_due_anchor_day_range
  CHECK (due_anchor_day IS NULL OR (due_anchor_day >= 1 AND due_anchor_day <= 31));
```

Backfill honesty: for series that ALREADY drifted, `EXTRACT(DAY FROM due_date)`
recovers the drifted day (28), not the original 31 - the original is not
reliably recoverable and guessing it from `payment_history` risks inflating the
anchor from a legitimate reschedule. So: drift stops here, past drift is not
retroactively undone. Say exactly this in the migration comment. Do NOT attempt
a history-based backfill.

**Verify**: `supabase db reset` -> exit 0.

### Step 2: Anchor-aware stepping in `date.ts`

Add (do not remove any existing export - `getDueDateInMonth` stays and is
reused):

```ts
/** Next monthly occurrence, anchored: derives the day from `anchorDay`, not
 *  from the previous (possibly clamped) result, so a 31st never becomes a 28th
 *  permanently. */
export function addMonthAnchored(dateStr: string, anchorDay: number, count = 1): string;
```

Implement by advancing the MONTH from `dateStr` and then taking
`min(anchorDay, lastDayOfThatMonth)` - i.e. the same rule `getDueDateInMonth`
already implements correctly. Where `anchorDay` is missing/invalid, fall back to
the day of `dateStr` (behaves exactly like today's `addMonth`).

**Verify**: add unit tests - `addMonthAnchored("2026-01-31", 31)` -> `2026-02-28`;
then `addMonthAnchored("2026-02-28", 31)` -> `2026-03-31` (the fix in one
assertion). `pnpm test -- date` passes.

### Step 3: One engine

In `src/utils/payment.ts`, make `expandPaymentOccurrences` anchor-aware:
accept `due_anchor_day` on the payment `Pick<>` and use `addMonthAnchored` for
the `monthly`/`limited` steps. Weekly stepping is unchanged (weeks never clamp).

Then export ONE function the Payments page can use for its month view, built on
the same walk - e.g.
`paymentOccurrencesInMonth(payment, monthYYYYMM, overridesByKey)` implemented by
calling the shared walk with that month's first/last day. It must return the
same `{ occurrenceDate, effectiveDate }` shape.

Weekly floor: the shared walk starts at `due_date` and only moves forward, which
inherently fixes divergence 3 (no pre-series occurrences). Confirm this in a
test rather than assuming.

**Verify**: `pnpm test -- recurrenceParity` - the tests plan 009 wrote will now
FAIL where they asserted divergence. Update those assertions to
`toEqual`, and delete the local PaymentsPage mirror helper 009 added, replacing
it with a call to the new shared function. Every changed assertion must be
justified in the commit message.

### Step 4: PaymentsPage consumes the engine

Replace the `getWeeklyOccurrencesInMonth` / `isMonthlyOccurrenceMonth` /
`getLimitedMonths` + `getDueDateInMonth` branch in
`PaymentsPage.tsx` (`computeSummary` ~`:130-170` and `computeCombinedList`
~`:280-300`) with calls to `paymentOccurrencesInMonth`. Keep every OTHER rule
of those functions exactly as it is (history dedupe, paid/paused skips, the
`selectedMonth >= currentMonth` gate, synthetic row ids, sorting).

If the four `date.ts` helpers end up with no consumers after this, leave them
exported and add a one-line comment that they are superseded - deleting them is
a separate cleanup, and plan 009's tests still cover them.

**Verify**: `pnpm check && pnpm test && pnpm build` all exit 0.

### Step 5: Stop the DB anchor from drifting

In `src/hooks/usePayments.ts`, replace `addMonth(row.due_date, interval)` at
`:434`, `:469`, `:554`, `:574` with `addMonthAnchored(row.due_date, row.due_anchor_day ?? <day of due_date>, interval)`.
For undo (`:704`), the symmetric `subtractMonth` must likewise re-derive from
the anchor. Every fetch of a payment row that feeds these must select the new
column (check the `select(...)` calls - several use `select("*")`, which is
fine).

Add `due_anchor_day: number | null` to the `Payment` interface in
`src/types/database.ts` with a JSDoc line explaining what it is for.

Creation path: when a payment is created, `due_anchor_day` must be set from the
chosen due date. Find the create mutation and set it explicitly rather than
relying on a DB default.

**Verify**: `pnpm check && pnpm test && pnpm build` exit 0. Then a local DB
check: insert a monthly payment due `2026-01-31`, run mark-paid twice, and
assert `due_date` goes `2026-01-31 -> 2026-02-28 -> 2026-03-31` (NOT `03-28`).
Report the actual values.

### Step 6: Regression sweep

Re-read plan 009's tests. Every assertion that changed must be a change this
plan intends. List them in your report with one line each.

**Verify**: `pnpm check && pnpm test && pnpm build` all exit 0, unpiped.

## Test plan

- Extend `src/utils/__tests__/date.test.ts` for `addMonthAnchored` (the two-step
  31 -> 28 -> 31 case is the key one).
- Convert `recurrenceParity.test.ts` from "asserts divergence" to "asserts
  agreement" for all 5 fixtures, plus keep the override-miss scenario, now
  asserting the cancel IS honored.
- Add: a limited series' instalment count is unchanged by anchoring; a weekly
  series produces no occurrence before `due_date`.

## Done criteria

- [ ] `grep -rn "getWeeklyOccurrencesInMonth\|isMonthlyOccurrenceMonth" src/components` -> no hits (page uses the shared engine)
- [ ] All 5 parity fixtures now assert agreement between the two call paths
- [ ] Local DB check in Step 5 shows `2026-03-31`, not `2026-03-28`
- [ ] `src/utils/budget.ts` and `src/hooks/useAgenda.ts` are UNCHANGED
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0
- [ ] Nothing deployed

## STOP conditions

- Plan 009 is not DONE, or its tests do not pass on your base branch.
- Local Supabase unavailable -> you can still do Steps 2-4 and 6; STOP before
  Step 1/5 verification and report which checks were NOT run.
- Making the engines agree requires changing `budget.ts` or `useAgenda.ts` -
  that means the shape is not source-compatible; STOP and report.
- You discover existing `payment_overrides` rows in the local DB whose
  `occurrence_date` matches NEITHER engine - report before touching data. This
  plan does NOT migrate override rows; if that turns out to be required, it is
  a separate plan and a separate decision.
- Any test outside the recurrence area starts failing.

## Maintenance notes

- The digest edge function (`supabase/functions/send-due-pushes/plan.ts`) has a
  THIRD occurrence walk. It was deliberately left alone here. It should be
  reconciled next; until then, a month-end payment can still be announced by
  push on a date the app shows differently. Flag this to the reviewer.
- Past drift is not undone (see Step 1). If the owner wants historical repair,
  it needs a data migration decided with real production data in front of them.
- After this lands, the four superseded `date.ts` helpers are dead weight; a
  follow-up can delete them with plan 009's tests as the guard.
