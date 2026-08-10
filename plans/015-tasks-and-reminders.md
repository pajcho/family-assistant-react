# 015 - Tasks and reminders (one `tasks` entity, plus kid chores)

**Status:** IN PROGRESS
**Priority:** P1 (feature)
**Effort:** XL
**Depends on:** nothing (branches from `main`)
**Branch:** `feat/tasks-and-reminders` - everything lands as ONE pull request.

Design documents this plan implements (read them if a decision here seems
arbitrary; they carry the alternatives that were rejected):

- Model plan: <https://claude.ai/code/artifact/8e685f64-aac3-4af4-b5bb-dc48b49e771a>
- Screen redesign: <https://claude.ai/code/artifact/367ea4a3-4e55-431f-8230-9bb747637122>

Writing rules for this repo, enforced by `pnpm check`: no em dash, no en dash,
no Unicode minus anywhere - ASCII `-` only. Comments, identifiers, migrations,
commit messages and docs are English; Serbian appears only inside string
literals a person reads.

---

## 1. What this builds

`list_items` is today the only completable entity in the codebase and it is
missing exactly one thing: a date. This plan renames it to `tasks`, makes every
new dimension optional, and teaches the agenda layer about it.

| Dimension | Column(s)         | Filled in means                              | Null means                  |
| --------- | ----------------- | -------------------------------------------- | --------------------------- |
| Container | `list_id`         | Lives inside a list, inherits its visibility | Standalone, shows in Inbox  |
| When      | `due_date`        | Appears in Danas, Kalendar, digests          | Someday, list only          |
| Clock     | `due_time`        | Sorts into the day timeline at that minute   | All-day bucket for its date |
| Who       | `task_assignees`  | Person filter, member badges, kid visibility | Family-wide, nobody's       |
| Repeat    | `recurrence_*`    | Projected + ticked per occurrence            | One-off, ticked once        |
| Nag       | `remind_*_before` | Push before it is due                        | Silent, digest only         |

So: a shopping item is `list_id` only (unchanged from today), a reminder is
`due_date`, a chore is `due_date` + recurrence + an assignee.

## 2. Decisions already locked (do not re-open)

1. One word for the entity: **Zadatak / Zadaci**. "Podsetnik" keeps meaning the
   notification, as it already does in the payment, event and activity forms.
2. The nav section is relabelled **Zadaci**; the route becomes `/tasks` and
   `/lists` is **deleted with no redirect**.
3. RLS on `tasks` is a **two-arm predicate**, not a denormalized scope. See 4.3.
4. Completion truth **splits on recurrence** and a CHECK constraint enforces it.
   See 4.4.
5. `completed_by_person_id` references `profiles`, never `auth.users`.
6. Overdue: **one-offs carry over** into the overdue block, **repeats do not**.
7. Kid chores are in this PR, not deferred.
8. `completion_mode` ships in the first migration and is used immediately.
9. Auto-delete of completed items keeps applying only to **undated** items in
   lists that have retention set, and never touches anything with a `due_date`
   or an occurrence row.
10. The index screen shows dated tasks above the lists grid.
11. The composer is bottom-pinned below `lg`, inline after the last row at `lg`.

## 3. Work breakdown and file ownership

Executed as one branch by several agents. **Stay inside your area's file list**;
if you need something from another area, code against the contract in this
document rather than editing their files.

| Stage | Area                     | Owns                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B     | Foundation (first, solo) | all migrations, `types/database.ts`, `utils/task.ts` (+ tests), `hooks/useTasks.ts`, `hooks/useTaskOccurrences.ts`, `hooks/useOverdueTasks.ts`, `hooks/useAgenda.ts`, `utils/agendaFilters.ts`, `components/dashboard/agendaKindMeta.ts`, `hooks/useFamilyChannel.ts`, `styles`, plus the `list_items` -> `tasks` rename through existing `components/lists/*` |
| C1    | Agenda surfaces          | `components/dashboard/AgendaItemRow.tsx`, `AgendaDetailDialogs.tsx`, `OverdueSection.tsx`, `agendaCalendarShared.tsx`, `AgendaDayCalendar`/`AgendaWeekCalendar` placement, `components/common/ItemCard.tsx`, `components/tasks/TaskDetailSheet.tsx`, `components/tasks/TaskRow.tsx`                                                                            |
| C2    | Kid chores               | `components/kid/*`, `components/family/KidAccessCopy.ts` (+ its test), `hooks/useKidTasks.ts`                                                                                                                                                                                                                                                                  |
| C3    | Notifications            | `supabase/functions/send-due-pushes/*`, `supabase/functions/notify-on-create/*`, `components/settings/NotificationsSection.tsx`, `hooks/useNotificationPreferences.ts`                                                                                                                                                                                         |
| D     | Zadaci screens           | `routes/_app.tasks*.tsx` (renamed from `_app.lists*`), `components/tasks/*` except the two C1 owns, `components/lists/*` (moved/retired), `components/layout/navSections.ts`, `components/search/GlobalSearchDialog.tsx`, `components/common/GlobalAddSheet.tsx`                                                                                               |
| E     | Integration              | whole-tree fixes, `pnpm check`, `pnpm test`, `pnpm build`, browser verification                                                                                                                                                                                                                                                                                |

