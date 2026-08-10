# Plan 001: Remove verified dead code (7 files, 2 dependencies, ~20 dead exports)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report - do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- src package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

The repo carries ~550 lines of code that nothing can reach: 7 whole files with
zero importers, 2 npm dependencies that are never imported, a migration shim
whose own docblock says it should be deleted when unused, and a set of exported
functions/types with no callers. Dead shared components are the most expensive
kind of dead code: they sit in the most-read folders (`components/common`,
`components/ui`) and mislead every contributor about what the sanctioned
building blocks are. Every claim below was verified by grep at commit f46bc51
(all searches found only the declaration itself, or declaration + same-file
internal use where noted).

Repo language conventions: user-visible strings are Serbian, code comments are
English, and the em dash / en dash / Unicode minus characters are FORBIDDEN
everywhere (see AGENTS.md) - use plain ASCII `-` in anything you write.

## Current state

- `package.json` - `dependencies` contains `"@tanstack/react-query-devtools": "latest"` and `"@tanstack/react-router-devtools": "latest"`. A repo-wide grep for `devtools`/`Devtools` in `src/`, `vite.config.ts` and `index.html` returns zero hits.
- Dead files (zero importers each, verified):
  - `src/components/ui/date-picker.tsx` (149 lines) - replaced by `src/components/common/DateField.tsx` + `PickerOverlay`.
  - `src/components/ui/sonner.tsx` - a `Toaster` wrapper; `src/routes/__root.tsx:3` imports `Toaster` directly from the `sonner` package instead.
  - `src/components/ui/tabs.tsx` - the app uses `src/components/common/Segmented.tsx` for tabbing.
  - `src/components/ui/separator.tsx` - the `Separator` used in `src/routes/_app.lists.tsx:2` comes from `react-resizable-panels`, not this file.
  - `src/components/layout/ThemeToggle.tsx` - superseded by `ThemeRow` in `src/components/settings/AppearanceSection.tsx`.
  - `src/components/common/ToggleChip.tsx` - only surviving trace is a prose comment at `src/components/common/PersonFilterChips.tsx:26`.
  - `src/hooks/useSupabase.ts` - a parity shim from the Nuxt port; all consumers import `supabase` from `@/lib/supabase` directly.
- `src/components/layout/AppScreen.tsx:147` - `export function LegacyScreen`, the redesign migration wrapper. Its docblock (line ~144) says each page deletes its `<LegacyScreen>` as it converts; zero JSX call sites remain.
- `src/components/common/EmptyState.tsx:33-40` - `TONE_CLASSES` maps `purple` and `violet` to byte-identical values (`bg-accent-soft` / `text-accent-deep`). `violet` has exactly one call site: `src/routes/_app.activities.tsx:397`.
- Dead exports with zero references outside their declaration (candidate list for step 4; each is gated by a fresh grep at execution time):
  - `src/components/common/FormControls.tsx` - `ChipSelect`, `BigValueCard`, `ControlRow`
  - `src/components/common/FilterBar.tsx:124` - `FilterTriggerButton`
  - `src/components/common/SwitchRow.tsx:60` - `Switch`
  - `src/components/common/CurrencyAmountField.tsx:247` - `currencySymbol`
  - `src/components/common/DateField.tsx:98` - `formatDateFieldValueShort` (NOTE: its sibling `formatDateFieldValue` at line 91 IS used internally at line ~269 - for that one only remove the `export` keyword, keep the function)
  - `src/components/money/moneyUi.tsx:32` - `IconTile`
  - `src/components/kid/KidUi.tsx:251` - `KidLoadingStatus`
  - `src/components/kid/kidCopy.ts:155` - `formatTimeRange`
  - `src/components/kid/kidCopy.ts:74` - `attemptsWord`
  - `src/components/kid/kidAgendaModel.ts:187` - `movedLine`
  - `src/components/kid/KidSheet.tsx:92` - `KidSheetRow`
  - `src/components/kid/KidAgendaCard.tsx:29` - `KidAgendaCard` (delete only the unused export/function, NOT the whole file, unless the file then becomes empty)
  - `src/components/payments/PaymentForm.tsx:160` - `recurrenceSummary`
  - `src/lib/listExport.ts:208` - `__testables` (a test-only escape hatch; the test it exists for was never written - `src/lib/__tests__/` contains only `kidInstallIdentity.test.ts` and `navRecents.test.ts`)
  - `src/utils/agendaFilters.ts:29` - `EMPTY_AGENDA_FILTER`
  - `src/utils/date.ts` - `isUpcoming` (line ~47), `isDateInRange` (line ~55), `isDateTodayOrFuture` (line ~229), `daysFromToday` (line ~234)
  - `src/utils/activity.ts:43` - `fromMondayFirstDow`
  - `src/utils/pickerGrid.ts:203` - `isoBefore`
