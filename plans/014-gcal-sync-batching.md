# Plan 014: Batch the Google Calendar sync writes - one upsert per page instead of two round-trips per event

> **Executor instructions**: Follow step by step, verify each step, touch only
> in-scope files, STOP rather than improvise. Your reviewer maintains
> `plans/README.md`. Run final verifications UNPIPED.
>
> **NO PRODUCTION DEPLOY.** Never run `supabase functions deploy`,
> `supabase db push`, or `supabase link`.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- supabase/functions/_shared/calendarSync.ts supabase/functions/gcal-sync`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (prune semantics are subtle; a wrong batch prune deletes real rows)
- **Depends on**: none (branch from `main`)
- **Category**: perf
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

`syncOneCalendar` awaits `applyEvent` once per Google event, and every
`applyEvent` performs TWO sequential PostgREST calls - an upsert and an
unconditional prune-delete - even when the prune matches nothing. A first
connect (or any sync-token reset, which re-pulls a window of `now-30d` to
`now+365d` with `singleEvents: true`, so recurring series expand into hundreds
of instances) therefore costs **1000-4000 sequential round-trips inside one
function invocation**: tens of seconds of wall time against the function
duration cap.

The client pays too: `external_calendar_events` has a per-row broadcast trigger,
so each of those upserts fans a message to every open session, and an open
agenda refetches while the sync runs. This is the single path in the app that
can emit thousands of realtime messages.

Conventions: English code comments in Deno functions, NO em dash / en dash /
Unicode minus - ASCII `-` only.

## Current state

`supabase/functions/_shared/calendarSync.ts`

The page loop (`:175-188`):

```ts
do {
  const page = await googleGet<EventsPage>(
    accessToken,
    eventsUrl(cal.google_calendar_id, syncToken, pageToken),
  );
  for (const ev of page.items ?? []) {
    await applyEvent(admin, cal, visibility, tz, skipTypes, ev);
  }
  pageToken = page.nextPageToken;
  if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
} while (pageToken);
```

The per-event writes (`:263-276`):

```ts
await admin
  .from("external_calendar_events")
  .upsert(rows, { onConflict: "calendar_id,google_event_id,local_date" });

// Prune day-rows left over from a previously longer span (e.g. the event was
// shortened from 11-14 to 11-12): drop this event's rows whose day is no
// longer part of it. Normal re-syncs match exactly here and delete nothing.
const keep = whens.map((w) => `"${w.localDate}"`).join(",");
await admin
  .from("external_calendar_events")
  .delete()
  .eq("calendar_id", cal.id)
  .eq("google_event_id", ev.id)
  .not("local_date", "in", `(${keep})`);