C1, C2 and C3 are file-disjoint and run in parallel after B. D runs after C1
because it imports `TaskDetailSheet`.

---

## 4. Database

One migration for the model, one for kid access, one for the notification
preference. Timestamps must sort after `20260810000000_english_db_comments.sql`.

### 4.1 `supabase/migrations/20260811000000_tasks.sql`

```sql
-- list_items becomes tasks: same rows, same ids, same FKs.
ALTER TABLE list_items RENAME TO tasks;
ALTER TABLE tasks ALTER COLUMN list_id DROP NOT NULL;

ALTER TABLE tasks
  ADD COLUMN owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'family'
    CHECK (scope IN ('personal', 'family')),
  ADD COLUMN due_date DATE,
  ADD COLUMN due_time TIME,
  ADD COLUMN recurrence_period TEXT
    CHECK (recurrence_period IN ('one-time', 'daily', 'weekly', 'monthly')),
  ADD COLUMN recurrence_interval INTEGER NOT NULL DEFAULT 1
    CHECK (recurrence_interval BETWEEN 1 AND 52),
  -- Weekly only. 0 = Monday .. 6 = Sunday, the same convention as
  -- activity_schedule.day_of_week. NEVER store a raw JS getDay().
  ADD COLUMN recurrence_weekdays SMALLINT[],
  ADD COLUMN recurrence_until DATE,
  ADD COLUMN completion_mode TEXT NOT NULL DEFAULT 'shared'
    CHECK (completion_mode IN ('shared', 'per_assignee')),
  ADD COLUMN completed_by_person_id UUID
    REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN remind_minutes_before INTEGER,
  ADD COLUMN remind_days_before INTEGER;

-- A listless task carries its own visibility anchor; a task in a list
-- inherits the list's. Enforced so neither arm of the RLS policy can see a
-- row with nothing to key on.
ALTER TABLE tasks ADD CONSTRAINT tasks_visibility_anchor
  CHECK (list_id IS NOT NULL OR owner_id IS NOT NULL);

-- A repeating task is resolved per occurrence in task_occurrences, so its own
-- is_completed must stay false. This is the structural half of decision 4.
ALTER TABLE tasks ADD CONSTRAINT tasks_recurring_not_completed
  CHECK (
    recurrence_period IS NULL
    OR recurrence_period = 'one-time'
    OR is_completed = false
  );

-- A time without a date is meaningless.
ALTER TABLE tasks ADD CONSTRAINT tasks_time_needs_date
  CHECK (due_time IS NULL OR due_date IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_tasks_family_due ON tasks(family_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id);
```

Rename the existing indexes, triggers and policies that still say `list_item`.
Postgres carries them across the table rename under their old names, so rename
them explicitly for readability:

```sql
ALTER INDEX idx_list_items_list_id RENAME TO idx_tasks_list_id;
ALTER INDEX idx_list_items_family_id RENAME TO idx_tasks_family_id;
ALTER INDEX idx_list_items_list_sort RENAME TO idx_tasks_list_sort;
```

`set_list_item_defaults()` becomes `set_task_defaults()` and must additionally:

- fill `family_id` from the parent list when `list_id` is set, otherwise from
  the caller's profile;
- fill `owner_id` with `auth.uid()` when it is null;
- when `list_id` is set, **force** `scope` to the parent list's scope, so a
  family list can never hold a personal task.

Add an `AFTER UPDATE OF scope ON lists` trigger that re-stamps `tasks.scope` for
that list's rows, and extend the BEFORE UPDATE trigger on `tasks` to re-derive
`scope` when `list_id` changes.

`bump_parent_list_on_item_change()` must no-op when the task has no `list_id`
(guard both `OLD.list_id` and `NEW.list_id`).

The auto-delete-completed cron predicate gains `AND due_date IS NULL AND NOT
EXISTS (SELECT 1 FROM task_occurrences o WHERE o.task_id = tasks.id)` (decision
9). Find it in `20260520240000_lists_auto_delete_completed.sql`.

