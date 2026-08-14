# 017 - Recurring tasks: no ticking ahead, visible debt, and a history

**Status:** DONE (2026-08-14, branch `feat/recurring-task-clarity`; see section 13
for what execution changed - read that before trusting sections 4-9 to the letter)
**Priority:** P1 (shipped-feature confusion, reported by the maintainer 2026-08-14)
**Effort:** L
**Depends on:** 015 (merged as `34cdea1`). Branch from `main`.
**Branch:** `feat/recurring-task-clarity` - one pull request.

Writing rules for this repo, enforced by `pnpm check`: no em dash, no en dash,
no Unicode minus anywhere - ASCII `-` only. Comments, identifiers, migrations,
commit messages and docs are English; Serbian appears only inside string
literals a person reads.

---

## 1. The problem

015 shipped the recurrence model correctly and the interface around it
opaquely. Every complaint below is one symptom of the same thing: an instance
of a series has three independent properties (where it sits, whether it is
resolved, whose it is), the UI collapses them into one word, and every action
on an instance is silent and invisible once performed.

1. **A future occurrence can be ticked off.** Nothing anywhere gates a tick on
   a date. `useToggleTask` takes the occurrence date as data and writes it;
   `taskTickSlot` ([taskItemModel.ts:118](../src/components/tasks/taskItemModel.ts#L118))
   decides who may tick but never when. So on a daily chore the agenda offers a
   circle for tomorrow, the day after, and every day of the visible window, and
   each one writes a real `done` row.
2. **A repeat can never be late.** By locked decision 6 of 015,
   `isTaskOverdue` returns false for a recurring task
   ([task.ts:542](../src/utils/task.ts#L542)) and a missed instance is only
   struck through on its own day (`isMissedOccurrence`,
   [task.ts:562](../src/utils/task.ts#L562)). The agenda window starts at
   today, so one day later that instance is off screen forever. The maintainer
   wants the opposite: a chore may be late, and several instances of the same
   chore may be late at once.
3. **Skip and move silently apply to everybody.** Both write the
   whole-occurrence row (`person_id IS NULL`,
   [useTaskOccurrences.ts:68](../src/hooks/useTaskOccurrences.ts#L68)), which
   is the intended model - placement is a fact about the occurrence, not about
   one assignee - but no string in the UI says so. On a `per_assignee` chore
   split between three people ("svako svoje", the `0/3` pill) one member
   cancels the day for the other two, and the copy reads "Ovaj dan otpada,
   serija se nastavlja".
4. **Skip has no confirmation and two names.** `handleSkip` fires straight off
   the action row and closes the sheet
   ([TaskDetailSheet.tsx:521](../src/components/tasks/TaskDetailSheet.tsx#L521)).
   The same write is also reachable as "Obriši zadatak" -> "Samo ovo
   ponavljanje" ([TaskDetailSheet.tsx:416](../src/components/tasks/TaskDetailSheet.tsx#L416)),
   so one write has two names, one of which is the word for the destructive
   action next to it.
5. **A skipped occurrence cannot be found or undone.** All three surfaces drop
   skipped instances ([useAgenda.ts:342](../src/hooks/useAgenda.ts#L342),
   [taskItems.ts:149](../src/components/tasks/taskItems.ts#L149),
   [useKidTasks.ts:273](../src/hooks/useKidTasks.ts#L273)). `useRestoreOccurrence`
   ([useTaskOccurrences.ts:259](../src/hooks/useTaskOccurrences.ts#L259)) is
   implemented, tested and **called by nothing**. A skipped day is therefore
   still in the database with no route back to it.
6. **Nobody's name is on anything.** `task_occurrences` records
   `completed_by_person_id` and `completed_at` and nothing else about who
   acted - there is no column that answers "who skipped this" or "who moved
   it". `tasks.created_by_id` / `updated_by_id` exist and are displayed only
   inside `ListInfoPanel`, never in the task detail sheet.

## 2. What ships

Maintainer decided all four on 2026-08-14.

| #   | Decision                                                                        | Section |
| --- | ------------------------------------------------------------------------------- | ------- |
| A   | A recurring occurrence in the future is not tickable. No strict-order mode.     | 6       |
| B   | Unresolved past occurrences carry forward, grouped one row per task in "Kasni". | 7       |
| C   | Skip and move stay whole-occurrence, and every string says so. Both confirm.    | 8       |
| D   | An actor stamp on the occurrence row, plus a per-task "Istorija" sub-view.      | 9, 5    |

Explicitly **not** in scope, decided against or deferred with a reason:

- **Per-person skip** for `per_assignee` tasks. Rejected: it doubles the
  semantics of the one table that already carries three of them, and the parity
  test caught "one person's skip cancels the instance for the whole family" as
  a bug once already.
- **Opt-in strict order** ("only the oldest unresolved instance is tickable").
  Rejected: with A in place, the remaining case is "today is tickable while
  yesterday is late", which is legitimate.
- **A full `task_events` audit log.** Deferred. Section 9 records who put an
  occurrence into its current state, which answers every question that was
  actually asked; the trail of superseded states (skipped, restored, skipped
  again) is a separate table and a retention policy.
- **The morning / evening digest.** It reports the day ahead, and late repeats
  are a dashboard fact, not a new push. Revisit only if the maintainer asks -
  and if so, read [[project-digest-agenda-parity]] first, because the digest
  must then count what `useOverdueItems` counts.

## 3. Work breakdown and file ownership

Sequential inside one branch. Sections 4 and 5 have no UI and are what
everything else reads, so they go first.

| Step | Section | Files (owner of each)                                                                           |
| ---- | ------- | ----------------------------------------------------------------------------------------------- |
| 1    | 4       | `supabase/migrations/20260815000000_task_occurrence_actor.sql`, `src/types/database.ts`         |
| 2    | 5       | `src/utils/task.ts`, `supabase/functions/_shared/expandTask.ts` (+ both test files)             |
| 3    | 6       | `src/components/tasks/taskItemModel.ts`, `TaskRow.tsx`, `supabase/migrations/...kid guard`      |
| 4    | 7       | `src/hooks/useOverdueTasks.ts`, `src/hooks/useAgenda.ts` (type only), `AgendaItemRow.tsx`       |
| 5    | 8, 9    | `src/components/tasks/TaskDetailSheet.tsx`, new `TaskHistoryPanel.tsx`, `useTaskOccurrences.ts` |
| 6    | 10      | tests                                                                                           |

## 4. Database

One migration, `supabase/migrations/20260815000000_task_occurrence_actor.sql`.

```sql
ALTER TABLE task_occurrences
  ADD COLUMN acted_by_person_id UUID
    REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN acted_at TIMESTAMP WITH TIME ZONE;
```

Filled by a trigger, not by the client, so it cannot be spoofed or forgotten:

```sql
CREATE OR REPLACE FUNCTION set_task_occurrence_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER            -- reads profiles; must not depend on the caller's RLS
SET search_path = public
AS $$
BEGIN
  -- profiles.id equals the auth uid for every member WITH a login. A child's
  -- synthetic auth user has no profiles row at all, so writing auth.uid() there
  -- would violate the FK; kid_complete_task() is SECURITY DEFINER and stamps
  -- kid_profile_id() itself, which is the value we want in that case.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid()) THEN
    NEW.acted_by_person_id = auth.uid();
  ELSE
    NEW.acted_by_person_id = public.kid_profile_id();
  END IF;
  NEW.acted_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_task_occurrence_actor ON task_occurrences;
CREATE TRIGGER set_task_occurrence_actor
  BEFORE INSERT OR UPDATE ON task_occurrences
  FOR EACH ROW EXECUTE FUNCTION set_task_occurrence_actor();
```

`kid_profile_id()` returns NULL for a normal member and for an anonymous
context, so the ELSE arm degrades to "unknown" rather than to an error. Add
`COMMENT ON COLUMN` for both columns in the same migration (repo convention,
English).

**No new RLS.** Both columns live on a table whose four policies already gate
by family and by parent task.

`src/types/database.ts`: add the two fields to `TaskOccurrence` (after
`completed_by_person_id`), with the doc comment "Who put this occurrence into
its CURRENT state, and when. Superseded states are not kept - see plan 017."
The optimistic row builders in `useTaskOccurrences.ts` must set both (use
`profile.id` and `new Date().toISOString()`), or the cached row and the server
row differ for a beat and the history flickers.

## 5. Engine: two new pure helpers, in both copies

`src/utils/task.ts` and `supabase/functions/_shared/expandTask.ts` hold the same
rules twice and cannot import each other. **Every change here goes into both,
and `expandTask.parity.test.ts` must stay green** - it has already caught four
rules that drifted, including one that let a skip mask a completion.

```ts
/**
 * True when this instance has not come due yet. Recurring only: a one-off's
 * due date is a deadline (paying a bill early is normal), while a repeat's
 * occurrence date is an appointment - "tomorrow's dishes" cannot be done today.
 */
export function isFutureOccurrence(
  task: Pick<Task, "recurrence_period">,
  effectiveDate: string,
  today: string,
): boolean {
  return isRecurringTask(task) && effectiveDate > today;
}

/**
 * Unresolved past instances of one series, oldest first - the debt the overdue
 * block carries. Bounded by LATE_LOOKBACK_DAYS: a daily chore nobody has
 * touched since spring is not 200 rows of debt, it is history.
 */
export function lateOccurrences(
  task: TaskSeriesFields & TaskCompletionFields,
  today: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): TaskOccurrenceInstance[];
```

`LATE_LOOKBACK_DAYS = 30`, exported so the tests and the history view read the
same number.

Implementation is a filter over the existing expansion, not a new walk:
expand `[today - 30, today - 1]` and keep `isMissedOccurrence(instance, today)`.
That predicate already keys on `effectiveDate`, so an instance whose series
date is past but which was MOVED into the future is correctly not late, and one
moved backwards into the window correctly is.

`isTaskOverdue` keeps returning false for recurring tasks. It answers for a
task ROW; lateness for a series is per instance and is `lateOccurrences`. Update
its doc comment: decision 6 of 015 is now only half true, and the comment
currently states the other half as a rule.

## 6. A future occurrence is not tickable (decision A)

`taskTickSlot` stays date-blind - it answers "whose tick is this and may this
viewer write it". The date gate is a second, separate predicate, because it has
a deliberate exception.

- **`TaskRow` / every list circle**: disabled when
  `isFutureOccurrence(task, item.date, today)`. Read it in
  `useTaskCompletionSlot` ([TaskRow.tsx:66](../src/components/tasks/TaskRow.tsx#L66))
  and AND it into `canTick`. A disabled circle is already styled; do not hide
  it - a missing circle reads as "this cannot be done at all".
- **`TaskDetailSheet` keeps the action**, because "I did it in advance" is real
  and two taps is the right price for it. When the instance is in the future,
  the row's description becomes `Rok je tek ${formatDate(shownDate)}` and the
  label stays "Označi kao završeno".
- **Kid shell**: the same gate in `useKidTasks`, plus a server guard in
  `kid_complete_task()`, since the RPC is the child's only write path. The
  guard is `p_occurrence_date <= CURRENT_DATE + 1`, **not** `<= CURRENT_DATE`:
  the database runs in UTC and the family is UTC+1/+2, so between midnight and
  02:00 local `CURRENT_DATE` is still yesterday and a strict guard would reject
  a legitimate tick. Put that sentence in the migration as a comment.

## 7. Late repeats carry forward, grouped (decision B)

One row per TASK in the existing "Prekoračeno" block, never one row per late
instance: a daily chore missed for a week would otherwise own the block.

- `AgendaItem`'s `task` arm gains `lateCount?: number` (absent means 1).
  `useAgenda` does not set it; only the overdue hook does.
- `useOverdueTasks` gains the recurring arm. It already reads `useTasksList`
  and `useTaskAssignees`; add `useTaskOccurrenceRows` (same cache, no extra
  fetch). For each recurring task: `const late = lateOccurrences(...)`, skip if
  empty, and emit ONE item built from the **oldest** instance
  (`occurrenceDate` and `date` are that instance's, so the tick from the
  overdue row resolves the oldest debt) with `lateCount: late.length`.
- `AgendaItemRow` renders a `<Pill tone="neg">` reading `kasni ${n}` when
  `lateCount > 1`. The existing `propušteno` pill stays for the in-place past
  instance; the two never appear on the same row (one is the overdue block,
  the other a past day in the calendar).
- `OverdueSection` is untouched - it is a dumb renderer and stays one.
- `TaskDetailSheet`, when opened on an instance with `lateCount > 1`, adds an
  info row "Zaostalo" valued `${n} ponavljanja, najstarije ${date}` and an
  action row "Prikaži zaostalo" that pushes a sub-view listing the late
  instances. Each row there ticks or skips that one instance; the sub-view's
  footer carries "Preskoči sve zaostalo", which writes one skip per instance
  (sequentially through the existing mutation - no new endpoint) behind the
  same confirm as section 8.

Both existing callers of `useOverdueItems` (`TodayScreen`,
`AgendaUpcomingList`) pick this up with no change.

## 8. Skip and move say who they affect, and confirm (decision C)

The write is unchanged. Everything around it is new.

- **One name.** The action row stays "Preskoči ovo ponavljanje". In the delete
  sub-view, the first option is relabelled from "Samo ovo ponavljanje" to
  "Preskoči ovo ponavljanje" and pushes the same confirm rather than writing
  directly. There is then exactly one way to reach exactly one confirmation.
- **A confirm sub-view** on the sheet stack (`view: "skip"`), same shape as the
  delete question. Body:
  - with assignees: `${formatDate(seriesDate)} otpada za sve kojima je zadatak dodeljen (${names}). Serija se nastavlja.`
  - without: `${formatDate(seriesDate)} otpada za celu porodicu. Serija se nastavlja.`
  - Footer: "Nazad" (outline) + "Preskoči". Button labels follow
    [[feedback-dialog-button-labels]] - a sub-mode back is "Nazad".
- **Move gets the same sentence** but as a line inside the existing "Izaberi
  datum" view, above the field: `Pomera se za sve kojima je zadatak dodeljen`.
  The one-tap "Pomeri na sutra" row keeps its single tap and gains the same
  sentence as its description.
- **Neither closes the sheet any more.** They `pop()` back to the detail root,
  which re-reads the row from the cache: the badge flips to "Preskočeno" or
  "Pomereno na ...", and the primary action becomes "Vrati ponavljanje" ->
  `restoreOccurrence`. This is exactly how a tick already behaves, and it is
  what makes the action feel reversible instead of terminal.
- **An undo toast** on success, the established `action: { label, onClick }`
  shape (`usePwaUpdate.tsx:106`): `toast.success("Ponavljanje preskočeno", { action: { label: "Poništi", onClick: restore } })`.

## 9. History and names (decision D)

**In the detail root**, for every task, two new info rows below the existing
ones, resolved through `useFamilyMembers().byId` exactly as `ListInfoPanel`
does: "Kreirao/la" (`created_by_id` + `created_at`) and "Poslednja izmena"
(`updated_by_id` + `updated_at`), the second only when it differs from the
first. No migration - these columns have existed since the lists feature.

**A new sub-view "Istorija"**, recurring tasks only, reached from a
`DetailActionRow` with a chevron. New file
`src/components/tasks/TaskHistoryPanel.tsx`, modelled on
`PaymentHistoryPanel.tsx` (bodies for a pushed view, not a second dialog).

Entries, newest occurrence date first, over the last 90 days:

| Source                                  | Label                               | Action  |
| --------------------------------------- | ----------------------------------- | ------- |
| whole-occurrence row, `done`            | `Završeno` + actor + `completed_at` | -       |
| per-assignee `done` rows (per_assignee) | `Završeno ${done}/${total}` + names | -       |
| whole-occurrence row, `skipped`         | `Preskočeno` + actor + `acted_at`   | "Vrati" |
| whole-occurrence row, `moved`           | `Pomereno na ${date}` + actor       | "Vrati" |
| a past series date with no row at all   | `Propušteno`                        | -       |

The projected-but-unrowed entries are what make this a history rather than a
dump of the override table, and they come from the same
`expandTaskOccurrences` call the rest of the app uses. "Vrati" calls the
existing `restoreOccurrence` unchanged; note its `status IN ('skipped','moved')`
filter is deliberate and must not be widened - un-ticking belongs to
`useToggleTask`, which owns the other home of completion.

Empty state: "Nema zabeleženih ponavljanja." (follow the `EmptyState`
conventions from [[project-empty-states-onboarding]] if the view is ever more
than a list).

## 10. Tests

Everything below is required, not optional. The 015 verification found more
bugs by testing the two engines against each other than every unit file found
alone.

1. `src/utils/__tests__/task.test.ts`: `isFutureOccurrence` (recurring vs
   one-off, boundary at today), `lateOccurrences` (none / one / several /
   moved-into-future is not late / moved-backwards-into-window is / skipped is
   not / done is not / respects the 30-day bound / respects `recurrence_until`).
2. `supabase/functions/_shared/expandTask.parity.test.ts`: extend the generated
   corpus comparison to the two new helpers. This is the gate on section 5.
3. `src/components/tasks/__tests__/taskItemModel.test.ts` and `TaskRow.test.tsx`:
   the circle is disabled for a future recurring instance, enabled for today,
   enabled for a future ONE-OFF, and unaffected for the overdue rows.
4. `src/components/tasks/__tests__/TaskDetailSheet.test.tsx`: skip requires the
   confirm (the action row alone writes nothing); the confirm names the
   assignees; success pops to the root and the primary action becomes "Vrati
   ponavljanje"; the delete sub-view's first option reaches the same confirm.
5. New `src/hooks/__tests__/useOverdueTasks.test.ts` (or the existing agenda
   placement test): a recurring task with three late instances yields ONE item
   with `lateCount: 3` dated to the oldest, and one-offs are unchanged.
6. A `TaskHistoryPanel` test: the four row kinds render, and "Vrati" appears
   only on skipped and moved.

## 11. Conventions and traps

- **Both engines or neither.** `src/utils/task.ts` and
  `supabase/functions/_shared/expandTask.ts`. The parity test is the proof.
- **`src/utils/task.ts` and `taskItemModel.ts` must not import anything whose
  chain reaches `lib/supabase`** - CI has no Supabase env and it fails there
  while passing locally. Reproduce with `mv .env .env.bak && pnpm test; mv .env.bak .env`
  in ONE command. See [[project-ci-no-supabase-env]].
- **`pnpm exec oxfmt` is repo-wide and takes no path.** Run it once, at the
  end, never from parallel agents.
- **`task_occurrences_unique_slot` is `UNIQUE NULLS NOT DISTINCT`.** The
  whole-occurrence row is the one with `person_id IS NULL`; there is at most
  one per slot, which is what makes the upsert in
  `useUpsertOccurrenceOverride` safe.
- **`moved_to_date` is WHERE, `status` is WHETHER.** Never gate placement on
  `status === 'moved'` - ticking a moved instance flips the status while the
  date stays.
- **A skip clears the completion stamp** on purpose
  ([useTaskOccurrences.ts:163](../src/hooks/useTaskOccurrences.ts#L163)). The
  new `acted_*` columns must NOT be cleared the same way; the trigger rewrites
  them on every upsert, which is the point.
- **Serbian only in string literals.** Section 8 and 9 are the only places this
  plan adds any. See [[feedback-english-codebase]].
- **Release order** if this reaches production: migration first, then the
  frontend ([[reference-prod-deploy-workflow]]); the trigger is inert for the
  shipped client, which writes neither column. Prod backend deploy needs
  explicit per-batch authorization from the maintainer.

## 13. Notes from execution - read these, they override the plan

1. **The kid side was already right.** `kid_complete_task()` has carried
   `p_date > CURRENT_DATE + 1` since 015, with the same UTC-offset reasoning
   section 6 spells out, and `useKidTasks` already gated `canComplete` on
   `effectiveDate <= today`. So the migration in section 6 was not written and
   nothing in the kid shell changed - the hole was only ever in the parent app.
2. **The migration is `20260814120000_task_occurrence_actor.sql`**, dated the day
   it was written rather than the 15th the plan guessed.
3. **`lateOccurrences` re-resolves `per_assignee` completion**, which the plan
   did not anticipate. `TaskOccurrenceInstance.isDone` is whole-occurrence
   completion and is ALWAYS false for that mode, so taking it at face value
   reported a chore all three assignees finished last Tuesday as owed forever.
   The helper therefore takes `assigneeIds` and treats a day as resolved when
   everybody it was given to has ticked. Mirrored in both engines; the parity
   test covers 0, 1 and 2 assignees.
4. **The "Zaostalo" info row was cut** (maintainer, on review of the first
   build). The action row below it already names the count and can be acted on;
   the info row said the same thing twice and could not be tapped.
5. **History and backlog rows carry a progress line** - `1/3 · Milan · fali još
2` (maintainer request). Without it, a day two of three people had finished
   read as a bare "Propušteno", which is the wrong answer to "what happened
   here". The line is count-first and verb-free so it needs no gender agreement
   for a mixed list of names.
6. **Skip is withdrawn once a day is finished, and names the work it spares
   otherwise.** Raised by the maintainer and correct: skip and completion share
   one slot (`person_id IS NULL`), so skipping a finished occurrence silently
   deleted somebody's tick. Now:
   - fully done (shared ticked, or every assignee ticked) - "Preskoči ovo
     ponavljanje" is not offered, and `taskDeleteCopy` drops its "just this one"
     answer too, since that answer WAS the skip;
   - partly done (`per_assignee`) - the action row reads "Otpada za ostale; 1/3
     već završeno" and the confirm names them: "Milan je već završio/la svoj deo
     - ta kvačica ostaje zabeležena." That sentence is true because per-person
       rows are untouched by a whole-occurrence skip; the claim and the write must
       stay in step if either is ever changed.
7. **The history window is bounded at the near end only.** The plan said "the
   last 90 days"; a skip or a move made for TODAY or for a day still ahead is
   invisible everywhere else in the app (the agenda drops skipped instances), so
   excluding it left the most undo-able action of all with no undo. Past days
   still come from the projection, which is what supplies "Propušteno".
8. **`ponavljanjaLabel` added to `utils/plural.ts`** for "2 ponavljanja čeka na
   odgovor".
9. **Browser verification could not use the in-app preview pane** - clicks time
   out there (the pane reports itself hidden). Driven with Playwright from the
   scratchpad instead, the recipe from `project_readme_screenshot_recipe`.
10. **A locked circle now looks locked and says why** (maintainer, second
    review). Section 6 only said "disabled"; a disabled circle was drawn exactly
    like a live one and swallowed the tap, so the rule was unguessable. It is
    now dashed with a padlock, and a tap answers - "Još nije na redu - može se
    završiti 16.08.2026." or "Ovo mogu da završe samo oni kojima je zadatak
    dodeljen."
    The mechanism matters: while there is a reason to give, the input carries
    `aria-disabled` rather than `disabled`. A truly disabled input cannot be
    focused and fires no events, so it could neither be reached by a keyboard
    nor deliver the explanation; the input is controlled, so the tick still
    never flips. A click handler on the wrapping `<label>` was the first attempt
    and is not allowed - `jsx-a11y(click-events-have-key-events)` fails
    `pnpm check`, correctly.
11. **The backlog's circles read the viewer's own slot** (maintainer, third
    review). They were hard-coded to `done={false}`, which was wrong the moment
    the list holds a `per_assignee` day: such a day stays owed until EVERYBODY
    has ticked, so it sits there with the viewer's own part already finished,
    showing an empty ring that invited a tap which re-sent "finish it" and
    changed nothing. The circle now reads `isTaskDoneOn(..., personId)` and the
    tap sends the state being asked for, so it unticks as well as ticks.
12. **A move onto its own date is not reported as a move.** Moving an occurrence
    and moving it back leaves a row whose `moved_to_date` equals its
    `occurrence_date`; the history read "15.08.2026 - Pomereno na 15.08.2026".
    Such a row now resolves to "nothing happened", and an entry that says
    nothing about a day that has not passed is dropped rather than called
    "Propušteno" (which would be a lie about a day nobody has missed yet).

## 12. Definition of done

- `pnpm check` and the full test suite green, including with `.env` moved away.
- The parity test green after section 5.
- Verified in the browser preview against local Supabase, on a daily recurring
  task assigned to three people in `per_assignee` mode (the maintainer's "Test
  za Jelenu" shape):
  1. tomorrow's circle is disabled, today's is not;
  2. skipping today asks first, names all three, and is undoable from both the
     toast and the sheet;
  3. after skipping, the day appears under "Istorija" as `Preskočeno` with the
     actor's name, and "Vrati" brings it back to the agenda;
  4. leaving two past instances unresolved produces exactly one "Prekoračeno"
     row reading `kasni 2`, dated to the older one.
- The maintainer's existing skipped occurrence of 14.08.2026 is reachable and
  restorable through the new history view (it is still in the database).