```

`rows` are the per-day slices of one event (`:249-261`), keyed
`(calendar_id, google_event_id, local_date)`. `applyEvent` also has EARLIER
branches you must preserve exactly - read the whole function: cancelled and
declined events are DELETED rather than upserted, `skipTypes` filters some event
types out, and privacy `visibility` decides which columns are written. Those
branches are the correctness core; this plan only changes WHEN the writes are
issued, never WHICH rows they target.

`supabase/functions/gcal-sync/index.ts:31-33` processes calendars sequentially -
leave that as is (calendars are few; events are many).

Deno tests exist in this codebase and run under vitest
(`supabase/functions/_shared/*.test.ts`) - check what is already there for
`calendarSync` before writing new tests.

## Commands you will need

| Purpose   | Command                                 | Expected   |
| --------- | --------------------------------------- | ---------- |
| Install   | `pnpm install`                          | exit 0     |
| Tests     | `pnpm test`                             | all pass   |
| Full gate | `pnpm check && pnpm test && pnpm build` | all exit 0 |

## Scope

**In scope**:

- `supabase/functions/_shared/calendarSync.ts`
- A test file alongside it

**Out of scope**: `gcal-sync/index.ts`'s per-calendar loop; the OAuth functions;
the privacy/visibility rules (must be preserved byte-for-byte in behavior); the
per-row broadcast trigger (converting it to statement-level is a separate,
riskier change - note it, do not do it); any production deploy.

## Git workflow

- Branch: `git checkout -b advisor/014-gcal-sync-batching main`
- One English imperative commit, e.g. `Google sync: one upsert per page instead of two queries per event`. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No push, no PR, no deploy.

## Steps

### Step 1: Split `applyEvent` into "decide" and "write"

Refactor `applyEvent` into a PURE function that, given the same inputs, returns
a decision object instead of performing IO - e.g.
`{ kind: "skip" } | { kind: "delete", googleEventId } | { kind: "upsert", rows, keepLocalDates }`.
Do not change any of the decision logic (cancelled/declined -> delete,
`skipTypes` -> skip, visibility -> which columns, per-day slicing).

**Verify**: `pnpm check` exit 0. Add tests for the pure function covering: an
all-day event, a timed event, a multi-day span (correct per-day rows), a
cancelled event, a declined event, and a `skipTypes` hit. `pnpm test` passes.

### Step 2: Batch the writes per page

In the page loop, map all items through the pure decider, then issue at most
THREE statements per page:

1. One `upsert` with every row from every `upsert` decision (same `onConflict`).
2. One batched delete for the `delete` decisions:
   `.eq("calendar_id", cal.id).in("google_event_id", [...ids])`.
3. One batched prune replacing the per-event prune. This is the subtle one -
   the per-event version deletes rows of THAT event whose `local_date` is no
   longer part of it. A single statement cannot express "per event, keep its own
   date list" with a plain `.in()`.

   Choose ONE of these and say which and why:
   - **(a) Prune only what changed**: keep a per-event prune but issue it ONLY
     for events whose day-set actually shrank versus what is already stored.
     Requires reading existing `local_date`s for the page's events in one query
     (`.in("google_event_id", ids)`), then pruning just the affected events.
     Worst case unchanged, normal case ~zero deletes - and the plan's comment
     already says normal re-syncs delete nothing.
   - **(b) One delete with an OR filter**: build a PostgREST `.or()` of
     `and(google_event_id.eq.X,local_date.not.in.(...))` clauses. Fewer
     statements, but the filter string grows with page size and is easy to get
     wrong - if you pick this, cap the clause count and verify the generated
     filter on a small case first.

   **(a) is the recommended default** - it is the one whose failure mode is
   "does the same work as today", not "deletes the wrong rows".

**Verify**: `pnpm check && pnpm test && pnpm build` exit 0, and your new tests
assert the batching produces the SAME final row set as the per-event path for a
mixed page (new event, unchanged event, shortened multi-day event, cancelled
event).

### Step 3: Confirm the round-trip reduction

Instrument in a test (a counting fake admin client, not production code): a
page of N mixed events must issue a bounded number of statements independent of
N - report the actual count for N = 1, 10 and 100.

**Verify**: report the three numbers. If the count still grows linearly with N,
Step 2 did not achieve its goal - STOP and report rather than claiming success.

## Test plan

- Pure-decider tests as in Step 1 (these are the ones that protect the privacy
  and slicing rules).
- A batching equivalence test: same input page, compare the resulting row set
  from the batched path against the expected set built by hand.
- A statement-count test as in Step 3.
- Model the fake-client style on `src/hooks/__tests__/useSaveReceiptExpense.test.tsx`.

## Done criteria

- [ ] `applyEvent`'s decision logic is a pure function with direct tests
- [ ] The page loop issues a bounded number of statements per page (numbers reported for N = 1, 10, 100)
- [ ] Cancelled / declined / skipType / visibility behavior is unchanged, proven by tests
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0
- [ ] Nothing deployed

## STOP conditions

- The prune cannot be expressed safely in batch form (option (a) included) -
  report; a correct slow sync beats a fast wrong one.
- Any existing `calendarSync` test changes behavior expectations.
- The refactor would require touching the privacy/visibility rules.
- You cannot construct a fake admin client that records statements without
  restructuring production code - report; do not add production-only test hooks.

## Maintenance notes

- The per-row broadcast trigger on `external_calendar_events` remains: a large
  sync still emits one realtime message per row. Converting it to a
  statement-level trigger is the natural follow-up and would compound this win;
  it needs its own migration and a check that the client's invalidation still
  fires exactly once per burst (plan 011 adds coalescing on the client, which
  already softens this).
- The 410-GONE path wipes and re-pulls the full window, so it hits this same
  code - it is the main beneficiary after a first connect.