### 4.2 New tables

```sql
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id UUID NOT NULL
    REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (task_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_person ON task_assignees(person_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_family ON task_assignees(family_id);

CREATE TABLE IF NOT EXISTS task_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  -- NULL = the occurrence as a whole (completion_mode 'shared'); set = this
  -- person's own copy (completion_mode 'per_assignee').
  person_id UUID REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('done', 'skipped', 'moved')),
  moved_to_date DATE,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by_person_id UUID
    REFERENCES profiles(id) ON DELETE SET NULL ON UPDATE CASCADE,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (status <> 'moved' OR moved_to_date IS NOT NULL),
  UNIQUE NULLS NOT DISTINCT (task_id, occurrence_date, person_id)
);

CREATE INDEX IF NOT EXISTS idx_task_occurrences_task ON task_occurrences(task_id);
CREATE INDEX IF NOT EXISTS idx_task_occurrences_family_date
  ON task_occurrences(family_id, occurrence_date);
```

`UNIQUE NULLS NOT DISTINCT` needs Postgres 15+, which Supabase provides. Add a
BEFORE INSERT trigger filling `family_id` from the parent task.

### 4.3 RLS

Grown-up policies on `tasks` - two arms, so rows inside a list keep exactly
today's visibility and listless rows key off their own scope:

```sql
CREATE POLICY "Users view accessible tasks" ON tasks FOR SELECT USING (
  (list_id IS NOT NULL AND EXISTS (SELECT 1 FROM lists WHERE lists.id = tasks.list_id))
  OR (list_id IS NULL AND (
        (scope = 'family' AND family_id = auth_user_family_id())
        OR (scope = 'personal' AND owner_id = auth.uid())
     ))
);
```

INSERT / UPDATE / DELETE mirror it. `task_assignees` and `task_occurrences`
piggy-back on `tasks` through `EXISTS (SELECT 1 FROM tasks WHERE id = ...)`,
exactly like `list_items` piggy-backed on `lists`.

### 4.4 Completion truth

- **Non-recurring** task (`recurrence_period` null or `'one-time'`): the truth
  is `tasks.is_completed` / `completed_at` / `completed_by_person_id`. This is
  the path the shipped lists UI already writes; do not change it.
- **Recurring** task: the truth is a `task_occurrences` row per
  `(task_id, occurrence_date, person_id)`. No row means unresolved.

`isTaskDoneOn()` in `utils/task.ts` is the only place allowed to know this.

### 4.5 `supabase/migrations/20260811010000_kid_tasks.sql`

Kid mode is SELECT-only by design. Read the header comment of
`20260808000000_kid_mode.sql` before touching this.

```sql
-- A child sees a task only when it is assigned to them.
CREATE POLICY "Kid can view own task_assignees" ON task_assignees FOR SELECT
  USING (person_id = public.kid_profile_id());

CREATE POLICY "Kid can view own tasks" ON tasks FOR SELECT USING (
  family_id = public.kid_family_id()
  AND EXISTS (
    SELECT 1 FROM task_assignees ta
    WHERE ta.task_id = tasks.id AND ta.person_id = public.kid_profile_id()
  )
);

CREATE POLICY "Kid can view own task_occurrences" ON task_occurrences FOR SELECT
  USING (
    family_id = public.kid_family_id()
    AND EXISTS (
      SELECT 1 FROM task_assignees ta
      WHERE ta.task_id = task_occurrences.task_id
        AND ta.person_id = public.kid_profile_id()
    )
  );
```

The only write a child may make. Modelled on `kid_set_theme()`; no kid INSERT /
UPDATE policy is added anywhere.

