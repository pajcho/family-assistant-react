# REDESIGN_PLAN.md - Family Assistant 2.0 ("plum")

Status: APPROVED for implementation (2026-08-04). This document is the source of truth for the scope and for tracking.
Visual source of truth: the interactive prototype https://claude.ai/code/artifact/ddbb3b67-f7e9-4db3-9c1b-48d6241628c4
(every screen, sheet, form, date/time picker and the design-language documentation is clickable there).

> Historical note (2026-08-10): the Serbian route paths this document records
> (`/kalendar`, `/novac`, `/skola`, `/uskoro`, the `/kid/*` subroutes) were later
> renamed to English (`/calendar`, `/money`, `/school`, ...) with no redirects
> left behind, and the search param values with them (`view=nedelja|mesec` ->
> `week|month`, `tab=pregled|troskovi|placanja` -> `overview|expenses|payments`).
> The paths below are kept as written at the time. See AGENTS.md for the rule.

## How this is run

- EVERYTHING lands in ONE PR onto main (squash-merge through the pajcho account, as before).
- Work happens on the integration branch `redesign/v2`. The lanes below are done in separate worktrees
  and merged into `redesign/v2` as soon as they are finished; at the end, one PR `redesign/v2 -> main`.
- Tracking: the checkboxes in this file are ticked as work progresses (the file is part of the branch), and the PR
  description mirrors this list at the end.
- The prototype is the visual source of truth; every deliberate deviation is recorded in the "Deviations" section at the bottom.

## What does NOT change (a hard boundary)

- The database, RLS, migrations, edge functions, the realtime channel, push/digest, the receipt claim model, the exchange-rate logic.
- Business rules: upcoming starts today, overdue is separated out, birthdays are exempt from the member filter,
  the payment statuses and the order of actions in the detail sheets (the exact lists are in the prototype and in
  the project memory - the inventory of 2026-08-04).
- Conventions: currencies as codes (RSD, EUR), no long dashes (scripts/check-dashes.sh), the buttons
  Odustani/Otkaži/Zatvori/Nazad, greetings without a name, the SheetStack pattern.
- The only exception to "no migrations": OPTIONALLY `profiles.accent` (see lane G) - it may be deferred
  (localStorage first), the decision is taken during implementation.

## Key decisions (already taken, not to be reopened)

1. The bottom bar: today - calendar - [+] - money - menu. Today and menu are fixed, slots 2 and 4 are personalized
   (calendar and money by default), MAX_FREE_SLOTS 3 -> 2. Legacy nav_slots values are mapped in code:
   uskoro->calendar, payments->money, budget->money (no DB migration).
2. The calendar absorbs the old upcoming page: segments agenda (the old upcoming list) / week / month (month is NEW).
3. Money absorbs the budget and payments pages: segments overview / expenses / payments.
4. Today = one timeline (merging the old list and the day calendar); the view toggle on today goes away.
5. Routes: the new /kalendar and /novac; the old /uskoro, /payments, /budget stay as redirects
   (deep links from push notifications have to keep working).
6. The design language keeps the name "plum" (warm-undertone neutrals), but THE DEFAULT ACCENT IS BLUE
   (the existing brand colour - the PWA icon, the login screen and the splash stay blue, nothing changes there).
   The accent is ONE token per user: blue (default) / purple / green / brown.
   The 8 existing member colours get fruit names (naming/UI only, the values are unchanged).
7. Pickers: date = a sheet (shortcuts by field context + a grid with busy dots + a year->month->day drill;
   for a date of birth it starts at the year and allows direct entry). Time = an hour grid + minutes
   :00/:15/:30/:45 + duration chips that compute the end; long press = the native input fallback.
   On desktop the same content, as a popover next to the field.
8. The serif accent is used only for the greeting and the month name (a system serif stack, 0 KB).

## Lanes, dependencies and estimates

Order: A first (it blocks everything). Then B, C, D, E in parallel. F and G in parallel as soon as there are free hands.
H (desktop) after most of B-E. I (integration/QA) last, shared.
The estimates are for focused work by one session/agent per lane.

### Lane A - Foundation: tokens + shell + navigation (1 day) [blocks everything]

