# 016 - Lists findable again (segment, scope, recency, remembered quick add)

**Status:** DONE (2026-08-12, on `feat/tasks-and-reminders` itself rather than
its own branch - see section 13 for what was executed and where it deviated)
**Priority:** P1 (UX regression from 015)
**Effort:** M
**Depends on:** 015 - every file below only exists on `feat/tasks-and-reminders`.
Branch from that branch while PR #134 is open, or from `main` once it merges.
**Branch:** `feat/lists-findability` - one pull request.

Writing rules for this repo, enforced by `pnpm check`: no em dash, no en dash,
no Unicode minus anywhere - ASCII `-` only. Comments, identifiers, migrations,
commit messages and docs are English; Serbian appears only inside string
literals a person reads.

---

## 1. The problem

015 inverted `/tasks`: dated work on top, lists demoted to a grid underneath.
The dated half is right. The lists half regressed for the most frequent job a
household has - "open the app, put milk on the shopping list":

1. **The grid starts about a screenful down.** Header, stat strip and up to
   three dated sections of five rows each sit above
   [TasksIndexScreen.tsx:215](../src/components/tasks/TasksIndexScreen.tsx#L215).
   With 10+ lists it is one to two full swipes to reach, and the grid itself is
   then five or six rows tall.
2. **The order is actively wrong.** `fetchListsWithTasks`
   ([useTasks.ts:214](../src/hooks/useTasks.ts#L214)) already returns lists
   `updated_at desc`, kept fresh by an AFTER trigger on `tasks`, and its comment
   spells out the intent: "I just used this list, put it where I can find it".
   Both consumers throw that away and re-sort `created_at desc`
   ([TasksIndexScreen.tsx:69](../src/components/tasks/TasksIndexScreen.tsx#L69),
   [TaskSidebar.tsx:44](../src/components/tasks/TaskSidebar.tsx#L44)). A list
   used daily sinks; a list made once last month sits on top.
3. **No scope filter below `lg`.** `personal` vs `family` is a 12px glyph on the
   tile ([ListGridCard.tsx:60](../src/components/tasks/ListGridCard.tsx#L60)).
   The sidebar dropped its scope chips deliberately
   ([TaskSidebar.tsx:31](../src/components/tasks/TaskSidebar.tsx#L31)) on the
   grounds that nobody filters lists by visibility. At 5 lists that held. At
   10+ it does not: "mine" and "ours" are two different mental drawers.
4. **The fast path from anywhere is not fast.** `Dodaj -> Zadatak` makes you
   pick from an alphabetical native select of every list, every time, with no
   memory ([TaskQuickAddFlow.tsx:68](../src/components/tasks/TaskQuickAddFlow.tsx#L68)).

Note the traffic pattern this has to serve. The bottom bar is Danas / Kalendar
/ [+] / Novac / Meni - `/tasks` is not the landing screen, so "open and add to
shopping" starts on Danas. **The global [+] is therefore the primary fix (5)**;
the screen work (2, 3, 4) makes browsing sane once you are there.

## 2. What ships

Maintainer picked all four options on 2026-08-12:

| Option | What                                                         | Section |
| ------ | ------------------------------------------------------------ | ------- |
| A      | Order lists by use, not by creation date                     | 5       |
| D      | `Zadaci` / `Liste` segment on the mobile index               | 6       |
| C      | Porodicne / Licne scope filter plus grouping                 | 7       |
| E2     | `Dodaj -> Zadatak` remembers the list and offers recent ones | 8       |

No database migration. No new dependency. Everything below `lg` except section
9, which keeps the desktop sidebar consistent with the same ordering.

## 3. Decisions locked (do not re-open)

1. **Recency is per device, not per family.** The order is driven by the lists
   _this person_ opened, falling back to `updated_at desc`. A family-wide bump
   alone would reshuffle your grid because somebody else ticked something.
2. **The segment lives in the sticky header, the filter chips do not.** Header
   stays two rows (title + segment) so sticky chrome does not grow; each tab's
   chip row scrolls with its content. iOS sticky chrome on this app is fragile
   (see `plans/README.md` history and the redesign notes) - do not add a third
   sticky row.
3. **Default tab is `Zadaci`.** A push about a late task must not land on a
   grid of lists. The fast path to a list is the [+], not a remembered tab.
4. **The tab is a URL search param** (`/tasks?tab=lists`), like `/money?tab=`
   and `/calendar?view=`. It makes "Liste" linkable from the Meni later.
5. **Scope filter does not persist.** It resets on leaving the screen, exactly
   like the person chips and the Money search field.
6. **"Nova lista" becomes one full-width row under the grid**, in every state.
   As the last grid cell it would read as belonging to whichever scope group
   rendered last.
7. **Desktop keeps its sidebar.** The segment is a below-`lg` construct; the
   sidebar shows Pregled and Liste at once and always did.

## 4. Shared foundation

### 4.1 `src/lib/recentLists.ts` (replaces `src/lib/lastOpenedList.ts`)

Generalize the existing single-id memory into a short MRU. Same storage
conventions as today (best-effort, try/catch, absent means "no memory").

```ts
const STORAGE_KEY = "lists.recentIds.v1";
/** Older single-id key, read once so the memory survives the upgrade. */
const LEGACY_KEY = "lists.lastOpenedId.v1";
const MAX_RECENT = 8;

export function readRecentListIds(): string[]; // MRU first
export function pushRecentListId(id: string): void; // dedupe, unshift, cap
export function readLastOpenedListId(): string | null; // = readRecentListIds()[0] ?? null
```

`readRecentListIds` seeds from `LEGACY_KEY` when the new key is absent, then
writes the new one. Keeping `readLastOpenedListId` means
[\_app.tasks.index.tsx](../src/routes/_app.tasks.index.tsx) keeps working
unchanged in meaning.

Call sites to update: the import + call in
[\_app.tasks.index.tsx](../src/routes/_app.tasks.index.tsx) and
[\_app.tasks.$listId.tsx](../src/routes/_app.tasks.$listId.tsx) (the latter's
`writeLastOpenedListId` becomes `pushRecentListId`). Delete
`src/lib/lastOpenedList.ts`.

**Push a list onto the MRU in exactly two places:** opening `/tasks/$listId`
(already the write site today) and successfully adding a task to a list from
`TaskQuickAddFlow`. Both mean "I used this list". Do not push on render, on
hover, or from the grid tile - navigation already covers the tile.

### 4.2 `src/components/tasks/listOrder.ts` (new)

One ordering, three consumers, so they can never drift:

```ts
/** MRU-opened first (in MRU order), then everything else `updated_at` desc. */
export function orderLists<T extends { id: string; updated_at: string }>(
  lists: readonly T[],
  recentIds: readonly string[],
): T[];

/**
 * `orderLists` snapshotted for surfaces where rows must not move under the
 * pointer. Re-seeds only when the SET of list ids changes (add / delete /
 * first load), never when a list is merely bumped.
 */
export function useStableListOrder<T extends { id: string; updated_at: string }>(
  lists: readonly T[],
): T[];
```

`useStableListOrder` is what the desktop sidebar uses (section 9). The mobile
grid uses plain `orderLists`: you leave the screen to touch a list, so any
reshuffle happens off-screen.

Unit-test `orderLists` directly: MRU wins over recency, unknown ids in the MRU
are ignored, an empty MRU degrades to pure `updated_at desc`, and the result is
a stable permutation (no dropped or duplicated list).

## 5. Option A - order by use

Three call sites, all switching to `orderLists`:

- [TasksIndexScreen.tsx:69](../src/components/tasks/TasksIndexScreen.tsx#L69) -
  drop the `created_at` sort.
- [TaskSidebar.tsx:44](../src/components/tasks/TaskSidebar.tsx#L44) - use
  `useStableListOrder`; delete the comment that justifies creation order, it
  documents the bug.
- `resolveInitialList` in
  [\_app.tasks.index.tsx:82](../src/routes/_app.tasks.index.tsx#L82) - the
  fallback after a stale last-opened id should be the first list in display
  order, which is now `orderLists(...)[0]`.

**Fallback if the MRU proves fussy in review:** delete `recentIds` from the
signature and let the query's own `updated_at desc` stand. That alone fixes the
reported symptom; the MRU only makes it personal instead of family-wide.

## 6. Option D - the `Zadaci | Liste` segment

Below `lg` only, inside
[TasksIndexScreen.tsx](../src/components/tasks/TasksIndexScreen.tsx).

**Header (sticky), two rows:**

```
[ Zadaci                                   (search icon) ]
[ Zadaci | Liste ]                 <- <Segmented>, full width
```

Reuse [`Segmented`](../src/components/common/Segmented.tsx) as-is (`role=
"tablist"`, soft accent tint). No counts or badges on the segments: the stat
strip already carries the numbers and a badge would compete with it.

**Body per tab** (each tab's filter chips move INTO the scroll area, first
element - see decision 2):

| Tab     | Content, in order                                                                      |
| ------- | -------------------------------------------------------------------------------------- |
| `tasks` | person chips -> `TaskStatStrip` -> dated sections (Kasni / Danas / Sutra) -> "Pregled" |
| `lists` | scope chips -> grid, grouped or flat (section 7) -> "Nova lista" full-width row        |

**Routing.** Add `validateSearch` for `tab` to the index route
[\_app.tasks.index.tsx](../src/routes/_app.tasks.index.tsx), following
[\_app.money.tsx:19](../src/routes/_app.money.tsx#L19) exactly (return a fresh
result object, never spread the raw search - the money route's comment explains
why). Values: `"tasks" | "lists"`, absent means `tasks`. Switching:
`navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })`.

Note `_app.tasks.tsx` already validates `new` on the LAYOUT route. Confirm in
the browser that the child's `tab` and the parent's `new` coexist (open
`/tasks?tab=lists&new=1` and check the create dialog still opens).

**Empty states.**

- Nothing at all (no lists, no dated work): keep the existing full-screen
  `EmptyState` at
  [TasksIndexScreen.tsx:144](../src/components/tasks/TasksIndexScreen.tsx#L144)
  and **hide the segment** - there is nothing to switch between.
- `tasks` tab with nothing dated: the existing inline sentence, unchanged.
- `lists` tab with no lists: `EmptyState` with "Dodaj prvu listu" and the same
  three examples the first-run state uses.

## 7. Option C - scope filter and grouping

Chip row at the top of the `lists` tab, built from the existing
[`FilterChip` / `FilterChipRow`](../src/components/common/FilterChips.tsx):

```
[ Sve ] [ Porodicne ] [ Licne ]        // Serbian labels: Sve / Porodične / Lične
```

Exclusive (unlike the additive person chips), local `useState`, default `Sve`.

**Rendering rule:**

- `Sve` -> the grid renders in two labelled groups, `SectionHeading`
  "Porodične" then "Lične". Ordering from section 5 applies WITHIN each group.
  A group with no lists is omitted entirely, heading included.
- `Porodicne` / `Licne` -> one flat grid, no headings (the chip already says
  what you are looking at).

Grouping under `Sve` is what removes the need to tap anything in the common
case; the chips are for when you want only your own drawer.

**If review finds the grouped-plus-chips combination noisy**, ship the chips
alone (flat grid, filter on tap). That is the smaller change and still answers
the complaint. Do not ship grouping without the chips - "show me only mine" is
half the request.

**"Nova lista"** moves out of the grid into a full-width dashed row underneath
(decision 6). Keep `NewListGridCard`'s look; it just spans the row now. Adjust
or add a variant prop rather than duplicating the component.

## 8. Option E2 - `Dodaj -> Zadatak` remembers the list

In [TaskQuickAddFlow.tsx](../src/components/tasks/TaskQuickAddFlow.tsx):

1. **Seeding.** `initialListId` is `string | null | undefined` and the three
   cases are distinct:
   - `string` -> caller picked a list (the composer handover). Wins outright.
   - `null` -> caller explicitly means Inbox. Wins outright.
   - `undefined` -> caller has no opinion (the global [+]). **Only here** seed
     from `readRecentListIds()[0]`.

   So the expression is `initialListId !== undefined ? initialListId : remembered`,
   never `initialListId ?? remembered` - the `??` form would silently override
   an explicit Inbox. Apply it in BOTH seed paths: the `useState` initializer
   at line 62 and the reopen effect at line 88.

2. **Stale id guard.** The remembered list may have been deleted. Resolve the
   value used by the select and by submit through the loaded options:
   `const resolved = listOptions.some((o) => o.value === listId) ? listId : NO_LIST`.
   Note `listOptions` is empty until the lists query settles, so compute
   `resolved` only once `listsQuery.isSuccess`, otherwise a slow query would
   snap a valid preselection back to Inbox.

3. **Chips above the select.** Up to three most recent lists plus `Inbox`,
   as a `FilterChipRow`, mirroring the select both ways. Label them with the
   list name; the select below stays as the full set and the source of truth.
   Skip the chip row entirely when there are no recent lists (first run).

4. **Write on success.** After `createTask.mutateAsync` resolves with a
   `target`, call `pushRecentListId(target)`. Do not write when the task lands
   in the Inbox - "no list" is not a list, and writing it would make the next
   open preselect nothing while looking like it remembered something.

The success toast and its "Otvori" action stay exactly as they are.

## 9. Desktop (>= lg)

The sidebar is the desktop equivalent of the mobile `lists` tab, so it gets the
same two changes and no segment:

- Ordering via `useStableListOrder` (section 4.2). This is why the snapshot
  exists: the sidebar stays mounted while you work in the detail pane, and
  clicking the fifth list must not make it jump to the top under the cursor.
- The same two groups, as `SidebarGroupLabel` "Porodične" / "Lične" under the
  existing "Liste" label, ordered within each group. No chips - the sidebar
  shows everything at once and has no room for a filter row.

The sidebar's search field stays as it is. It gets diacritic-insensitive
matching in the follow-up search plan, not here.

## 10. Tests

Vitest + Testing Library, alongside the existing suites in
`src/components/tasks/__tests__/`.

- `listOrder.test.ts` - the four cases in section 4.2.
- `recentLists.test.ts` - dedupe, cap, MRU order, legacy-key seeding, and a
  throwing `localStorage` degrading to "no memory".
- `TasksIndexScreen.test.tsx` - segment switches content; `?tab=lists` renders
  the grid first; scope chips filter; `Sve` renders both group headings and an
  empty group renders none; grid order follows the MRU.
- `TaskQuickAddFlow.test.tsx` - remembered list is preselected; explicit
  `initialListId={null}` still means Inbox; an explicit id still wins; a
  remembered-but-deleted id falls back to Inbox; a successful add pushes the
  MRU.

**CI trap (see `plans/README.md` and the CI-env note):** a test must not pull a
real module whose import chain reaches `lib/supabase` - it passes locally
because `.env` exists and fails on CI. `TasksIndexScreen` reaches Supabase
through its hooks, so mock the hook modules (`useTasks`, `useTaskAgendaItems`,
`useOverdueTasks`, `useSearchDialog`) the way the existing task tests do.

## 11. Traps

1. **Router scroll restoration.** TanStack Router writes the previous scroll
   position onto `#app-scroll` after render (see the project note). Switching
   tabs must land at the top. Verify in the browser; if the router fights,
   either pass `resetScroll: false` and scroll to top explicitly, or drop the
   URL param and hold the tab in local state - the param is a convenience, not
   a requirement.
2. **Person chips do not apply to lists.** They filter dated task items only
   ([TasksIndexScreen.tsx:76](../src/components/tasks/TasksIndexScreen.tsx#L76)).
   Keeping them out of the `lists` tab is the point of moving them into the tab
   body; do not render an inert filter next to the grid.
3. **The MRU can outlive the list.** Every read is filtered against loaded
   lists before use - in the grid, in `resolveInitialList`, and in the quick-add
   chips.
4. **Two mounts of `useListsWithTasks`.** Index and sidebar never mount
   together (breakpoint switch), and the query is shared, so this is a cache
   read, not a second request. Do not "optimize" it by lifting state.
5. **oxfmt is repo-wide.** Run `pnpm check` before committing; a stray format
   diff in an untouched file means you ran it against a dirty tree.
6. **Serbian only in visible strings.** Chip labels, headings and empty-state
   copy are Serbian; every identifier, comment and commit message here is
   English.

## 12. Definition of done

- [ ] `pnpm check` and `pnpm test` green; `pnpm build` (doubles as typecheck) green.
- [ ] Browser-verified below `lg` at 375px: both tabs, scope chips, grouped and
      flat grids, empty states, and that the sticky header is still two rows.
- [ ] Browser-verified at `lg`: sidebar groups and stable ordering while
      ticking tasks in the detail pane.
- [ ] A list used from the [+] appears first in the grid on the next visit.
- [ ] `Dodaj -> Zadatak` from Danas preselects the last used list; the composer
      handover and explicit Inbox still win.
- [ ] `src/lib/lastOpenedList.ts` is gone and nothing imports it.
- [ ] This row updated in `plans/README.md`.

## 13. Notes from execution - these override the plan

Executed 2026-08-12 directly on `feat/tasks-and-reminders` (not a branch of its
own), alongside the private-tasks work, at the maintainer's request.

1. **Three order helpers, not two.** `orderLists` (pure) is joined by
   `useListOrder` (recomputes every render, what the mobile grid uses) and
   `useStableListOrder` (snapshot, what the sidebar uses). The plan named only
   the first and third; the grid needed a live one and reaching for the raw
   `orderLists` + `readRecentListIds` at each call site would have leaked the
   storage read into three components.
2. **The tab param clears itself.** `tab=tasks` is written as `undefined`, so
   the default tab leaves no `?tab=` in the URL at all. Scroll restoration
   (trap 1) never fought back - no `resetScroll` handling was needed.
3. **The sidebar's "Liste" label is gone**, replaced by the two scope group
   labels ("Porodične" / "Lične"). It survives only in the empty and loading
   states, where there are no groups to name.
4. **`NewListGridCard` is now `NewListRow`** and moved out of the grid, per
   decision 6. No caller kept the old tile.
5. **E2 also guards a deleted list**: the remembered id is checked against the
   loaded lists and falls back to the Inbox, and the quick-pick chips are built
   from lists that still exist.
6. **Interaction with private-by-default** (the other feature in this session):
   the "+ -> Zadatak" sheet now opens on your last-used LIST rather than the
   Inbox, so on a device that has opened a list the sheet is no longer private
   by default. That follows both rules as written - a task in a list takes the
   list's visibility - but it is a real change to what the "+" starts as, and
   the maintainer was told. Reverting it means dropping the MRU fallback in
   `defaultListId`, one line, leaving the MRU to drive ordering only.
7. **Not done: `plans/README.md` execution-order table** lists this as DONE but
   the branch is shared with 015, so there is no separate PR to reference.
8. **The "Pregled" row and section 6's layout are gone**: the stat tiles at the
   top of the Zadaci half ARE the four cross-list cuts now (`TaskStatStrip`),
   swapping their rows into the page in place (`?cut=`) rather than navigating
   away - repeating them as a chip row said the same thing twice. Section 7's
   scope chips live inside the Liste tab unchanged; the Zadaci half filters by
   the person rail instead.
9. **Section 10's two missing test files were written 2026-08-14**
   (`TasksIndexScreen.test.tsx`, `TaskQuickAddFlow.test.tsx`), with the
   assertions adapted to the shipped tab/cut UI: segment switching, `?tab=lists`
   rendering the grid first, scope groups under "Sve" with headings dropped on a
   pick, MRU-driven grid order, the cut swapping in place, and the quick-add's
   three-state `initialListId` contract exercised against the real
   `recentLists` store.
