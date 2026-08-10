# Plan 011: Cut the app-resume request storm and the unbounded events fetches

> **Executor instructions**: Follow step by step, verify each step, touch only
> in-scope files, STOP rather than improvise. Your reviewer maintains
> `plans/README.md`. Run final verifications UNPIPED.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- src/hooks/useVisibilityRefetch.ts src/hooks/useFamilyChannel.ts src/hooks/useFirstSteps.ts src/hooks/useEvents.ts src/hooks/useBusyDays.ts src/components/money/NovacScreen.tsx`
> Plan 007 changed error handling inside `useEvents.ts` - expected. Changes to
> the specific functions excerpted below are a STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches refetch semantics that mask themselves as "fresh data")
- **Depends on**: plans/010 (branch base - shares PaymentsPage)
- **Category**: perf
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

Measured on the Danas screen at f46bc51:

- Danas mounts **18 distinct query keys** (`useProfile` alone issues two
  sequential HTTP calls), and TWO separate handlers fire an UNFILTERED
  `invalidateQueries` on resume: the visibility listener and the realtime
  channel's rejoin callback. On iOS the socket dies during suspend, so a resume
  reliably triggers both - roughly **38 requests per foreground**. Both also
  override every deliberate `staleTime`, including the 5-minute ones and an
  `Infinity` one.
- `useFirstSteps` keeps an **unbounded `select("*")` on `events`** alive forever
  just to answer "are there any events?" - and it is mounted on Danas.
- `useBusyDays` passes `{}` to `useEventsList` believing an `enabled` gate
  exists. It does not, so **every mounted DateField (12 forms) fetches the whole
  events table**, unfiltered, growing forever.

That last one is also correctness-adjacent: the comment in the code asserts a
guarantee the library does not provide.

Conventions: Serbian user-visible strings, English code comments, NO em dash /
en dash / Unicode minus - ASCII `-` only.

## Current state

`src/hooks/useVisibilityRefetch.ts` (the whole effect):

```ts
const onVisibilityChange = () => {
  if (document.visibilityState !== "visible") return;
  void queryClient.invalidateQueries({ refetchType: "active" });
};
document.addEventListener("visibilitychange", onVisibilityChange);
```

`src/hooks/useFamilyChannel.ts:79-100` - `hasSubscribed` ref plus:

```ts
.subscribe((status) => {
  if (status !== "SUBSCRIBED") return;
  if (hasSubscribed.current) {
    void queryClient.invalidateQueries({ refetchType: "active" });
  }
  hasSubscribed.current = true;
});
```

Per-message handling above it (`:87-93`) loops `TABLE_INVALIDATIONS[table]` and
invalidates each key synchronously, with no coalescing. `TABLE_INVALIDATIONS`
is the map at `:42-68`; `paymentHistoryKey` at `:33` is deliberately
family-less (`["payment_history"]`).

`src/lib/queryClient.ts` - `staleTime: 30_000`, `refetchOnWindowFocus: false`.
(NOTE: plan 007 adds a `QueryCache.onError` here. Merge, do not overwrite.)

`src/hooks/useFirstSteps.ts:52` - `const eventsQuery = useEventsList();`, used
only at `:90` as `(eventsQuery.data?.length ?? 0) > 0`.

`src/hooks/useEvents.ts:85-120` - `fetchEvents` applies `from`/`to` only when
present; `useEventsList` is `enabled: !!familyId` with no caller-side gate.

`src/hooks/useBusyDays.ts:38-42`:

```ts
const active = enabled && !!from && !!to;
// TanStack keeps `enabled: false` queries from firing; passing an undefined
// range while the picker is closed keeps the range key stable too.
const eventsQuery = useEventsList(active ? { from: from as string, to: to as string } : {});
```

`src/components/money/NovacScreen.tsx:140-141` - `onChange={(event) => setSearchTerm(event.target.value)}`,
passed to `BudgetPage` -> `useExpenseSearch(searchTerm)` with no debounce, while
`src/components/search/GlobalSearchDialog.tsx:44,156-158` debounces at 250 ms.

There IS a precedent for a count-only existence query - find
`useHasExternalEvents` (in the external-events hooks) and copy its shape.

## Commands you will need

| Purpose   | Command                                 | Expected   |
| --------- | --------------------------------------- | ---------- |
| Install   | `pnpm install`                          | exit 0     |
| Full gate | `pnpm check && pnpm test && pnpm build` | all exit 0 |

## Scope

**In scope**:

- NEW `src/hooks/useResumeRefresh.ts` (or a `src/lib/resumeRefresh.ts` module - your call, state which)
- `src/hooks/useVisibilityRefetch.ts`, `src/hooks/useFamilyChannel.ts`
- `src/hooks/useEvents.ts` (add an `enabled` option + a count-only existence hook)
- `src/hooks/useFirstSteps.ts`, `src/hooks/useBusyDays.ts`
- NEW `src/hooks/useDebouncedValue.ts`; `src/components/money/NovacScreen.tsx`
- `src/components/search/GlobalSearchDialog.tsx` ONLY if adopting the shared debounce hook there is a clean 3-line swap; otherwise leave it
- Tests under the matching `__tests__` dirs

**Out of scope**: `usePaymentHistory`'s all-time fetch (real, but it interacts
with plan 010's occurrence work - separate plan); the agenda scroll-spy rect
walk and day virtualization (separate, riskier plan); `gcal-sync` batching
(separate plan); any change to what the UI renders.

## Git workflow

- Branch: `git checkout -b advisor/011-resume-and-fetch-cost advisor/010-payment-recurrence-unify` (STOP if base missing).
- One commit per step, Serbian imperative. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No push, no PR.

## Steps

### Step 1: One throttled resume refresh

Create a single module owning resume semantics:

- A module-level `lastRefreshAt` timestamp.
- `resumeRefresh(queryClient)`: if `Date.now() - lastRefreshAt < 30_000`, do
  nothing; else stamp and call
  `queryClient.refetchQueries({ type: "active", stale: true })`.

`refetchQueries({ stale: true })` instead of a blanket `invalidateQueries` is
the load-bearing change: it honors each query's own `staleTime` instead of
steamrolling it, so the 5-minute and `Infinity` queries stop refetching on every
foreground.

Call it from BOTH `useVisibilityRefetch`'s visibility handler and
`useFamilyChannel`'s rejoin branch (replacing their `invalidateQueries` calls).
Keep `hasSubscribed` semantics in the channel (first subscribe still does
nothing).

Unit-test the throttle with an injected clock (no real timers), mirroring the
gate test plan 007 adds if it is on your base branch.

**Verify**: `pnpm test -- resume` passes; `pnpm check` exit 0.

### Step 2: Coalesce broadcast invalidations

In `useFamilyChannel`, buffer incoming table names in a `Set` and flush on a
short `setTimeout` (150-250 ms), invalidating each distinct key ONCE per flush.
Clear the timer on unmount. Rationale to put in a comment: one "mark paid"
writes `payment_history` + `payments` + (trigger) `expenses`, so an uncoalesced
handler refetches the payments list 4-5 times for one tap.

**Verify**: `pnpm check && pnpm test` exit 0. In your report, state how you
convinced yourself the flush cannot drop a table name (e.g. the Set is captured
by the timer closure and cleared only after the invalidations run).

### Step 3: Kill the unbounded events fetches

(a) Add an existence hook next to the events hooks, modeled on
`useHasExternalEvents`:

```ts
export function useHasAnyEvents(); // select("id", { count: "exact", head: true }).limit(1), staleTime 5 * 60_000
```

Use it in `useFirstSteps` in place of `useEventsList()`; update the `done`
computation at `:90` and the `isLoading` OR at `:77`.

(b) Give `useEventsList` an `enabled?: boolean` option that ANDs with the
existing `!!familyId`. In `useBusyDays`, pass `enabled: active` and DELETE the
comment that claims a gate already exists (it is factually wrong and it is what
caused this).

**Verify**: `grep -n "useEventsList()" src` -> no call site without arguments
remains outside tests; `pnpm check && pnpm test && pnpm build` exit 0.

### Step 4: Debounce the money search

Create `src/hooks/useDebouncedValue.ts` (value + delay -> debounced value,
cleanup on unmount). Apply it to the Novac search term so `useExpenseSearch`
only sees settled input at 250 ms - matching the palette's existing constant.
Keep the input itself fully controlled and instant; only the QUERY input is
debounced.

**Verify**: typing is unaffected visually (state still updates per keystroke);
`pnpm check && pnpm test && pnpm build` exit 0.

### Step 5: Full gate

**Verify**: `pnpm check && pnpm test && pnpm build` all exit 0, unpiped.

## Test plan

- `useResumeRefresh`/module: throttle honors the window; first call always runs;
  injected clock, no real timers.
- Coalescing: given three table messages within the window, the invalidate for a
  shared key runs once. If testing the timer is awkward, extract the pure
  "collect table names -> distinct query keys" step and test THAT, and say so.
- `useDebouncedValue`: emits after the delay, resets on rapid changes, cleans up.
- Do NOT write a test that asserts a request count against a mocked Supabase -
  it would test the mock.

## Done criteria

- [ ] `grep -rn "invalidateQueries({ refetchType" src` -> no unfiltered blanket calls remain
- [ ] Resume path goes through ONE throttled function used by both callers
- [ ] `useFirstSteps` no longer calls `useEventsList`
- [ ] `useBusyDays` passes an `enabled` flag and the wrong comment is gone
- [ ] Novac search is debounced at 250 ms
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0

## STOP conditions

- Base branch missing.
- `refetchQueries({ type: "active", stale: true })` turns out to leave a screen
  visibly stale after a resume in a way `invalidateQueries` did not - report
  rather than reverting to the blanket call.
- The count-only existence query needs a column or policy that does not exist.
- Coalescing changes make any existing test fail.

## Maintenance notes

- The 30 s resume throttle and the 150-250 ms coalescing window are judgment
  calls, not measurements. If cross-device updates start feeling laggy, the
  coalescing window is the first thing to shorten.
- Deliberately left for later, all verified real: `usePaymentHistory()` fetches
  all-time history though the page filters by month; the agenda scroll-spy does
  an O(days-scrolled) rect walk per animation frame over up to 365 unvirtualized
  day sections; `gcal-sync` does 2 sequential DB round-trips per Google event
  (1000-4000 per first connect); `resolveWeekBlocks` rebuilds 4 lookup maps once
  per week (~53x at the max horizon).