- [x] Tailwind v4 @theme: the complete plum palette (light+dark), radii, shadows, the soft/tint layer,
      a CSS-var level for the accent (--accent, --accent-soft, --accent-deep)
- [x] A map of fruit names for PROFILE_COLOR_PALETTE (raspberry, blueberry, kiwi, apricot, plum, quince,
      lavender, cherry) - UI naming, the same hex values
- [x] The app shell: a fixed frame (100dvh, an inner scroll per screen), safe-area, removing the
      window scroll + sticky hacks (this fixes the known iOS problem); the keyboard still hides the bottom bar
- [x] Routes: /kalendar (search param view=agenda|nedelja|mesec), /novac (tab=pregled|troskovi|placanja);
      redirects for /uskoro, /payments, /budget; scroll restoration and preload as before
- [x] navSections.ts: new keys/icons/order; sectionForPathname; recents work with the new routes
- [x] MobileBottomNav v2: 4 tabs + a central [+] button; normalizeNavSlots mapping the legacy values,
      MAX_FREE_SLOTS=2; the edit-the-bar logic for 2 slots
- [x] Menu sheet v2: recents + a grid of every section + edit the bar (per the prototype)
- [x] An add sheet behind [+]: scan-a-receipt hero + expense/payment/event/activity/birthday/list;
      the FAB goes away; the per-page add buttons stay on desktop
- [x] Login screen restyle (the plum brand; the kid-mode link stays only as a placeholder IF one exists;
      otherwise without it - kid mode is NOT part of this PR)

### Lane B - Today (1 day) [after A]

- [x] The timeline component: the time rail on the left, a "now" line, all-day/span chips at the top,
      a payments-due-today section, the past part of the day dimmed
- [x] WeekStrip v2 (slim, load dots, a soft selection) + a tap takes you to that day in the calendar agenda
- [x] The person filter: 26px avatar rings + an "all" chip (the existing filter logic/semantics stay)
- [x] The overdue banner (leads into money > payments)
- [x] FirstStepsCard + an empty-state restyle (the existing copy is kept)
- [x] Turning off the old view toggle on today; AgendaDayCalendar is retired (its slotting logic is
      recycled into the timeline)

### Lane C - Calendar (1.5 days) [after A]

- [x] A container with segments + filter chips (type + members) shared by all three views
- [x] Agenda: restyle AgendaUpcomingList (day groups, empty days, infinite scroll up to 365,
      overdue at the top, multi-day "day i/n") - the logic untouched
- [x] Week: restyle AgendaWeekCalendar + integrate the school blocks (a show-school toggle,
      from the existing WeekGrid/shift logic)
- [x] Month (NEW): a grid with per-type dots, span bars for multi-day items, tapping a day opens the day below;
      a lazy-loaded chunk; the desktop cells with chips are left for lane H
- [x] The /uskoro redirect + the `?day=` hand-off from the today week strip (lane B sends it)

### Lane D - Money (1 day) [after A]

- [x] The hub with segments + a month pager + a QR button in the header
- [x] Overview: restyle the existing budget components (the cycle card with income/spent/left,
      the projection, the nudge to confirm income, by-category + edit, fixed vs variable,
      top shops, the trend) - the logic untouched; restyle the income/categories/CategoryDetail sheets
- [x] Expenses: BudgetTimeline as a tab + source filters (manual/receipt/from-payment) + members + search
      (including receipt line items, as today); the chips for a receipt with N items / a receipt part / from a payment
- [x] Payments: the existing PaymentsPage content as a tab (the summary card, the overdue/today/... groups,
      every status, show-more, the hidden-paid line)
- [x] The scanner + ReceiptPreview + the chain + receipt splitting: restyled into the new tokens (the flow and logic untouched)

### Lane E - Shared inputs + every form (2 days) [after A; E1 before E2]

- [x] E1: DateField + DatePickerSheet (shortcuts by field mode: past/future/dob; a grid with busy dots
      from the agenda; a year->month->day drill; direct entry for a DOB; a tap picks and closes)