```sql
CREATE OR REPLACE FUNCTION public.kid_complete_task(
  p_task_id UUID,
  p_date DATE,
  p_done BOOLEAN DEFAULT true
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile UUID := public.kid_profile_id();
  v_family UUID := public.kid_family_id();
  v_recurring BOOLEAN;
  v_mode TEXT;
BEGIN
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'not a kid session';
  END IF;

  -- A child may only resolve today or yesterday, so a forgotten week cannot be
  -- backfilled in one tap.
  IF p_date < CURRENT_DATE - 1 OR p_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'date outside the allowed window';
  END IF;

  SELECT
    t.recurrence_period IS NOT NULL AND t.recurrence_period <> 'one-time',
    t.completion_mode
  INTO v_recurring, v_mode
  FROM tasks t
  JOIN task_assignees ta ON ta.task_id = t.id
  WHERE t.id = p_task_id
    AND t.family_id = v_family
    AND ta.person_id = v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not assigned to this child';
  END IF;

  IF v_recurring THEN
    IF p_done THEN
      INSERT INTO task_occurrences (
        task_id, family_id, occurrence_date, person_id, status,
        completed_at, completed_by_person_id
      )
      VALUES (
        p_task_id, v_family, p_date,
        CASE WHEN v_mode = 'per_assignee' THEN v_profile ELSE NULL END,
        'done', NOW(), v_profile
      )
      ON CONFLICT (task_id, occurrence_date, person_id) DO UPDATE
        SET status = 'done',
            completed_at = NOW(),
            completed_by_person_id = v_profile;
    ELSE
      DELETE FROM task_occurrences
      WHERE task_id = p_task_id
        AND occurrence_date = p_date
        AND person_id IS NOT DISTINCT FROM
          (CASE WHEN v_mode = 'per_assignee' THEN v_profile ELSE NULL END)
        AND status = 'done';
    END IF;
  ELSE
    UPDATE tasks
      SET is_completed = p_done,
          completed_at = CASE WHEN p_done THEN NOW() ELSE NULL END,
          completed_by_person_id = CASE WHEN p_done THEN v_profile ELSE NULL END
      WHERE id = p_task_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.kid_complete_task(UUID, DATE, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kid_complete_task(UUID, DATE, BOOLEAN) TO authenticated;
```

### 4.6 Realtime

Add `tasks`, `task_assignees` and `task_occurrences` to the family broadcast
trigger (follow `20260809130000_broadcast_missing_tables.sql`) **and** to
`TABLE_INVALIDATIONS` in `src/hooks/useFamilyChannel.ts`. Drop the `list_items`
entry. Missing either half means other devices go stale with no error.

### 4.7 `supabase/migrations/20260811020000_notify_task_create.sql`

`ALTER TABLE notification_preferences ADD COLUMN notify_on_task_create BOOLEAN
NOT NULL DEFAULT true;` plus the create-push trigger for `tasks`, following
`20260809140000_notify_family_lists_only.sql`: a **personal-scope task must not
notify the family**.

---

## 5. Types (`src/types/database.ts`)

```ts
export type TaskScope = "personal" | "family";
export type TaskRecurrencePeriod = "one-time" | "daily" | "weekly" | "monthly";
export type TaskCompletionMode = "shared" | "per_assignee";
export type TaskOccurrenceStatus = "done" | "skipped" | "moved";

export interface Task {
  id: string;
  /** Null for a standalone task - it lands in the Inbox smart list. */
  list_id: string | null;
  family_id: string;
  owner_id: string | null;
  scope: TaskScope;
  name: string;
  description: string | null;
  /** Truth for non-recurring tasks only. See utils/task.ts::isTaskDoneOn. */
  is_completed: boolean;
  completed_at: string | null;
  completed_by_person_id: string | null;
  due_date: string | null;
  /** "HH:MM:SS" from Postgres; normalize with normalizeTime before display. */
  due_time: string | null;
  recurrence_period: TaskRecurrencePeriod | null;
  recurrence_interval: number;
  /** 0 = Monday .. 6 = Sunday, matching activity_schedule.day_of_week. */
  recurrence_weekdays: number[] | null;
  recurrence_until: string | null;
  completion_mode: TaskCompletionMode;
  remind_minutes_before: number | null;
  remind_days_before: number | null;
  sort_order: number;
  created_by_id: string | null;
  updated_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskAssignee {
  task_id: string;
  person_id: string;
  family_id: string;
}

export interface TaskOccurrence {
  id: string;
  task_id: string;
  family_id: string;
  occurrence_date: string;
  person_id: string | null;
  status: TaskOccurrenceStatus;
  moved_to_date: string | null;
  completed_at: string | null;
  completed_by_person_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** A list with its tasks, from the nested select. */
export interface ListWithTasks extends List {
  tasks: Task[];
}
```

`ListItem` and `ListWithItems` are deleted. Keep `List` and `ListScope` as they
are - lists themselves do not change.

---

## 6. `src/utils/task.ts`

Pure, total, and **it must not import anything that reaches `lib/supabase`** -
CI has no Supabase env and the import chain is what breaks there (see
`project_ci_no_supabase_env`). Reuse `addWeek`, `addMonthAnchored` and
`formatDate` from `utils/date.ts`, and `toMondayFirstDow` from
`utils/activity.ts`.