- Dead exported types (zero references, verified): `src/types/database.ts:362` `ExpenseItem` (its own docblock marks it LEGACY, superseded by `ReceiptItem`), `src/types/database.ts:803` `NotificationLogRow`, `src/types/kid.ts:233` `KidCheckResponse`.
- Things that LOOK dead but are NOT (do not touch): `src/components/ui/calendar.tsx` (imported by `src/components/dashboard/WeekStrip.tsx:6`); `workbox-window` (peer dependency of `vite-plugin-pwa`); `zxing-wasm` (dynamically imported at `src/lib/qrScan.ts:49-50`); all `src/routes/**` files (file-based router entry points); `src/sw.ts`; `src/lib/kidInstallIdentity.ts` (imported by `vite.config.ts`); all `supabase/functions/**` (deployed Deno functions); the redirect stub routes `_app.payments.tsx`, `_app.budget.tsx`, `_app.profile.tsx` (deliberate, documented deep-link targets).

## Commands you will need

| Purpose                      | Command        | Expected on success      |
| ---------------------------- | -------------- | ------------------------ |
| Install                      | `pnpm install` | exit 0, lockfile updated |
| Lint+format+dashes           | `pnpm check`   | exit 0                   |
| Tests                        | `pnpm test`    | exit 0, all pass         |
| Build (doubles as typecheck) | `pnpm build`   | exit 0                   |

Note: `pnpm typecheck` alone fails on a fresh checkout until Plan 002 lands
(`src/routeTree.gen.ts` is gitignored and generated by `vite build`/`vite dev`).
Use `pnpm build` as the typecheck gate here.

## Scope

**In scope** (the only files you should modify or delete):

- `package.json`, `pnpm-lock.yaml` (dependency removal)
- The 7 dead files listed above (delete)
- `src/components/layout/AppScreen.tsx` (remove `LegacyScreen` only)
- `src/components/common/EmptyState.tsx` + `src/routes/_app.activities.tsx` (violet -> purple)
- `src/components/common/PersonFilterChips.tsx` (fix one stale comment)
- The files listed under "Dead exports" and "Dead exported types" (surgical deletions only)
- `plans/README.md` (status update)

**Out of scope** (do NOT touch, even though they look related):

- `src/components/ui/card.tsx` (`CardFooter`/`CardAction`) and the re-export lists in `ui/dialog.tsx`, `ui/drawer.tsx`, `ui/dropdown-menu.tsx`, `ui/popover.tsx`, `ui/badge.tsx`, `ui/responsive-dialog.tsx` - unused but kept deliberately as standard shadcn surface.
- `src/components/dashboard/agendaCalendarShared.tsx` and `src/utils/dayTimeline.ts` exports - they look partially unused but are reserved for a separate grid-consolidation plan.
- `src/components/common/PeriodPicker.tsx` (`PeriodPickerShell` is internally used; the over-export cleanup is a separate batch).
- `scripts/seed-demo.ts` and `scripts/measure-cron-queries.sh` - unreferenced but possibly part of a manual workflow; needs a maintainer decision.
- `IMPROVEMENT_PLAN.md`, `REDESIGN_PLAN.md` - kept at root by deliberate decision.
- Any `supabase/` file. The `expense_items` TABLE drop is explicitly deferred; this plan only deletes the frontend `ExpenseItem` interface.

## Git workflow

- Branch: `advisor/001-dead-code-sweep` (never commit to `main` directly)
- Commit messages in English, imperative, matching repo style (e.g. `Dead code sweep: 7 files, devtools packages and unused exports`). One commit per step is ideal for bisects.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Remove the two devtools dependencies

