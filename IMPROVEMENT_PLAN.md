# Improvement plan - Family Assistant

> Written after a detailed review of the app (July 2026): a manual walkthrough of
> every screen (mobile 375px + desktop 1440px + dark mode) against the local
> environment, plus an analysis of the whole codebase (routes, hooks, migrations,
> edge functions). Each phase is scoped so it can be handed to a sub-agent as a
> self-contained task.

## Assessment of the current state

**What is already good (do not touch, only maintain):**

- One agenda model (today/upcoming) that merges activities, events, payments,
  birthdays and Google events, with filters by type and by member, list and
  calendar views, and detail sheets with actions (mark as paid, reschedule,
  cancel, edit).
- Activities + the school timetable (A/B shifts, bells, timetable) - the app's
  strongest and most original feature.
- The Web Push system is complete: a morning/evening digest, per-entity
  reminders, an instant push when a member adds something; idempotent through
  `notification_log`.
- Lists: swipe, drag-reorder, smart-sort, markdown, optimistic updates, export.
- The code is clean (0 TODO/FIXME, 1 console.\*), RLS is consistent, a11y is
  decent, dark mode is complete, and the PWA has an update toast.

**Key weaknesses (summary):**

1. Inconsistent filters: the person filter exists on the dashboard and on
   activities, but NOT on payments and events, even though the data
   (participants) is there.
2. Payments are neither categorized nor linked to activities/events - that
   blocks the budget module and the "what does this hobby actually cost us"
   question.
3. There is no global search; search exists only inside lists.
4. There is no offline support for data, no pull-to-refresh, and
   `refetchOnWindowFocus` is off - in a standalone PWA the user has no way to
   refresh manually if the realtime socket dies after a suspend.
5. The occurrence resolver (recurring activities/payments) is duplicated
   between the frontend utils and the `send-due-pushes` edge function - a
   divergence risk.
6. Family onboarding goes through a CLI script (`scripts/setup-family.ts`) -
   there is no in-app family creation and no invitations.
7. There are almost no tests (2 test files) for some very non-trivial logic
   (the synthesis of recurring payments in `_app.payments.tsx`, 884 lines).

---

## Phase 0 - Quick wins and hygiene (1 PR, ~1 day)

Small things noticed during the review; all low-risk:

- [ ] **Bug:** `/settings?tab=<invalid>` (any invalid value) renders empty
      content - no tab is active. `validateSearch` in `_app.settings.tsx`
      discards unknown values, but the UI does not fall back to the profile
      tab. Reproduced in the browser. Fix the fallback.
- [ ] **A11y:** the list/calendar view-toggle buttons and a few other icon-only
      buttons have no `aria-label` (they are unnamed in the a11y tree). The
      week-strip days carry a raw label `"2026-07-20 - 6"` - humanize it
      ("Monday 20 July, 6 items").
- [ ] **Lists:** duplicate copies only the list settings, not the items - add a
      duplicate-with-items option (for a weekly shopping list that is the main
      use case).
- [ ] **Events:** the filter row (from/to/show-all + a checkbox) looks out of
      place next to the rest of the app - restyle it into the chip/sheet
      pattern used on the dashboard.