```ts
/** True when this task repeats. One-time and null both mean "does not". */
export function isRecurringTask(task: Pick<Task, "recurrence_period">): boolean;

export interface TaskOccurrenceInstance {
  /** The series date this instance came from. */
  occurrenceDate: string;
  /** Where it actually shows - occurrenceDate unless an override moved it. */
  effectiveDate: string;
  /** Resolved state for this instance, if any row exists. */
  occurrence: TaskOccurrence | undefined;
  isDone: boolean;
  isSkipped: boolean;
}

/**
 * Every instance of `task` that falls in [from, to], inclusive.
 *
 * Mirrors expandPaymentOccurrences' signature on purpose so the useAgenda arm
 * reads like its neighbours. A non-recurring task yields at most one instance
 * (its due_date). A recurring task walks its rule from due_date (the series
 * anchor) to min(to, recurrence_until), skipping instances a 'moved' override
 * relocated and emitting them at their new date instead.
 */
export function expandTaskOccurrences(
  task: Task,
  from: string,
  to: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
): TaskOccurrenceInstance[];

/** `${taskId}|${occurrenceDate}` - the key shape useTaskOccurrences returns. */
export function taskOccurrenceKey(taskId: string, occurrenceDate: string): string;

/**
 * The single place that knows completion has two homes: is_completed for a
 * non-recurring task, a task_occurrences row for a recurring one. `personId`
 * matters only for completion_mode 'per_assignee'.
 */
export function isTaskDoneOn(
  task: Task,
  date: string,
  occurrencesByKey: Map<string, TaskOccurrence[]>,
  personId?: string | null,
): boolean;

/** Unfinished, non-recurring, and its due date already passed. */
export function isTaskOverdue(task: Task, today: string): boolean;

/** A past recurring instance nobody resolved - shown struck, never carried over. */
export function isMissedOccurrence(instance: TaskOccurrenceInstance, today: string): boolean;

/** "Svaki dan", "Radnim danima", "Svake 2 nedelje", "Mesecno"... */
export function taskRecurrenceLabel(task: Task): string | null;
```

Recurrence walking rules:

- `daily`: every `recurrence_interval` days from `due_date`.
- `weekly`: if `recurrence_weekdays` is set, every listed weekday in every
  `recurrence_interval`-th week counted from `due_date`'s week; otherwise every
  `recurrence_interval` weeks on `due_date`'s weekday. Monday-first indexes.
- `monthly`: `addMonthAnchored` from `due_date`, anchored on its day of month,
  so the 31st does not drift.
- Stop at `recurrence_until` when set. Cap the walk at 366 instances as a
  runaway guard.

Tests go in `src/utils/__tests__/task.test.ts`. Cover: interval walking on all
three periods, weekday sets, month anchoring on 31st, `recurrence_until`
inclusivity, moved / skipped / done overrides, `per_assignee` vs `shared`
resolution, and the overdue + missed predicates.

---

## 7. Hooks

`src/hooks/useTasks.ts` replaces `useLists.ts`'s item half. Keep every existing
optimistic-update pattern (temp-id prefix, `applyItemOrdering`, rollback in
`onError`, invalidate in `onSettled`) - it is load-bearing for how the list
feels.

```ts
useListsWithTasks(); // lists + nested tasks, replaces useListsWithItems
useTasksList(); // flat family task list, for the agenda + smart lists
useCreateTask(); // list_id optional; accepts date/time/assignees/recurrence
useUpdateTask();
useDeleteTask();
useToggleTask(); // routes to is_completed or an occurrence row
useReorderTasks();
useClearCompletedTasks();
useCopyTasks();
```

`useToggleTask` is the important one: given `(task, date, personId?)` it either
flips `tasks.is_completed` (non-recurring, keeping the existing `completed_at`
stamping) or upserts / deletes a `task_occurrences` row. It must be optimistic
in both shapes.

`src/hooks/useTaskOccurrences.ts` exposes `{ byKey: Map<string, TaskOccurrence[]> }`
keyed by `taskOccurrenceKey`, plus mutations for skip and move.

`src/hooks/useTaskAssignees.ts` exposes `{ byTask: Map<string, string[]> }`,
copying `useEventParticipants` exactly.

`src/hooks/useOverdueTasks.ts` mirrors `useOverduePayments`: unfinished
non-recurring tasks whose `due_date` is before `useToday().str`, as
`AgendaItem`s with `sortKey: 0`, oldest first. Add
`src/hooks/useOverdueItems.ts` that concatenates payments and tasks and sorts by
date, so `OverdueSection` takes one list.

Query keys follow the existing family-scoped convention:
`["tasks", familyId]`, `["task_occurrences", familyId]`,
`["task_assignees", familyId]`, and `["lists", familyId]` stays for
lists-with-tasks.

---

## 8. Agenda integration

New arm in `AgendaItem` (`src/hooks/useAgenda.ts`):