Delete the `@tanstack/react-query-devtools` and `@tanstack/react-router-devtools`
lines from `dependencies` in `package.json`, then run `pnpm install` to update
the lockfile.

**Verify**: `grep -rn "devtools" src vite.config.ts index.html` -> no output; `pnpm install` -> exit 0.

### Step 2: Delete the 7 dead files

`git rm` the seven paths listed in Current state. Then fix the stale comment at
`src/components/common/PersonFilterChips.tsx:26` that still narrates a
"sibling ToggleChip" - reword the comment so it no longer references a deleted
component (keep it English, keep the meaning about the inline chip usage).

**Verify**: `pnpm check` -> exit 0 (oxlint would flag any orphaned import); `pnpm build` -> exit 0.

### Step 3: Remove `LegacyScreen`

In `src/components/layout/AppScreen.tsx`, delete the `LegacyScreen` function
and its docblock (approx. lines 141-155). Keep everything else in the file.

**Verify**: `grep -rn "LegacyScreen" src` -> no output; `pnpm build` -> exit 0.

### Step 4: Delete dead exports (grep-gated, one by one)

For EACH symbol in the "Dead exports" and "Dead exported types" lists, run:

```
grep -rn "<SymbolName>" src supabase/functions scripts --include='*.ts' --include='*.tsx'
```

- If the only hits are the declaration itself (plus its own doc comment): delete the declaration block entirely, plus any imports that then become unused.
- If there are additional hits INSIDE the same file only: remove just the `export` keyword, keep the code (this applies to `formatDateFieldValue`).
- If there are hits in OTHER files (including `__tests__`): SKIP the symbol, leave it untouched, and note it in your final report.

Do them file by file; after each file run `pnpm check` so orphaned imports are
caught immediately.

**Verify**: after the last file, `pnpm check && pnpm test && pnpm build` -> all exit 0.

### Step 5: Collapse `violet` into `purple` in EmptyState

In `src/components/common/EmptyState.tsx`: remove `"violet"` from the
`EmptyStateTone` union and delete the `violet` row from `TONE_CLASSES`.
In `src/routes/_app.activities.tsx:397`: change `tone="violet"` to
`tone="purple"`.

**Verify**: `grep -rn "violet" src` -> no output; `pnpm build` -> exit 0.

### Step 6: Full gate

**Verify**: `pnpm check && pnpm test && pnpm build` -> all exit 0. `git status` shows only in-scope files changed.

## Test plan

No new tests - this plan only deletes unreachable code, so the existing suite
(62 test files) plus the build/typecheck is the safety net. If any EXISTING
test fails after a deletion, that deletion hit a live symbol: restore it and
record it under STOP conditions rather than editing the test.

## Done criteria

- [ ] `pnpm check` exits 0
- [ ] `pnpm test` exits 0
- [ ] `pnpm build` exits 0
- [ ] `grep -rn "devtools" src package.json | grep -v lock` returns no dependency entries
- [ ] The 7 files no longer exist on disk
- [ ] `grep -rn "LegacyScreen\|ToggleChip" src` returns no output
- [ ] `grep -rn "violet" src` returns no output
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any grep gate in Step 4 shows a consumer in another file - skip that symbol and list it in the report; if MORE THAN 5 symbols get skipped, stop entirely (the plan's premise has drifted).
- `pnpm test` fails after a deletion and the failing test imports the deleted symbol.
- `pnpm build` reports an error in a file this plan does not touch.
- `package.json` no longer matches the excerpt (someone already removed or started using the devtools packages).

## Maintenance notes

- The durable fix for this class of debt is adding `knip` to the toolchain
  (config must mark `src/routes/**`, `src/sw.ts`, `scripts/*.ts`,
  `pwa-assets*.config.ts` as entries and ignore `supabase/functions/**`) - it
  found most of these. Deferred to a follow-up; see plans/README.md.
- `src/components/ui/*` files are shadcn-generated; if someone later runs the
  shadcn generator it may resurrect deleted primitives (`tabs`, `separator`,
  `date-picker`, `sonner`). That is fine - re-delete or start using them, but
  do not silently keep both a `ui/` and a `common/` variant of the same control.
- The `expense_items` DB table drop (deliberately deferred) becomes trivially
  safe once this plan lands: the entire frontend footprint was already just the
  `ExpenseItem` interface plus two prose comments.