- [x] E1: TimeField + TimePickerSheet (an hour grid 7-22, 4 minute chips, a long-press native fallback) + DurationChips (30/45/60/90/120 compute the end)
- [x] E1: desktop variants as popovers (the same content, anchored to the field, the keyboard works)
- [x] E2: migrate the forms onto the new tokens and the new inputs: expense (+ the scanner entry), payment (type,
      recurrence, variable amount, reminders), event (multi-day + duration chips), activity
      (the sessions editor with A/B), birthday (the DOB flow), list, income/category forms
- [x] E2: DetailSheet restyle for every entity - THE ACTION ORDER IS IDENTICAL to the current one (payment:
      mark as paid -> edit -> history -> reschedule -> cancel -> pause -> delete; and so on)
- [x] E2: CurrencyToggle + ExchangeRateRow restyle (the NBS row, a frozen rate - the logic unchanged)

### Lane F - Secondary screens (1 day) [after A, may run alongside E2]

- [x] Lists: restyle the index + detail; smart sort, swipe gestures, dnd, export, auto-delete - all kept
- [x] Activities: WeekGrid restyle + school + the options sheet (shifts, timetables, bell times) + the full list
- [x] Events: the filter bar (month, search, done) + group restyle
- [x] Birthdays: monthly groups, the party badge, the countdown
- [x] Global search: dialog restyle (the same groups and behaviour, Cmd+K)

### Lane G - Settings + account (1 day) [after A]

- [x] Fold /profile into the /settings hub with groups (the profile card at the top; family, money-currencies,
      notifications, calendar, app, sign out) - the old tabs become sections/sub-screens
- [x] Appearance: theme light/dark/auto + the app colour (blue by default; purple/green/brown as options;
      the accent token; localStorage first, OPTIONALLY a profiles.accent migration - decide then;
      the login screen and the icon are always blue)
- [x] The Google Calendar sub-screen: a per-calendar select (do not import / only me / family), the reauth banner,
      ImportPrefs (travel/birthdays/markers), connecting the account
- [x] Family: members with fruit colours, roles (admin/student), logins, remove; the family name
- [x] Restyle the notifications/digest/sessions/currencies cards
- [~] The navigation-bar row (leads to edit-the-bar in the menu) - the row exists and shows the current
  slots, but it is informational: edit-the-bar is local state inside AppNav and has no entry point from a route
  (see Deviations)

### Lane H - Desktop (1.5 days) [after most of B-E; the first task can start IMMEDIATELY]