```ts
| {
    kind: "task";
    date: string;            // effectiveDate of this instance
    sortKey: number;
    task: Task;
    occurrenceDate: string;
    /** Normalized HH:mm, or null for an all-day task. */
    dueTime: string | null;
    assigneeIds: string[];
    isDone: boolean;
    /** Past recurring instance nobody resolved. */
    missed: boolean;
  }
```

- `agendaItemKey`: `task-${task.id}-${item.occurrenceDate}`.
- Sort buckets get renumbered so an untimed task sits right after all-day
  events and above birthdays and payments:
  `ALL_DAY = 1441`, `TASK = 1442`, `BIRTHDAY = 1443`, `PAYMENT = 1444`.
  Two existing tests hardcode 1442/1443 (`utils/__tests__/agendaFilters.test.ts`,
  `components/kid/__tests__/kidAgendaModel.test.ts`) - update them.
- A timed task uses `timeToMin(dueTime)`.
- Skipped instances are dropped. Done instances stay (rendered ticked) so a row
  does not vanish from under the thumb.
- `AGENDA_KINDS` in `utils/agendaFilters.ts` gains `"task"` after `"activity"`;
  `agendaItemPersonIds` returns `assigneeIds`.
- `AGENDA_KIND_META.task`: `{ label: "Zadaci", icon: CheckCircleIcon, tone: "task", dot: "var(--task)" }`.

A **new semantic tone** `task` is added rather than reusing an existing one -
activities own accent, events info, payments warn, birthdays pos. Add `--task`
and `--task-soft` to `src/styles` for both light and dark, wire `"task"` into
`ItemTileTone` and `TILE_TONE` in `components/common/ItemCard.tsx`. Pick a
violet / indigo that is not the default accent blue and reads on both grounds.

---

## 9. Agenda row and detail (area C1)

**The row.** `AgendaItemRow` gains a `TaskRow` whose leading slot is a
completion circle instead of a glyph tile. Nested interactive elements are
invalid, so follow `ListItemRow`'s existing markup: the control is a
`<label>` / `<button>` **sibling** of the row button, never a child. Give
`ItemCard` an optional `leading` slot for this and leave every other caller
untouched.

- Circle tap: complete / uncomplete via `useToggleTask`, no navigation.
- Row tap: open `TaskDetailSheet`.
- Done: strike the title and dim the card (the `done` treatment already used by
  `ListItemRow`).
- Missed: `Pill tone="neg"` reading `propušteno`.
- Trailing slot: `dueTime` when timed, empty otherwise.
- Meta line: recurrence label, assignee badges (`MemberBadges`), and the list
  name when the row is shown outside its list.

**The detail sheet.** `components/tasks/TaskDetailSheet.tsx`, following the
DetailSheet convention (details first, then actions as rows, primary first,
Obriši last):

| Row                      | Behaviour                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Označi kao završeno      | Primary. Toggles; label flips to `Vrati u aktivne` when done.                                                               |
| Pomeri na sutra          | Recurring: `moved` occurrence. One-off: updates `due_date`.                                                                 |
| Izaberi datum            | Same, with a picker.                                                                                                        |
| Preskoči ovo ponavljanje | Recurring only: `skipped` occurrence.                                                                                       |
| Izmeni                   | Opens the task form.                                                                                                        |
| Obriši                   | Destructive, last. Recurring asks `samo ovo ponavljanje` / `cela serija`, using the same copy shape as `paymentCancelCopy`. |

Detail rows above the actions: Kada, Ponavljanje, Za koga, Podsetnik, Lista.

Also in C1: place tasks in `AgendaDayCalendar` and `AgendaWeekCalendar` - timed
tasks at their minute as a marker (not a sized block; a reminder is a point in
time), untimed ones in the all-day strip. Merge `useOverdueItems` into
`OverdueSection`. Route `kind: "task"` in `AgendaDetailDialogs`.

---

## 10. Zadaci screens (area D)

The screen redesign document is the spec. Summary of what changes:

**Route rename, no redirect.** `_app.lists.tsx` -> `_app.tasks.tsx`,
`_app.lists.index.tsx` -> `_app.tasks.index.tsx`, `_app.lists.$listId.tsx` ->
`_app.tasks.$listId.tsx`, plus a new `_app.tasks.$smartList.tsx` or a
`?view=` param for the smart lists - your call, but keep deep-links working.
Delete `/lists` entirely. Then:

- `navSections.ts`: `{ key: "tasks", to: "/tasks", label: "Zadaci", icon: ClipboardDocumentCheckIcon }`,
  and add `lists: "tasks"` to `LEGACY_KEY_MAP` so a customized bottom bar keeps
  its slot. Update `sectionForPathname` and the four assertions in
  `components/layout/__tests__/navSections.test.ts`.
