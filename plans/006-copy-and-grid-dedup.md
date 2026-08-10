# Plan 006: One pluralSr, one month table, one timed-range rule, one grid geometry

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. Touch only in-scope files. On any
> STOP condition, stop and report. Your reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- src/utils src/components/kid/kidCopy.ts src/components/family/KidAccessCopy.ts src/components/dashboard/agendaCalendarShared.tsx src/components/activities/WeekGrid.tsx`
> Plans 001-003 may have deleted a few exports in these files (expected);
> other changes to the excerpted regions are a STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (copy/tables), MED (grid geometry - pixel math)
- **Depends on**: plans/003-lint-ratchet.md (branch base); plan 001 already deleted `attemptsWord`/`formatTimeRange` from kidCopy - expect that
- **Category**: tech-debt
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

Three families of pure logic are maintained in multiple places and have
already drifted:

1. The Serbian paucal rule exists 3x (`serbianPlural`, and two `pluralSr`
   copies). Serbian month-name tables exist 3x (two lowercase, one
   capitalized).
2. "Which agenda item belongs on the clock and how long is an open-ended
   event" (`timedRange` vs `timelineRange`) is the same 3-branch function in
   two files, plus two `minutesToTime` variants with DIFFERENT contracts
   (clamp at 24:00 vs wrap past midnight) - callers get whichever their file
   imports.
3. The week-grid geometry (fit-to-content range, lane positioning, hour
   labels) is duplicated between the agenda calendars and the activities
   WeekGrid, and the copies already disagree: the shared version floors block
   height at 24px, the WeekGrid copy has no floor.

Consolidation is behavior-preserving: every current numeric behavior is kept
via parameters; no visual change is intended.

Conventions: Serbian UI strings, English comments, NO em/en dash - ASCII `-`.

## Current state

### A. Plural + month tables

- `src/utils/plural.ts:9-19` - `serbianPlural(count, { one, few, many })`
  (object forms). Also exports `stavkeLabel`, `placanjaLabel`.
- `src/components/kid/kidCopy.ts:56-64` - `pluralSr(n, one, few, many)`
  (positional), logically equivalent; used by `daysWord`, `classesWord`,
  `formatLockCountdown` etc. in the same file. kidCopy also holds
  `MONTHS_LONG` (lowercase, lines 17-32) and `MONTHS_SHORT` (34-45).
- `src/components/family/KidAccessCopy.ts:13-20` - second positional
  `pluralSr`, used by `deviceCountLabel` and countdown copy below it.
- `src/utils/pickerGrid.ts:10-23` - `MONTH_NAMES_SR` (lowercase) and
  `MONTH_SHORT_SR` (25-39) and `WEEKDAY_SHORT_SR` (41).
- `src/utils/budget.ts:19-32` - `MONTH_NAMES_SR` (Capitalized), consumed by
  `monthLabel`/`monthName`/`monthNameOfNumber` (lines 47-62).
- All three plural implementations and both month-table families have tests
  (`src/utils/__tests__/`, `src/components/kid/__tests__/kidCopy.test.ts`,
  family tests) - they pin current behavior and must keep passing unchanged.

### B. Timed-range twins

- `src/components/dashboard/agendaCalendarShared.tsx:51-77` - exported
  `minutesToTime` (CLAMPS: `Math.max(0, Math.min(24 * 60, min))`) and
  `timedRange(item)` (3 branches: activity block times; event when
  `!isAllDay && startTime` with `DEFAULT_EVENT_MINUTES = 60` fallback end;
  external with `normalizeTime`).
- `src/utils/dayTimeline.ts:14,35-67` - private `minutesToTime` (byte-identical
  clamping version), `DEFAULT_EVENT_MINUTES = 60`, exported `timelineRange`
  (same 3 branches; its own docblock at line 41 says it "Mirrors the agenda
  calendars' timedRange"). `dayTimeline` imports `normalizeTime, timeToMinutes`
  from `@/utils/activity`.
- Third variant, DIFFERENT contract (fine, keep): `src/utils/pickerGrid.ts:225-229`
  `minutesToTime` WRAPS past midnight (`((minutes % 1440) + 1440) % 1440`) -
  used by duration chips where 23:30 + 90min = 01:00 is correct. DO NOT merge
  the picker variant; just leave it.

### C. Grid geometry duplication

- Shared, exported from `src/components/dashboard/agendaCalendarShared.tsx`:
  constants at lines 20-26 (`SLOT_HEIGHT_PX = 40`, `SLOT_MINUTES = 30`,
  `DEFAULT_START_MIN = 7*60`, `DEFAULT_END_MIN = 21*60`,
  `GRID_TOP_PADDING_PX = 12`, `GRID_BOTTOM_PADDING_PX = 12`,
  `MIN_BLOCK_HEIGHT_PX = 24`), `computeRange` (99-114, fit-to-content with
  +-60min, half-hour aligned), `positionEntries` (145-159, lanes via
  `assignLanes` then `topPx`/`heightPx` with the MIN_BLOCK_HEIGHT floor),
  `buildHourLabels` (161-173), `gridHeightPx`, `expandRangeToNow` (116-138).
- Duplicated in `src/components/activities/WeekGrid.tsx`: constants at 40-47
  (`SLOT_HEIGHT_PX = 28`, same SLOT*MINUTES/DEFAULT*\*/GRID_TOP_PADDING_PX),
  `computeViewportRange` (77-104, same math as computeRange), inline
  positioning at 180-196 (same as positionEntries but NO height floor), inline
  hour labels at 199-209 (same as buildHourLabels). WeekGrid gets
  `timeToMinutes` and `assignLanes` from the same shared sources the dashboard
  uses (check its imports and mirror them).

## Commands you will need

| Purpose | Command        | Expected |
| ------- | -------------- | -------- |
| Install | `pnpm install` | exit 0   |
| Check   | `pnpm check`   | exit 0   |
| Tests   | `pnpm test`    | all pass |
| Build   | `pnpm build`   | exit 0   |

## Scope

**In scope**:

- `src/utils/plural.ts` (gains the positional overload), `src/components/kid/kidCopy.ts`, `src/components/family/KidAccessCopy.ts` (delegate)
- NEW `src/utils/serbianCalendar.ts` (month/weekday tables), `src/utils/pickerGrid.ts`, `src/utils/budget.ts`, kidCopy (consume it)
- `src/utils/dayTimeline.ts`, `src/components/dashboard/agendaCalendarShared.tsx` (timed-range unification)
- NEW `src/utils/timeGridGeometry.ts` (parameterized geometry) + `src/components/activities/WeekGrid.tsx` + `agendaCalendarShared.tsx` (consume it)
- Matching test files under `src/utils/__tests__/`

**Out of scope**: `pickerGrid.ts`'s wrapping `minutesToTime` (different
contract, stays); any VISUAL change (all current numbers preserved via
params); `src/utils/weekGridLayout.ts` lane algorithm (only consumed);
DayTimeline/AgendaWeekCalendar component JSX.

## Git workflow

- Branch: `git checkout -b advisor/006-copy-and-grid-dedup advisor/003-lint-ratchet` (STOP if base missing).
- One English imperative commit per section (A, B, C). Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No push, no PR.

## Steps

### Step 1: Single plural implementation

In `src/utils/plural.ts` add the positional form as a thin wrapper:

```ts
export function pluralSr(n: number, one: string, few: string, many: string): string {
  return serbianPlural(n, { one, few, many });
}
```

Then in `kidCopy.ts` and `KidAccessCopy.ts`: delete the local `pluralSr`
implementations and `import { pluralSr } from "@/utils/plural";` (keep their
re-export IF other modules import `pluralSr` from them - grep first; kid tests
import from kidCopy, so re-export there: `export { pluralSr } from "@/utils/plural";`).
Behavior check: the three implementations differ only in style, but VERIFY the
11-14 exception carefully - `kidCopy`'s version returns `many` for mod100
11-14 BEFORE the mod10 checks, `plural.ts` handles it inside each condition.
The existing tests on both sides are the referee: they must pass UNCHANGED.

**Verify**: `pnpm test -- plural` and `pnpm test -- kidCopy` and the family copy tests -> all pass with zero test-file edits; `grep -rn "function pluralSr" src` -> only the wrapper in plural.ts.

### Step 2: One month/weekday table module

Create `src/utils/serbianCalendar.ts` exporting `MONTHS_LONG_SR` (lowercase),
`MONTHS_SHORT_SR`, `WEEKDAY_SHORT_SR` - contents copied from
`pickerGrid.ts:10-41`. Consumers:

- `pickerGrid.ts`: re-export them under its existing names (public API kept:
  `MONTH_NAMES_SR`, `MONTH_SHORT_SR`, `WEEKDAY_SHORT_SR`), delete the inline
  tables.
- `kidCopy.ts`: delete `MONTHS_LONG`/`MONTHS_SHORT`, import from the new
  module (aliasing to the old local names is fine).
- `budget.ts`: delete its Capitalized table; derive in place:
  `const MONTH_NAMES_SR = MONTHS_LONG_SR.map((m) => m.charAt(0).toUpperCase() + m.slice(1));`
  (produces the identical 12 strings - its tests are the referee).

**Verify**: `pnpm test` -> all pass unchanged; `grep -rn '"januar"' src | grep -v serbianCalendar` -> no other lowercase table remains; `grep -rn '"Januar"' src` -> no hardcoded capitalized table.

### Step 3: One timed-range rule

Make `src/utils/dayTimeline.ts` the single home: keep its (already exported)
`timelineRange` and export `DEFAULT_EVENT_MINUTES` and the clamping
`minutesToTime` (rename export to `minutesToClampedTime` to avoid confusion
with pickerGrid's wrapping variant; update internal uses). Then in
`agendaCalendarShared.tsx`: delete its local `minutesToTime` + `timedRange` +
`DEFAULT_EVENT_MINUTES` and re-export `timelineRange as timedRange` (plus the
helpers) from `@/utils/dayTimeline` so its existing importers keep compiling.
Confirm the two deleted functions were truly identical to the kept ones
BEFORE deleting (read both; the excerpts above say they are - if you find any
difference beyond formatting, STOP).

**Verify**: `pnpm check && pnpm test && pnpm build` -> pass; `grep -rn "function timedRange\|function minutesToTime" src/components/dashboard` -> no local copies.

### Step 4: Parameterized grid geometry

Create `src/utils/timeGridGeometry.ts` with pure functions parameterized by a
config object `{ slotMinutes, slotHeightPx, gridTopPaddingPx, minBlockHeightPx, defaultStartMin, defaultEndMin }`:

- `computeRange(entries, cfg)` - port of `agendaCalendarShared.computeRange`
  (the WeekGrid copy is the same math).
- `positionSpans(lanedEntries, startMin, cfg)` - port of `positionEntries`'s
  top/height math, with the floor applied ONLY when `cfg.minBlockHeightPx > 0`.
- `buildHourLabels(startMin, endMin, cfg)` - port of the shared version.

Adopt in `agendaCalendarShared.tsx` with cfg
`{ slotMinutes: 30, slotHeightPx: 40, gridTopPaddingPx: 12, minBlockHeightPx: 24, defaultStartMin: 420, defaultEndMin: 1260 }`
(keeping its exported constant names and function signatures IDENTICAL for
its consumers - they wrap the new module), and in `WeekGrid.tsx` with
`{ ...same, slotHeightPx: 28, minBlockHeightPx: 0 }` replacing
`computeViewportRange` and the two inline blocks. `expandRangeToNow` and
`gridHeightPx` may move too (same parameterization) or stay - move only if it
keeps `agendaCalendarShared`'s public surface unchanged.

Add `src/utils/__tests__/timeGridGeometry.test.ts` (model on an existing
utils test): empty entries -> default window; range rounding to half-hour;
position math for a known entry at both slot heights; floor applied at
minBlockHeightPx 24 and NOT at 0; hour label positions for a known range.

**Verify**: `pnpm test -- timeGridGeometry` -> new tests pass; full `pnpm check && pnpm test && pnpm build` -> pass. Behavior-preservation spot check: `grep -n "SLOT_HEIGHT_PX = 28" src/components/activities/WeekGrid.tsx` -> still 28 (constants stay local or in cfg, value unchanged).

## Done criteria

- [ ] `grep -rn "function pluralSr" src` -> 1 hit (plural.ts wrapper)
- [ ] One lowercase month table in the repo (serbianCalendar.ts)
- [ ] `grep -rn "function timedRange" src` -> 0 local copies (re-export only)
- [ ] WeekGrid contains no local `computeViewportRange` / inline position math
- [ ] All existing tests pass WITHOUT modification (they pin behavior)
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0; only in-scope files changed

## STOP conditions

- Base branch missing.
- Any "identical" pair turns out to differ in behavior (not formatting) when
  you read it - report the difference instead of picking a winner.
- An existing test fails after a consolidation step - that means behavior
  changed; revert the step and report (do NOT edit the test).
- The geometry adoption requires touching component JSX beyond swapping the
  math calls.

## Maintenance notes

- pickerGrid's wrapping `minutesToTime` intentionally survives as the only
  OTHER time formatter; its doc comment already explains the midnight-wrap
  contract. If someone later unifies them, the two contracts must become two
  named functions, not one.
- The min-height floor question (should short blocks in WeekGrid get the 24px
  floor too?) is deliberately NOT answered here - behavior preserved. If
  design wants it, it is now a one-line cfg change.
- The agenda `timedRange`/`timelineRange` re-export keeps dashboard imports
  stable; a later pass (agenda folder move, batch D) can flatten the
  re-exports.
