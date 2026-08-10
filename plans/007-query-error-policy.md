# Plan 007: List queries stop swallowing Supabase errors; one global fetch-failure toast

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. Touch only in-scope files. On any
> STOP condition, stop and report. Your reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- src/hooks src/lib/queryClient.ts src/components/kid/useKidBirthdayVisibility.ts`
> Plans 001-003 touched a few hook files (dead-export deletion); the
> `if (error) return []` sites themselves must still match the list below -
> recount before starting (Step 0).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (behavior change on failure paths)
- **Depends on**: plans/003-lint-ratchet.md (branch base)
- **Category**: bug / tech-debt
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

Every list fetcher in the data layer swallows its Supabase error and returns
`[]` (28 sites). Consequences: TanStack Query believes the fetch SUCCEEDED,
so `query.isError` is unreachable anywhere in the app; a DB/network failure
renders as a convincing EMPTY state ("no payments this month") with no signal,
no retry, and the empty result is even cached as fresh data for `staleTime`.
Mutations already throw and toast properly - only reads lie.

The fix: fetchers throw; a single `QueryCache.onError` shows one deduplicated
Serbian toast; TanStack's default retry (3 attempts with backoff) starts
working; components keep rendering `data ?? []` exactly as today, so the UI
degrades to "empty + toast + auto-retry" instead of "silently empty forever".

Conventions: Serbian UI strings, English comments, NO em/en dash - ASCII `-`.

## Current state

- `src/lib/queryClient.ts` (verbatim, whole file):

  ```ts
  import { QueryClient } from "@tanstack/react-query";

  export const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
  ```

- The swallow pattern, e.g. `src/hooks/useEvents.ts:95-101`:
  ```ts
  const { data, error } = await q;
  if (error) return [];
  return sortEvents((data as Event[]) ?? []);
  ```
  Mutations in the same files already do `if (error) throw new Error(error.message);`.
- All 28 sites at f46bc51 (recount in Step 0; line numbers may have shifted
  slightly after plans 001-003):
  `src/components/kid/useKidBirthdayVisibility.ts:53`; `src/hooks/useIncomes.ts:41`;
  `src/hooks/useExternalEvents.ts:34`; `src/hooks/useActivities.ts:44`;
  `src/hooks/useSchoolShifts.ts:40`; `src/hooks/useActivityParticipants.ts:23`;
  `src/hooks/usePayments.ts:117,140,152`; `src/hooks/useBirthdays.ts:40`;
  `src/hooks/useExpenses.ts:82,117,655`; `src/hooks/useIncomeEntries.ts:32`;
  `src/hooks/useEvents.ts:100,161`; `src/hooks/useSchoolTimetable.ts:29`;
  `src/hooks/usePaymentParticipants.ts:20`; `src/hooks/useLists.ts:84`;
  `src/hooks/useEventParticipants.ts:22`; `src/hooks/useSchoolBreaks.ts:37,46`;
  `src/hooks/usePaymentOverrides.ts:28`; `src/hooks/useActivityOverrides.ts:39`;
  `src/hooks/useExpenseCategories.ts:40`; `src/hooks/useBirthdayVisibility.ts:54`;
  `src/hooks/useActivitySchedule.ts:34`; `src/hooks/useFamilyMembers.ts:34`.
- Kid mode relevance: kid routes mount some of these same hooks. Supabase RLS
  denial on SELECT normally yields EMPTY ROWS (not an error), so kid mode
  should see no new toasts - but if table-level GRANTs were revoked for the
  kid role, queries would ERROR where they used to silently return []. Step 1
  verifies this before any behavior change.
- The Toaster is mounted globally at `src/routes/__root.tsx:30`
  (`<Toaster richColors position="top-center" />` from `sonner`), and kid
  routes render under the same root, so a toast fired from the cache is
  visible in both apps.

## Commands you will need

| Purpose | Command        | Expected |
| ------- | -------------- | -------- |
| Install | `pnpm install` | exit 0   |
| Check   | `pnpm check`   | exit 0   |
| Tests   | `pnpm test`    | all pass |
| Build   | `pnpm build`   | exit 0   |

## Scope

**In scope**:

- The 24 files listed above (28 sites)
- `src/lib/queryClient.ts`
- NEW `src/lib/errorToastGate.ts` + `src/lib/__tests__/errorToastGate.test.ts`

**Out of scope**: mutation error handling (already correct); per-screen error
UI (components intentionally keep rendering `data ?? []`); retry policy
overrides (TanStack defaults stay); `useGlobalSearch` and any fetcher NOT
using the exact `if (error) return []` pattern; supabase/functions/\*\*.

## Git workflow

- Branch: `git checkout -b advisor/007-query-error-policy advisor/003-lint-ratchet` (STOP if base missing).
- English imperative commits, e.g. `Queries no longer swallow errors - throw plus one toast`, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No push, no PR.

## Steps

### Step 0: Recount the sites

`grep -rn "if (error) return \[\]" src --include='*.ts' --include='*.tsx'`
Expect the 24 files above (line drift from plans 001-003 is fine; a NEW file
in the list or a MISSING file is a STOP - the codebase moved).

### Step 1: Kid-mode grant check (read-only gate)

`grep -n "REVOKE\|GRANT" supabase/migrations/20260808000000_kid_mode.sql`
plus any later `*kid*` migration. If any REVOKE removes SELECT from a role
used by kid sessions on tables these hooks query (events, payments,
activities, birthdays, lists, school\_\*), STOP and report - throwing would
surface errors in the kid app where empty lists are the designed behavior.
If kid access is default-deny via RLS POLICIES only (empty rows, no error),
proceed.

**Verify**: paste the grep output in your report either way.

### Step 2: The toast gate

`src/lib/errorToastGate.ts`:

```ts
/** Rate-gate for the global fetch-failure toast: one per WINDOW_MS burst. */
export function createErrorToastGate(windowMs: number, now: () => number = () => Date.now()) {
  let lastAt = -Infinity;
  return function shouldToast(): boolean {
    const t = now();
    if (t - lastAt < windowMs) return false;
    lastAt = t;
    return true;
  };
}
```

Test in `src/lib/__tests__/errorToastGate.test.ts` (model on
`src/lib/__tests__/navRecents.test.ts` for style): first call true; second
call within window false; call after window true; injected `now` so no real
timers.

**Verify**: `pnpm test -- errorToastGate` -> pass.

### Step 3: QueryCache.onError

Rewrite `src/lib/queryClient.ts`:

```ts
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createErrorToastGate } from "@/lib/errorToastGate";