- `GlobalSearchDialog.tsx` and `useGlobalSearch.ts`: navigate to
  `/tasks/$listId`, and search tasks not list_items.
- `GlobalAddSheet.tsx`: a **full-width `Zadatak` row** directly under
  `Skeniraj račun`, keeping the two-column grid at six tiles. New
  `components/tasks/TaskQuickAddFlow.tsx`.
- `ListQuickAddFlow.tsx` navigation target.

**The index** (`/tasks`): person rail (`MemberFilterChips`), a stat strip
(Kasni / Danas / Nedelja, where Kasni is hidden at zero), then Kasni / Danas /
Sutra sections of tickable rows, then the lists as a two-column grid with a
count, a thin progress bar, one honest meta line and a dashed `Nova lista`
tile. Render the grid from cache immediately and let the dated sections fill in.

**A list** (`/tasks/$listId`): serif title, `porodična · N aktivna · N sa
datumom` sub-line, a labelled **grouping selector** (Ručni redosled / Po datumu
/ Po rafovima / Po osobi) replacing the sparkles icon, day groups when grouping
by date, a `Završeno danas (N) · ranije (N)` disclosure, and the composer.
Delete both permanent gesture hint paragraphs.

**Smart lists**: one screen component, four sources - Kasni, Zakazano, Meni
dodeljeno, Inbox. Pure client-side selections over the same cache. Rows carry
their list name as meta.

**The composer** (`components/tasks/TaskComposer.tsx`): one field until you
type, then a quick row - Danas / Sutra / next weekday / Datum / Za koga /
Ponavljanje / Podsetnik. The first three set `due_date` inline; the rest open
SheetStack sub-views (new overlay on top with a back arrow, per
`project_sheet_stack_pattern`). Bottom-pinned below `lg`, inline after the last
row at `lg` and up.

**Desktop**: keep the resizable split untouched. The sidebar lists smart lists
with counts first, then the lists, then `Nova lista`. Scope becomes the glyph on
each row; the scope chip row goes.

Keep unchanged: swipe gestures, drag reorder, the item dialog, export,
duplicate, the info panel, and last-opened-list memory.

---

## 11. Kid chores (area C2)

- `hooks/useKidTasks.ts`: tasks assigned to `kid_profile_id()` for a date range,
  plus a `completeTask` mutation calling `kid_complete_task` via
  `supabase.rpc`. **Never** write to `tasks` or `task_occurrences` directly from
  the kid shell - there is no policy for it and there must not be.
- `KID_AGENDA_KINDS` in `components/kid/kidAgendaModel.ts` gains `"task"`.
  Extend `kidAgendaModel` with a task card model (emoji, title, the recurrence
  as friendly copy, no list names, no amounts) and a detail model.
- `components/kid/kidEmoji.ts`: an emoji for tasks.
- The kid Danas / Uskoro views render a big tappable card with the circle; a
  completed one gets a satisfying state. No reward or streak system in this PR.
- `components/family/KidAccessCopy.ts` currently promises a child never sees
  lists or reminders. That sentence is now false - rewrite it to say a child sees
  the chores assigned to them and can tick them off, and nothing else about
  lists or money. Update the assertion in
  `components/family/__tests__/KidAccessSection.test.tsx`.

---

## 12. Notifications (area C3)

- `send-due-pushes`: a sixth source. It must count tasks in the morning and
  evening digests, not only fire reminders, or the digest disagrees with what
  Danas shows (`project_digest_agenda_parity`). Recurrence expansion has to be
  duplicated in Deno the way `_shared/expandEvent.ts` is - put it in
  `_shared/expandTask.ts` with its own test.
- Service-role reads bypass RLS, so re-apply the personal-scope rule in code:
  a personal task belongs to its `owner_id` only
  (`project_service_role_bypasses_rls`).
- Reminder offsets: `remind_minutes_before` for timed tasks,
  `remind_days_before` for all-day ones, matching how events and payments
  already work.
- `notify-on-create`: add `task`, and change the list deep-link from
  `/lists/${id}` to `/tasks/${id}`. **This function must be deployed in the same
  release as the route rename** or every new push opens a 404.
- `NotificationsSection.tsx` + `useNotificationPreferences.ts`: the
  `notify_on_task_create` toggle.

---

## 13. Conventions and traps

- No em dash, en dash or Unicode minus. `pnpm check` fails on them.
- English identifiers, English DB values (`weekly`, `skipped`, `shared`);
  Serbian only in user-visible strings.