- [ ] **Overdue:** add the total to the section header (e.g. "OVERDUE ·
      16,000 RSD") - right now only the individual amounts are visible.
- [ ] **The add FAB** on today/upcoming has no list entry - add one (it takes
      the user to /lists with the dialog open).
- [ ] **Code hygiene:** a stale comment in `src/sw.ts:25` ("Push handlers are
      stubs" - they are implemented); the dead `SHOW_DEVTOOLS` flag in
      `__root.tsx:28`.

## Phase 1 - UX consistency (1-2 PRs)

- [ ] **The person filter everywhere:** add a filter by member to payments and
      events (the same chip pattern as `AgendaFilters`); on payments, also show
      the total for the selected member.
- [ ] **Skeleton loading:** replace the bare loading line with skeleton rows (at
      least on the dashboard, payments and lists) - perceived speed.
- [ ] **Pull-to-refresh** on mobile (a standalone PWA has no refresh button):
      pull -> `queryClient.invalidateQueries()`. Also consider re-subscribing
      the realtime channel on `visibilitychange` (the iOS suspend gotcha).
- [ ] **Empty states with an action:** "nothing scheduled today" -> add a
      preview of tomorrow or a CTA into the upcoming view; empty
      birthdays/events -> an add-the-first button instead of text alone.
- [ ] **A month picker on the week strip:** tapping the month name opens a mini
      month calendar for a quick jump (today a distant date is only reachable by
      scrolling).
- [ ] **Global search (⌘K / an icon on mobile):** one endpoint over the TanStack
      Query cache - search activities, payments, events, lists, list items and
      birthdays; a result takes the user to the matching detail.

## Phase 2 - Linking payments to activities/events

A user request: an activity and its payment should be connected, and a birthday
party (an event) should be connected to what the party costs.

**The schema (simple, with no generic polymorphism):**

```sql
ALTER TABLE payments
  ADD COLUMN activity_id uuid NULL REFERENCES activities(id) ON DELETE SET NULL,
  ADD COLUMN event_id    uuid NULL REFERENCES events(id)     ON DELETE SET NULL,
  ADD CONSTRAINT payments_single_link CHECK (num_nonnulls(activity_id, event_id) <= 1);
```

(+ the same on `expenses` later, in phase 3 - the same two FK columns, the same
CHECK.)

**UI:**

- An optional link picker in the payment form (searchable: activities + events).
- The payment detail sheet: a link that takes the user to the activity.
- Activity detail/edit: a new **payments** section - the live payment + its
  history (`payment_history` through the linked payment), grouped by month.
- Event detail: the same payments section.
- **Attendance by month:** since `activity_overrides` already stores the
  canceled sessions, show a monthly summary for a linked activity: the number of
  sessions actually held (scheduled minus canceled) + that month's payments.
  That is exactly what was asked for (attendance per month, with the payments
  that go with it).
- Auto-suggestion: when creating a payment, if the name fuzzy-matches an
  existing activity, offer the link in one tap.

## Phase 3 - Budget, part 1: categories + manual expenses

The minimum useful budget - no salaries, no limits (that is phase 4), so it does
not get over-complicated.

**Schema:**

- `expense_categories` (family_id, name, icon/color, sort) + a seed of default
  categories (groceries, utilities, children/activities, transport, health,
  going out, other).
- `expenses` (family_id, amount, currency, date, category_id, person_id NULL,
  note, source `manual|payment|receipt`, payment_id NULL, activity_id/event_id
  NULL as in phase 2).
- `payments.category_id NULL` - existing payments get a category; when an
  occurrence is marked as paid, an `expenses` row is written automatically
  (source='payment') -> all spending in one place with no double entry.

**UI - a new budget page (in the overflow menu / desktop nav):**

- A monthly summary: the total per category (bar/donut), the expense list,
  month chips as on payments.
- **Quick entry** (designed to take 5 seconds at the till): FAB -> amount
  (numpad) -> category (icon grid) -> save; person/note/link optional.
- Filter by member and by category.

## Phase 4 - Budget, part 2: income and the monthly cycle

- `incomes` (family_id, person_id, amount, day_of_month, name, is_recurring) -
  several salaries, on different days of the month (exactly the user's
  scenario).
- The monthly cycle on the budget page: income - (paid payments + expenses) =
  what is left; a projection to the end of the month based on the known
  recurring payments (the occurrence resolver already exists).
- Optional per-category limits + a push when spending crosses 80%/100% (a new
  dispatch path in `send-due-pushes` - the infrastructure is already there).
- A trend chart across months (spending per category, 6-12 months).

## Phase 5 - Fiscal receipts (QR scanner)

Serbian fiscal receipts carry a QR code that leads to a public verification page
(`suf.purs.gov.rs`) with every line item on the receipt - **no OCR needed**.

- **Client:** a scanner in the PWA (the BarcodeDetector API + a `zxing-js`
  fallback; the camera works in an installed PWA on iOS 15.1+). Scan the QR ->
  get a URL.
- **The `receipt-import` edge function:** takes the URL, validates that it is
  `suf.purs.gov.rs`, fetches and parses it (shop, date, total, line items) ->
  returns the structure; the client shows a preview -> the user confirms the
  category -> an `expenses` row (source='receipt') + `expense_items` rows are
  written.
- **A note for the implementer:** validate the format of the page/journal
  endpoint against 2-3 real receipts first; keep the parser in the edge function
  so a fix does not have to wait for a store review (the PWA advantage).
- A later fallback (optional): photograph the receipt -> Claude API vision
  extraction.

## Phase 6 - Resilience and quality (technical debt)

- [ ] **A shared occurrence resolver:** move the resolver logic out of
      `src/utils/activity.ts` + `payment.ts` into `packages/shared` (the pnpm
      workspace already exists) and import it in both the frontend and
      `send-due-pushes` (Deno can import TS files relatively; check the bundling
      through `supabase functions deploy`). It removes ~180 lines of duplicated
      implementation.
- [ ] **Tests for the critical logic:** payment synthesis (monthly/weekly/
      limited/interval + overrides + history), the agenda merge, the budget
      cycle. Vitest is already configured.
- [ ] **Refactor `_app.payments.tsx` (884 lines):** extract `computeSummary` /
      `computeCombinedList` into utils (duplicated month-expansion arithmetic),
      and the dialog scaffolding into a shared `useEntityDialogs` hook (the same
      pattern is copy-pasted in 4 places).
- [ ] **An error boundary** per route + **Sentry** (@sentry/react) - today a
      render error takes down the whole page, and production errors are
      invisible.
- [ ] **Offline reads:** TanStack Query `persistQueryClient` in IndexedDB - a
      shopping list has to open in the basement of a shop with no signal. (Do
      NOT do a mutation queue for offline edits now - too much complexity.)
- [ ] **In-app family onboarding** (if the app is ever given to another
      family): sign up -> create the family -> an email invitation to a member
      (replacing `scripts/setup-family.ts`).

## Phase 7 - New modules (a backlog of ideas, optional)

Ordered by estimated value/effort:

1. **Chores:** recurring tasks assigned to children with a due date and optional
   points/streaks ("take out the bins - every Wednesday"). Model them as their
   own type, not through lists (recurrence + assignment + history). An evening
   push reminder if nothing is ticked.
2. **Who drives:** assign a driver (a parent) to an activity occurrence -
   `activity_overrides` already has per-occurrence infrastructure; show it in
   the agenda and add a "my duties" filter.
3. **Birthdays++:** the age the person is turning, gift ideas (notes already
   exist - give them structure), a create-a-party button (a pre-filled event),
   and merging with imported Google contact birthdays (the import checkbox
   already exists in the gcal settings - surface them in the birthdays module
   too).
4. **Documents with an expiry:** passports, ID cards, car registration,
   insurance policies - just a name + an expiry date + a reminder X days ahead
   (the existing push system); optionally an attachment in Supabase Storage.
5. **Meal planning:** a weekly menu + "add the ingredients to the shopping
   list". A big module - only worth doing if the family really plans meals.
6. **AI quick entry:** text/voice ("dentist for Toni, Wednesday 3pm") -> the
   Claude API parses it -> a pre-filled event form. A fun differentiator, an
   edge function plus one input on the dashboard.

---

## Suggested execution order

| Priority | Phase                    | Why                                               |
| -------- | ------------------------ | ------------------------------------------------- |
| 1        | Phase 0                  | cheap, immediately visible                        |
| 2        | Phase 2 (linking)        | an explicit user request, unblocks 3/4            |
| 3        | Phase 3 (budget v1)      | the largest new value                             |
| 4        | Phase 1 (UX consistency) | can run alongside 2/3 (different files)           |
| 5        | Phase 4 (budget v2)      | builds on 3                                       |
| 6        | Phase 5 (QR receipts)    | the wow factor, depends on 3                      |
| 7        | Phase 6 (quality)        | thread it through continuously, resolver before 4 |
| 8        | Phase 7                  | backlog                                           |

**Notes for sub-agents:**

- Every phase = its own branch + PR (squash-merge, the `pajcho` account - see
  the existing workflow).
- Migrations: guard the realtime publication (`IF EXISTS ... pg_publication`),
  locally `supabase migration up --local`; a new edge function needs a full
  `supabase stop && start` + `supabase functions serve --env-file
supabase/functions/.env.local` for the custom secrets.
- Never mount two `useAgenda` at the same time (a duplicate realtime
  subscription crash).
- UI text is Serbian; button labels follow the convention: Odustani / Otkaži /
  Zatvori / Nazad (see the existing dialogs).