// One toast per burst: an outage fails every mounted query at once, and the
// user needs one signal, not one per query.
const shouldToast = createErrorToastGate(15_000);

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: () => {
      if (shouldToast()) toast.error("Ne mogu da učitam podatke. Proveri internet vezu.");
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
```

(Keep the existing defaults byte-identical.)

**Verify**: `pnpm check` -> exit 0 (also proves no forbidden import cycles); `pnpm test` -> pass.

### Step 4: Flip the 28 sites

At each site replace `if (error) return [];` with
`if (error) throw new Error(error.message);` - matching the mutation
convention already in the same files. Do it file by file; where a fetcher's
surrounding code has a comment explaining the swallow, delete/adjust the
comment. NO other changes in these files (no signature changes, no
reformatting beyond the line).

**Verify** after each few files: `pnpm check` -> 0. After all:
`grep -rn "if (error) return \[\]" src` -> NO output;
`grep -rn "if (error) throw new Error(error.message)" src/hooks | wc -l` -> increased by ~27 vs before (mutations already used it).

### Step 5: Full gate + behavior audit

Run `pnpm test` and READ any failures carefully: a test that asserted
empty-array-on-error behavior is pinning the OLD bug - if one exists, update
that test to expect a throw and say so in NOTES (this is the single sanctioned
test edit); any OTHER failure is a STOP.

**Verify**: `pnpm check && pnpm test && pnpm build` -> all exit 0.

## Done criteria

- [ ] `grep -rn "if (error) return \[\]" src` -> empty
- [ ] `src/lib/queryClient.ts` wires QueryCache.onError through the gate; defaults unchanged
- [ ] New gate test passes; full suite passes
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0; only in-scope files changed

## STOP conditions

- Step 0 recount does not match the list (new/missing files).
- Step 1 finds kid-role REVOKEs on queried tables.
- More than one existing test pins empty-on-error (one is plausible; a
  cluster means the swallow was load-bearing somewhere - report).
- Any component crashes in tests because it assumed `data` is always an array
  even in error state - report the component; do not patch components in this
  plan.

## Maintenance notes

- New list fetchers must throw; reviewers should reject `if (error) return []`
  on sight (consider a lint-guard later - no oxlint rule matches this shape
  today).
- The toast copy lives in one place (queryClient); the 15s window is a guess -
  tune if real outages feel spammy.
- Follow-up candidates deliberately deferred: per-screen error states
  (EmptyState variant with a retry button), and the `makeEntityHooks` factory
  that would make this policy structural instead of 28 conventions.