- Weekday indexes are **0 = Monday**. Use `toMondayFirstDow`, never a raw
  `getDay()`.
- Never read `new Date()` inside a frozen memo for "today" - use `useToday()`.
- Only one `useAgenda` may be mounted at a time.
- Do not run `supabase db reset` - it destroys the maintainer's local data.
  Apply migrations with `supabase migration up`.
- Tests must not import a module chain that reaches `lib/supabase`.
- Do not rename the CI job in `ci.yml`; the branch protection ruleset matches it
  by name and every merge would block.
- Dialog button labels: `Odustani` dismisses a form, `Otkaži [X]` cancels a
  domain action, `Zatvori` closes a read-only view, `Nazad` goes back a
  sub-view.
- Font weights: title bold, row semibold, description and value normal, nothing
  heavier than bold.
- A sheet is only as tall as its content.

## 13b. Notes from execution - read these, they override the plan

Findings from stages already done. Where one contradicts an earlier section,
this section wins.

1. **The planned RLS deadlocked the table.** The kid policy on `tasks` reads
   `task_assignees`, and permissive policies are OR-ed, so making
   `task_assignees` piggy-back on `tasks` made every read of `tasks` - by
   parents too - fail with `infinite recursion detected in policy`.
   `task_assignees` is therefore family-keyed through `auth_user_family_id()`,
   naming no table at all. Do not "simplify" it back.
2. **Write policies must demand `auth_user_family_id()`.** Without it a kid
   session satisfied the listless-personal arm and could write
   `task_occurrences` directly, bypassing `kid_complete_task` and its date
   window. A child has no `profiles` row, so the helper is NULL for them and the
   arm closes.
3. **`kid_complete_task`'s date window is deliberately a day wide on each side**
   (`CURRENT_DATE - 2` .. `CURRENT_DATE + 1`). `CURRENT_DATE` is the database's
   UTC date while the child's device sends a local date; in Belgrade summer time
   they disagree between local midnight and 02:00. Do not tighten it without
   converting to the family's timezone first.
4. **Only a DATED family task fires a create push.** A bare scope check would
   send ten notifications for ten groceries. The trigger's WHEN clause carries
   `NEW.due_date IS NOT NULL`.
5. **The recurrence engine exists twice and a parity test binds them.**
   `supabase/functions/_shared/expandTask.parity.test.ts` compares
   `src/utils/task.ts` against `supabase/functions/_shared/expandTask.ts` over
   600 generated series. It must stay green: if it fails, the morning digest and
   the Danas screen are about to disagree in somebody's hand. Changing either
   engine means running it.
6. **`TASK_WINDOW_DAYS_AFTER = 14` in `send-due-pushes/plan.ts`** mirrors
   payments, so an all-day task whose `remind_days_before` exceeds 14 never
   fires. Keep the form's reminder presets at 14 days or below, or raise both
   constants together.
7. **Reminder pushes go to every push-subscribed family member**, not only to
   assignees. `task_assignees` says who a chore is FOR - often a child with no
   login at all - not who should be told about it.
8. **`isTaskDoneOn` takes the SERIES date**, never the effective date. A moved
   occurrence is still ticked under the date the series says it belongs to.
9. **`instance.isDone` is only meaningful for `completion_mode: 'shared'`.** For
   `'per_assignee'` the row layer must call
   `isTaskDoneOn(task, instance.occurrenceDate, byKey, personId)`.
10. **`scripts/seed-demo.ts` is typechecked** by `tsconfig.node.json`, so it is
    part of `pnpm build`. It now seeds every task shape, and it is what the
    README screenshots are captured against.
11. **Still outstanding from stage C3:** the `notify_on_task_create` toggle in
    `components/settings/NotificationsSection.tsx` and
    `hooks/useNotificationPreferences.ts`.

## 14. Definition of done

1. `pnpm check` passes (format, lint, dashes, typecheck).
2. `pnpm test` passes, including new tests for `utils/task.ts`,
   `_shared/expandTask.ts`, and the updated agenda / nav / kid-copy assertions.
3. `pnpm build` passes.
4. Migrations apply cleanly to the local database with `supabase migration up`.
5. No reference to `list_items`, `ListItem`, `ListWithItems` or `/lists`
   survives anywhere in `src/` or `supabase/`.
6. Verified in the browser preview on port 5173: create a plain list item, a
   dated reminder, and a recurring chore with an assignee; see the dated ones on
   Danas and in Kalendar; tick one from Danas and from the list; check the
   overdue block; confirm the shopping list still groups by aisle.
7. One commit series on `feat/tasks-and-reminders`, one pull request.
