# Plan 009: Characterization + parity tests for payment recurrence (pin today's behavior, prove the divergence)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. Touch only in-scope files. On any STOP
> condition, stop and report. Your reviewer maintains `plans/README.md`.
> Run final verification commands UNPIPED so exit codes are real.
>
> **This plan adds ONLY tests. It must not change a single line of non-test
> code.** If you believe a source fix is needed, that is plan 010's job - note
> it and move on.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- src/utils/payment.ts src/utils/date.ts src/components/payments/PaymentsPage.tsx`
> `src/utils/date.ts` was touched by plan 001 (dead exports removed) - that is
> expected. Any change to the FUNCTIONS excerpted below is a STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (tests only)
- **Depends on**: plans/005 (branch base - shares PaymentsPage)
- **Category**: tests
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

The app has TWO independent payment-recurrence engines and they disagree. The
disagreement is invisible today because neither is tested and no test compares
them. Before anyone changes either one (plan 010), the current behavior must be
written down in executable form - otherwise a "fix" silently changes numbers on
screens nobody checked.

The three known divergences, all verified in code at f46bc51:

1. **Month-end drift.** `expandPaymentOccurrences` chains `addMonth` on its own
   clamped output, so a Jan-31 monthly yields `01-31, 02-28, 03-28, 04-28…` -
   the day is permanently lost. `PaymentsPage` re-derives each month from the
   original due date via `getDueDateInMonth`, yielding `01-31, 02-28, 03-31`.
2. **Override key mismatch (the money-visible one).** Overrides are keyed
   `overrideKey(payment.id, occurrenceDate)`. A cancel saved from the Payments
   page writes `occurrence_date = 2026-03-31`; the agenda and the budget
   projection look up `2026-03-28` and miss it - so a canceled instalment still
   shows on the dashboard and still counts as unpaid.
3. **Weekly rewind past series start.** `getWeeklyOccurrencesInMonth` rewinds
   with `subtractWeek` until it is at or before the requested month, with NO
   floor at the series' own start date, so it can emit an occurrence BEFORE the
   payment exists. `expandPaymentOccurrences` walks forward only and emits
   nothing.

None of the four `date.ts` helpers that drive the entire Payments page has a
single test today.

Conventions: Serbian user-visible strings, English code comments, NO em dash /
en dash / Unicode minus anywhere - ASCII `-` only.

## Current state

**Engine A** - `src/utils/payment.ts`, `expandPaymentOccurrences(payment, from, to, overridesByKey)`.
Consumers: `useAgenda`, `useOverduePayments`, `src/utils/budget.ts`. Its walk:

```ts
const step = (date: string): string | null => {
  if (period === "weekly") return addWeek(date, interval);
  if (period === "monthly") return addMonth(date, interval);
  if (period === "limited") return addMonth(date); // monthly cadence; interval ignored
  return null; // one-time / null
};
let cur: string | null = payment.due_date;
while (cur !== null && cur <= to && remaining > 0) {
  const ov = overridesByKey.get(overrideKey(payment.id, cur));
  if (ov?.action !== "cancel") {
    const effectiveDate = ov?.action === "reschedule" && ov.override_date ? ov.override_date : cur;
    if (effectiveDate >= from && effectiveDate <= to)
      out.push({ occurrenceDate: cur, effectiveDate });
  }
  remaining -= 1;
  cur = step(cur);
}
```

Existing coverage: 10 tests in `src/utils/__tests__/agenda.test.ts:75-198` (none
covering month-end).

**Engine B** - four helpers in `src/utils/date.ts`, consumed by
`src/components/payments/PaymentsPage.tsx` (imports at `:34-37`, used at
`:137,151,156,290`). Zero tests. Signatures:

- `getDueDateInMonth(monthYYYYMM, dueDateStr)` - same calendar day in a given
  month, capped to that month's last day. Re-derives from the ORIGINAL due
  date, so it does not drift.
- `getLimitedMonths(dueDateStr, remaining)` - `remaining` months of `YYYY-MM`
  starting at the due-date month, stepping with `addMonth` (note: this one
  chains, so it inherits drift in the month LIST only, not the day).
- `isMonthlyOccurrenceMonth(dueDateStr, monthYYYYMM, interval)` - month-diff
  modulo interval; false for months before the due date.
- `getWeeklyOccurrencesInMonth(dueDateStr, monthYYYYMM, interval)` - rewinds
  while `current > monthEnd`, then forwards while `current < monthStart`, then
  collects while `current <= monthEnd`. No series-start floor.

**The clamping primitive** - `src/utils/date.ts` `addMonth(dateStr, count = 1)`:
computes `addMonths`, then `Math.min(day, lastDayOfTargetMonth)` and returns the
CLAMPED date. `subtractMonth` mirrors it.

Test conventions to match: pure-util tests live in `src/utils/__tests__/*.test.ts`,
plain vitest (`describe`/`it`/`expect`), no mocks needed, no Supabase import.
Read `src/utils/__tests__/budget.test.ts` first and match its structure and
comment style.

## Commands you will need

| Purpose        | Command                                               | Expected   |
| -------------- | ----------------------------------------------------- | ---------- |
| Install        | `pnpm install`                                        | exit 0     |
| Targeted tests | `pnpm test -- date` / `pnpm test -- recurrenceParity` | pass       |
| Full gate      | `pnpm check && pnpm test && pnpm build`               | all exit 0 |

## Scope

**In scope** (create only):

- `src/utils/__tests__/date.test.ts` (NEW - or extend `utils.test.ts` if it
  already covers `date.ts`; read it first and pick ONE home, do not split)
- `src/utils/__tests__/recurrenceParity.test.ts` (NEW)

**Out of scope**: every non-test file. Especially `src/utils/date.ts`,
`src/utils/payment.ts`, `src/components/payments/PaymentsPage.tsx` - do NOT fix
anything you discover; plan 010 does that.

## Git workflow

- Branch: `git checkout -b advisor/009-payment-recurrence-tests advisor/005-ux-drift-pack` (STOP if base missing).
- Serbian imperative commit, e.g. `Testovi za ponavljanje placanja: fiksiraj trenutno ponasanje i dokumentuj razlaz`. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No push, no PR.

## Steps

### Step 1: Cover the four `date.ts` helpers

Write tests asserting CURRENT behavior (run the function, observe, assert what
it actually does - do not assert what you think it should do):

`getDueDateInMonth`:

- `("2026-03", "2026-01-31")` -> `"2026-03-31"` (no drift - this is the correct one)
- `("2026-02", "2026-01-31")` -> `"2026-02-28"` (clamped)
- `("2028-02", "2026-01-31")` -> leap year, expect `"2028-02-29"`
- a mid-month day passes through unchanged

`getLimitedMonths`:

- `("2026-01-31", 3)` -> assert the exact array; note in a comment whether the
  month list is affected by `addMonth` chaining
- `remaining` of 0 and 1
- a series crossing a year boundary

`isMonthlyOccurrenceMonth`:

- interval 1: due month true, next month true, previous month false
- interval 3 (quarterly) from `2026-04`: Apr true, May/Jun false, Jul true
- interval 0 and negative (the `Math.max(1, ...)` guard)

`getWeeklyOccurrencesInMonth`:

- weekly (interval 1) due `2026-08-05`, month `2026-08` -> the August dates
- interval 2, same month -> every other week
- **the rewind case**: due `2026-08-05`, month `2026-07` -> assert EXACTLY what
  it returns today (it walks backwards past the series start). Add a comment
  marking this as a divergence pinned by plan 009, to be resolved in plan 010.
- a month with no occurrence

**Verify**: `pnpm test -- date` -> all new tests pass.

### Step 2: The parity test (the real deliverable)

`src/utils/__tests__/recurrenceParity.test.ts`. For a shared set of payment
fixtures, compute the occurrence dates BOTH ways for the same month and compare:

- Engine A: `expandPaymentOccurrences(payment, monthStart, monthEnd, new Map())`
  -> map to `occurrenceDate`.
- Engine B: replicate exactly what `PaymentsPage` does for that period - read
  `PaymentsPage.tsx:130-170` and mirror the branch (`weekly` ->
  `getWeeklyOccurrencesInMonth`; `monthly` -> `isMonthlyOccurrenceMonth` +
  `getDueDateInMonth`; `limited` -> `getLimitedMonths` + `getDueDateInMonth`).
  Put that mirror in a small local helper inside the test file and comment that
  it is a copy of the page's logic, to be deleted when plan 010 unifies them.

Fixtures (at minimum):

1. monthly, due `2026-01-15` - EXPECTED TO AGREE (regression guard for the
   common case).
2. monthly, due `2026-01-31`, checked for March 2026 - EXPECTED TO DISAGREE
   (A says 03-28, B says 03-31).
3. monthly interval 3, due `2026-04-10`, checked for July.
4. weekly, due `2026-08-05`, checked for July 2026 - EXPECTED TO DISAGREE
   (A empty, B emits a pre-series date).
5. limited with `remaining_occurrences: 3`, due `2026-01-31`.

**Assert the disagreements explicitly**, e.g.
`expect(engineA).not.toEqual(engineB)` with a comment naming the divergence and
pointing at plan 010. A test that documents a known defect is a valid test - do
NOT write `expect(...).toEqual(...)` and then loosen it until it passes.

Also add ONE test that demonstrates the override consequence concretely: build
an `overridesByKey` map with a `cancel` at engine B's date (`2026-03-31`), run
engine A for March, and assert the occurrence is STILL returned (i.e. the
cancel is missed). That is the user-visible bug in one assertion.

**Verify**: `pnpm test -- recurrenceParity` -> passes (with the divergences
asserted as divergences).

### Step 3: Full gate

**Verify**: `pnpm check && pnpm test && pnpm build` -> all exit 0, unpiped.

## Done criteria

- [ ] All four `date.ts` recurrence helpers have direct tests
- [ ] `recurrenceParity.test.ts` exists, covers the 5 fixtures, and asserts both
      the agreeing and the disagreeing cases
- [ ] The override-miss scenario is asserted in one test
- [ ] `git diff --name-only <base>..HEAD` lists ONLY files under `__tests__`
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0

## STOP conditions

- Base branch `advisor/005-ux-drift-pack` missing.
- A divergence the plan predicts does NOT reproduce (e.g. engine A does not
  drift). Report the actual outputs - the premise of plan 010 depends on this,
  so a wrong premise must surface here, not later.
- You find a THIRD engine or another consumer computing occurrence dates
  independently - report where.
- You cannot mirror the PaymentsPage branch without importing the component
  (which would drag in Supabase) - report; do not import it.

## Maintenance notes

- These tests are deliberately written against current behavior including its
  defects. Plan 010 will CHANGE several of these assertions - that is the point:
  the diff in this test file is the reviewable record of what plan 010 changed
  about the numbers users see.
- The local mirror of PaymentsPage's branch in the parity test is temporary
  duplication with a purpose; it dies when 010 lands.