- [x] H0 FIRST: a quick static desktop mock of today + calendar (extending the existing artifact prototype)
      and a short confirmation from the user before building - APPROVED 2026-08-04
      (artifact: https://claude.ai/code/artifact/25b00c0d-3d0e-4c18-bfad-903267137cf4)
- [x] Sidebar >=lg (~240px): the logo, a large add button, all 9 sections with icons, a mini profile +
      the theme at the bottom; the top inline nav goes away; below lg the bottom bar stays (the existing lg breakpoint is kept)
- [x] Today on desktop: 2 columns - the timeline on the left (max ~640px), sticky on the right: a mini month (clicking leads into
      the calendar), the overdue card, a short next-days list
- [x] Calendar on desktop: month with event chips in the cells, week at full height, agenda centred;
      a toolbar with the segments and the filters
- [x] Money on desktop: the overview as a 2-column card grid; the expenses/payments lists max ~720px
- [x] Lists: the existing resizable split stays, restyle only
- [x] Sheets -> centred dialogs >=sm (the existing ResponsiveDialog pattern), pickers as popovers
- [x] Hover/focus states, Esc, Cmd+K; (optional, may be dropped: arrow-key shortcuts in the calendar)

### Lane I - Integration + QA (1 day, last, shared)

- [x] A dark-mode pass through EVERY screen and sheet (tokens, contrast)
- [x] Empty states everywhere (the existing copy from the empty-states spec)
- [x] PWA: manifest theme_color -> a neutral background (light), the icon UNCHANGED; the update toast works
- [~] iOS standalone QA: the code was checked (no window scroll anywhere, safe-area on the bar/header/
  login, the keyboard unmounts the bottom bar, the bars are opaque without a backdrop-filter), but
  a real pass on an iPhone in standalone mode is left to the user - that cannot be faked
- [x] Redirects + push deep links + recents + search navigation
- [x] Tests: the picker utils (addMin, genGrid, leap years), the normalizeNavSlots legacy mapping,
      timeline slotting; CI (check + dash-check + test + build) green
- [x] A bundle check (month lazy), a quick Lighthouse pass
- [ ] A PR description with the checklist + screenshots per screen (light/dark, mobile/desktop) - WAITING on the user's local confirmation; the PR is not opened before that

### Lane J - Time strips (added 2026-08-05, per the approved proposal)

Proposal: https://claude.ai/code/artifact/d8b011aa-b20f-4ffd-bd24-5acdbdea21a3
(approved with one change: money gets a month-style header instead of the proposed chip strip).

- [x] Shared components: `common/MonthGridPopover` (the month grid extracted from MonthPager,
      a year + 12 months + a this-month shortcut + an optional all-payments row) and `common/NowPill`
      (a back-to-now pill - rendered only while you have drifted away from "now")
- [x] Money: MonthPager v2 - a serif month name + the year on the left (clicking opens the grid), the NowPill
      when it is not the current month (and in the all-payments view), sm IconButton arrows on the right; the API towards
      the money screen is unchanged
- [x] Calendar > month: the title becomes a button (the same month grid) + a NowPill to get back
- [x] WeekStrip v3: the orphaned `dashboard/WeekStrip.tsx` reworked - v2 cells (an initial + a count + up to 3 load dots), a header line (a month label with a mini-calendar popover +
      the NowPill + optional pointer-fine arrows); the swipe engine untouched (a translateX carousel,
      exactly 1 week per drag, axis lock, flick, trackpad wheel, the iOS workaround)
- [x] Calendar > agenda: the strip COMES BACK - portalled into the fixed header (a slot in CalendarScreen,
      the money-screen add-button pattern), scroll-spy on the app-scroll container, a tap scrolls the list,
      the mini-calendar jump goes through the growHorizon mechanics, a NowPill back to today; past days of the current
      week are muted and inactive (the rule that upcoming starts today)
- [x] Calendar > week: the same strip as a minimap and a pager - a swipe changes the week (carrying the same
      weekday), a tap scrolls the grid to the column (mobile), horizontal scroll-spy follows the
      column in view, a NowPill back to this week, arrows on pointer-fine only; the old `< range >`
      row and the conditional this-week chip removed
- [x] Checks: check + test (374) + build green; a manual pass on the dev server (mobile/desktop,
      light/dark theme, the demo account's green accent)

### Lane K - A mobile pass: calendar chrome, the month carousel, modals (2026-08-06)

A pass over the user's complaints after lane J, all on mobile (desktop unchanged).

- [x] Calendar (all three): below `lg` the fixed header keeps ONLY the title; the segmented control and the filter
      chips move into the body and scroll with the content, and the week strip is the only sticky thing -
      in a sticky box in the body (`CalendarScreen`), whose height is measured (ResizeObserver) and passed to
      the agenda as `stickyOffset` (`--agenda-sticky-top`), so the day headers and the jump-to-day
      account for the offset and park BELOW the strip
- [x] Calendar > week on mobile: a full-height grid, the page scrolls vertically
      (`pageScroll`); `overscroll-x-contain` (NOT `overscroll-contain` - the latter swallows a
      vertical drag across the grid); NO auto-scroll to "now" (it dragged the tabs off
      screen the moment the view opened), the focused day is CENTRED horizontally instead
- [x] Calendar > month: no auto-selection of the 1st of the month - today is the only day the system picks
      on its own; the selection persists across a month change (the peek list caches rows outside the query
      window until the user taps another day); the selected-day row is sticky
- [x] Calendar > month: a vertical swipe = a real translateY carousel (the prev/next grids as
      `inert` pages, the commit only after the animation + a layoutEffect reset onto `monthAnchor`);
      the shared boundary week is NOT duplicated (the neighbouring page drops it, the slide distance is
      one row shorter, the dimming inverts on commit)
- [x] `calendar/WeekTimeGridShell` - ONE frame for the week grid, shared by calendar > week and
      /activities `WeekGrid`: columns 56px + 7x260px (<sm) / 1fr (sm+), a sticky day header
      with a sticky corner (a fix: on activities the day row ran OVER the hour gutter), a sticky
      hour gutter, the now line/badge, an optional all-day row. Widths and stickiness now
      change only there
- [x] Money: the month title shrunk to the same style as on the calendar (13.5px semibold + a chevron),
      instead of the 27px serif - the two month screens now read as one control
- [x] Date pickers on mobile are MODAL (a bottom sheet), the popover stays on desktop only:
      `MonthGridPopover` (calendar > month, money), the `WeekStrip` mini calendar (a full-width
      grid in a sheet), `PeriodPicker/MonthPicker` (events, birthdays)
- [x] The same pattern for action menus: the list actions on `lists/$listId` are a sheet on mobile
      with `DetailActionRow` rows (the destructive one last), and stay a dropdown on desktop
- [x] Sheet height: `ResponsiveDialogContent` no longer carries a permanent `min-h-[60vh]` - a sheet is exactly
      as tall as its content asks (capped at `max-h-[90vh]`), and the 60vh floor is only enabled while the
      keyboard is open (`useIsKeyboardOpen`), because that is the only reason it ever existed
      (the iOS band between a short sheet and the keyboard). There is no per-sheet height prop
- [x] The global "+": scan-a-receipt is no longer an accent-filled hero but the same tile as the
      others, only full width; the tiles got the app's focus ring (the browser default ring is amber = the warning colour)
- [x] Checks: check + test (374) + build green; a manual pass on the dev server (mobile 375px and
      desktop, all three calendar views, money, activities, lists, the pickers)

## Parallelization (a proposal for agents/worktrees)

- Agent 1: A, then B, then helps with I
- Agent 2: E1 then E2 (after A)
- Agent 3: C then F (after A)
- Agent 4: D then G (after A)
- H: agent 1 or 3 after their own lanes (the H0 mock may go earlier, as soon as the user confirms)
- ~10-11 lane-days in total; with 3-4 parallel streams, realistically 3-4 days of work.
- Every lane = its own worktree + a branch `redesign/v2-<lane>`, merged into `redesign/v2` as soon as it is green
  (build + tests); conflicts are resolved in the integration branch, not in the lane branches.

## Definition of Done (for the PR)

- pnpm check (including check-dashes) + test + build green on CI
- Every old link works: /uskoro, /payments, /budget, the push URLs, recents, search
- Every screen checked in the light and dark theme, mobile (iOS PWA standalone) and desktop
- Visually matches the prototype; deviations listed in the PR description
- No changes in the database/edge functions (except possibly profiles.accent, with an explicit decision)
- Production deploy: the frontend goes automatically on merge (Pages); NO manual backend deploy

## Kickoff for a new session

In a new session say: "Start the redesign implementation per REDESIGN_PLAN.md" - the session should:

1. read this file + the project memory + open the prototype artifact as a visual reference,
2. create the `redesign/v2` branch and start from lane A,
3. tick the checkboxes here as tasks land,
4. spin up worktree agents for parallelization per the scheme above (agreeing with the user on how much parallelism they want),
5. send H0 (the desktop mock) to the user for confirmation before building lane H.

## What was verified in the integration pass (2026-08-04)

- Routes and redirects live: `/uskoro` -> `/kalendar?view=agenda`, `/payments` ->
  `/novac?tab=placanja`, `/budget` -> `/novac?tab=pregled`, `/profile` -> `/settings`.
  The push deep links from the edge functions (`/payments`, `/uskoro`, `/events`, `/activities`,
  `/lists/:id`, `/`) all land on those routes - the edge functions were not touched.
- Recents (the menu sheet), edit-the-bar 2/2, global search and ⌘K, Esc closes dialogs.
- The accent: switching to brown/green/blue repaints the whole app and is written into
  `profiles.accent` (the local database).
- The payment detail sheet: the action order is unchanged (mark as paid -> edit ->
  history -> reschedule -> cancel -> delete).
- Light and dark theme: today, calendar (agenda/week/month), money (all three tabs),
  settings, lists, events, birthdays, activities, the expense form with the new picker.
- Desktop (>=lg): the sidebar, today in 2 columns, month with chips, money overview in 2 columns,
  the lists split (measured: 320 + 8 + 712 = the full width).
- Bundle: month is its own lazy chunk (5.2 kB), the scanner 21 kB + the wasm separately,
  the main chunk 254 kB (82 kB gzip) - in the same range as before the redesign.
- Lighthouse (a production build, the login screen, mobile): 100 accessibility /
  100 best practices / 100 SEO. The first pass found a missing `<main>` landmark
  (lost while rewriting the frame) - fixed.
- A caveat: Lighthouse can still only reach the login screen (every other screen needs a session).

## The empty-screen pass for new users (2026-08-05)

EVERY screen was walked through as a fresh account (locally: novi.korisnik@example.com / novi1234,
the family "Novakovi", no data), mobile + desktop. Fixes from that pass:

- MonthCalendar: the weekCount formula added a redundant (empty) seventh week to EVERY
  month - the +1 belonged to the day count, not to the quotient.
- The member filter is hidden when a family has a single member (there is nobody to
  filter by): today, calendar, money > expenses/payments, activities.
- The Google chip in the calendar filters appears only once the family really has
  mirrored Google events (a new useHasExternalEvents hook; the chip stays while it
  is selected so it can be turned off).
- Money > expenses: a real starter empty state (no expenses yet + an add-expense action)
  instead of a single sentence; the empty-month case (an add-expense link) and the
  empty-filters case (clear the filters) are separated. The empty logic moved out of
  BudgetTimeline into BudgetPage.
- Activities: the show-school chip only once a school timetable exists (the same gate
  as calendar > week); the whole filter row is hidden when it is empty.
- Displaying a name when none is set: the title no longer repeats the email (the settings
  card, the personal-details overview, the sidebar mini profile -> a no-name placeholder,
  with the email staying in the subtitle).
- First steps: "complete your profile" leads straight into /settings?tab=profile (not to the hub).

Deliberately NOT changed: the empty day headers in calendar > agenda below the starter
card (a documented decision - the agenda reads as a continuous calendar).

## Decisions taken during the work

- The accent is stored in the database: the migration `20260804090000_profiles_accent.sql` (the
  `profiles.accent` column + a CHECK), localStorage is only a mirror for the first paint.
- EVERY key that ends up in the database is in ENGLISH (for a later localization):
  the accents `blue|purple|green|brown` (labelled Plava/Ljubičasta/Zelena/Braon),
  the nav sections `today|calendar|money|lists|activities|events|birthdays|family|settings`.
  The old values are mapped in code (`LEGACY_KEY_MAP`), with no data migration.
- The accent names are plain colour names rather than themed ones (the design language is still
  called "plum", but the user picks blue/purple/green/brown).

## Deviations from the prototype (filled in as work progresses)

Lane J (time strips, 2026-08-05):

- The redesign prototype shows a centred `< month >` pager for money; it was replaced with the month-style
  header (a serif name as the grid trigger + arrows + the NowPill) at the user's request. The visual
  source for the strips is a separate artifact (the link in lane J), and for money it holds in the
  month-style variant, not the chip-strip one.
- The earlier decision "calendar > agenda has NO week strip" (the lane C note below) is OVERRIDDEN
  by this proposal: the agenda has the swipe strip again, and the month jump lives on the month label inside it.

- Lane E: the pickers open as a sheet on mobile, but through the existing
  ResponsiveDialog (vaul), not as a sub-view of the form - the form stays where it
  is and comes back untouched. On desktop it is a popover next to the field, as planned.
- Lane E: next to the 7-22 hour grid there is also an other-hours chip plus an exact-time field,
  because a long press on the native picker does not work everywhere (Safari has no showPicker).
- Lane E: the duration chips are not offered for multi-day events - the end then belongs to
  another day, so computing "start + N" would be wrong.

- The `--accent*` token was taken for the user's accent, so shadcn's neutral
  `accent` (the hover background) was moved to `muted` in `components/ui/*`. Visually
  identical, a rename only.
- The prototype palette has a plum accent; the default accent in the app is
  BLUE (decision 6), and plum is the purple option.
  Lane B (today) and H (desktop):

- The today timeline: the prototype shows the start time both in the left column AND in the card on the right;
  here the card on the right carries only the end time (repeating it was redundant on a phone).
- Today loads the agenda for the WHOLE current week (one useAgenda) so the strip
  can have load dots; the timeline takes only today's slice. On desktop the range
  widens to the end of the month, because the right column has a mini month and a next-days list.
- Desktop: search exists in the sidebar too (a search row with ⌘K), not only in the screen
  header - the sidebar is the only surface present on every screen.

Lane D (money):

- Search in the money header is a toggle (a magnifier -> a field below the title), not a separate
  sheet as in the prototype. Opening search from the overview switches to expenses
  (that is where the results are), and going back to the overview closes the search.
- The month pager is a new component (`money/MonthPager`) instead of the shared
  `MonthPicker`; in the header the arrows are quiet chrome, and the label opens the month
  grid with a this-month shortcut and (on payments only) an all-payments row.
- The filters on expenses/payments are a chip row (all / sources / paid) instead of
  FilterBar + FilterSheet; the sheet is kept only for picking members.
- The day headers in expenses no longer use `AgendaDateHeader` (that is an agenda
  pattern, lane B) but a `.gh` group with a counter; the relative tokens are
  today/yesterday (an expense ledger looks backwards), plus tomorrow for the rare future entry.
- The two-column `xl` budget layout was removed - expenses are their own tab now.
  The desktop layout was lane H's job.
- The add buttons (BudgetAddMenu, add-payment) are shown only from `lg`
  upwards; on touch the entry point is the central [+] in the bar.
- `PaymentsPage` no longer holds the month/search (they come from the hub); the
  `onMonthChange` prop was not needed, so it is gone.

Lane G (settings):

- The notifications group is one row (push + daily digests + sessions) instead of the
  four in the prototype: all four cards share the same `notification_preferences`
  row and are saved together, so four entry points would lead to the same sub-screen.
- Currencies were pulled out of family into their own sub-screen (`?tab=currencies`), as
  the family / money-currencies grouping requires; `CurrenciesCard` is no longer rendered
  inside `FamilyTab`.
- The bottom-bar row is informational (it shows the current two slots) with a footnote
  saying where it is changed. Edit-the-bar lives as local state in `AppNav` and has no
  entry point from a route; if lane A/I adds e.g. a search param or a global event,
  the row is ready to become a button.
- `/profile` is now a redirect to `/settings` (nothing links to it any more).
- `?tab=` also accepted `currencies`/`valute`; an unknown value leads to the hub
  (it used to lead to the profile tab).

Lane C (calendar) and F (secondary screens):

- Lane C: calendar > agenda has NO week strip (the prototype does not show one on that
  screen). It stays on today and hands the day over through `?day=`; the month jump from the old
  WeekStrip picker is replaced by the month view.
- Lane C: the neutral state of the filter chips. Previously, while no filter was active,
  EVERY chip was lit; now only the all chip is lit (as in the prototype), and the
  type/member chips light up only when they are really selected. The filtering logic
  itself is unchanged (an empty set = no filter). The same holds for the member chips
  on activities; PersonFilterChips inside FilterSheet
  (payments/events/birthdays) still uses the old convention.
- Lane C: the icon buttons are visually 40px (the prototype has 38px) with a transparent ::after
  frame out to 44px, for the minimum touch target.
- Lane F: the list detail on mobile is now its own AppScreen; the desktop
  master-detail split is untouched.

Integration (lane I):

- The week view was TRIED without horizontal scrolling (seven ~46px columns fit
  on a phone, as in the prototype) and then REVERTED to 140px columns + horizontal scrolling
  (2026-08-05, at the user's request): at 46px every block is an unreadable
  bar and the labels had to be hidden below `sm`, and a week you cannot read
  is not worth seeing whole. On top of that: the grid now scrolls in BOTH directions inside
  its own frame (`AppScreen fillBody`), so the day header and the hour gutter on the left are
  really sticky, and it opens on today and the current hour.
- ADDENDUM (lane K, 2026-08-06): the columns were widened from 140px to 260px - the same as
  on /activities, because the two screens now share a frame (`WeekTimeGridShell`).
  The two-axis scroll now holds on desktop only; on mobile the grid runs at full height and
  the page carries the vertical axis, so the day header cannot be sticky there -
  the sticky week strip above takes over the "where am I in the week" role. Opening at
  the current hour was removed (see lane K); centring today remains.
