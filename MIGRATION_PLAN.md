# Family Assistant - Nuxt 3 → Vite + React Migration Plan

Source of truth: `../family-assistant/` (Nuxt 3, CSR, Supabase). This repo is a ground-up rewrite. Functionality stays 1:1; framework changes; layout & colors preserved; mobile-first; pixel-perfection not required.

---

## Operator's manual (read first)

**How to use this plan.** Phases dispatch sequentially; agents within a phase run in parallel (no file overlap). Each agent prompt in §6 is self-contained - copy it verbatim into the Agent tool. After each phase commits, dispatch the next.

**Repo paths.**
- This repo (React rewrite): `/Users/nikolapajic/Desktop/Projekti/family-assistant-react/` - write here.
- Sibling Nuxt source: `/Users/nikolapajic/Desktop/Projekti/family-assistant/` - **read-only**, the user has it open in another IDE. Never edit it.
- Visual reference screenshots: `.nuxt-screens/*.png` (gitignored, 13 files: 6 routes + dialogs + dropdowns + dark mode + desktop). Look here when porting any UI to confirm layout.

**Local Supabase (already running).** `http://127.0.0.1:54321`. Health check: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:54321/rest/v1/` should print `200`. The DB has one family ("Pajic") and one user.

**Test login (local Supabase ONLY - never use against prod):**
- Email: `nikola.pajic@gmail.com`
- Password: `admin123`

**Start the sibling Nuxt app for side-by-side visual comparison** (port 3002, separate from React's 5173):
```bash
cd /Users/nikolapajic/Desktop/Projekti/family-assistant && \
  pnpm exec dotenv -e .env.local -- pnpm exec nuxt dev --port 3002
```
*(Will fall back to port 3000 if 3002 is taken.)*

**Start the React app** (once Phase 0 is done):
```bash
pnpm dev      # http://localhost:5173/
```

**Run the migrated app at mobile viewport** (390×844) and desktop (1280×800) via chrome-devtools MCP. The 13 screenshots in `.nuxt-screens/` were captured at those viewports - match them.

**What lives where in the sibling Nuxt app** (so agents know what to port from):
- Pages: `pages/{index,login,events/index,payments/index,birthdays/index,expenses/index}.vue`
- Composables: `composables/use{Auth,Supabase,Profile,Theme,Toast,Events,Payments,Birthdays,Expenses}.ts`
- Components: `components/{AppNav,AppNavLink,ThemeToggle,ConfirmDialog,PullToRefresh}.vue` + `components/{dashboard,events,payments,birthdays,expenses,ui}/*.vue`
- Utils: `utils/{date,birthday,event,format,cn}.ts`
- Types: `types/database.ts`
- Setup script: `scripts/setup-family.ts`
- Schema: `supabase/migrations/*.sql`
- Layout: `layouts/default.vue` (just `<AppNav v-if="showNav" /><main>...</main>`)
- Middleware: `middleware/auth.global.ts` (redirect to /login when no session)
- Global CSS: `assets/css/main.css` (Tailwind + custom utilities: `scrollbar-hide`, `animate-fade-in`, `hover-lift`, `stagger-fade-in`, `html.dialog-open` scroll lock)

---

## 0. Target stack (latest stable, as of 2026-05-17)

| Layer | Choice | Why |
|---|---|---|
| Build | Vite 7 | User specified Vite SPA. |
| Framework | React 19 + TypeScript (strict) | User specified. |
| Routing | **TanStack Router** (file-based) | Mirrors Nuxt's `pages/` layout; pairs with TanStack Query (same ecosystem original already uses). *Confirm - see open question 1.* |
| Server state | TanStack Query v5 + **Supabase Realtime → `queryClient.invalidateQueries`** | Direct port of `@tanstack/vue-query`. Realtime publication is already enabled in the DB; each feature hook subscribes to `postgres_changes` on its table and invalidates on any change. ~10 LOC per hook. |
| Styling | Tailwind CSS v4 + `@tailwindcss/vite` | Latest. Project already has `tailwind-v4-shadcn` skill. |
| Components | shadcn/ui (Radix) | Specified in original PRD; React port stays consistent. |
| Icons | `@heroicons/react/24/outline` | 1:1 with original. |
| Dates | `date-fns` + `react-day-picker` (inside shadcn Popover) | Replaces `@vuepic/vue-datepicker`. |
| Drag-reorder | `@dnd-kit/sortable` | Replaces `sortablejs` (used only on Expenses). |
| Pull-to-refresh | `pulltorefreshjs` wrapped in a React component | Vanilla JS - works as-is. |
| Toasts | `sonner` | Shadcn standard; replaces the custom Toast/ToastContainer. |
| **Mobile dialogs** | **`vaul` Drawer** (shadcn ships a Drawer wrapper) | **Mobile uses a bottom-sheet sheet with drag handle - visually confirmed**. Use Drawer at `sm:` breakpoint, Dialog above. |
| Auth/DB | `@supabase/supabase-js` (latest) | Same backend. |
| Forms | Controlled inputs (no react-hook-form for now) | Matches original simplicity. |
| Tests | Vitest + React Testing Library | Skill already loaded. |
| Lint/Format | **oxlint + oxfmt** | User-chosen. Matches original tooling; oxc is the same toolchain Vite/Rolldown is moving toward, so it's the most aligned with Vite long-term. |
| Package manager | pnpm | Match original. |
| Deploy | GitHub Pages (mirror original); Vercel/Netlify are easy alternatives | Vite `base: '/family-assistant-react/'`. |

---

## 1.a Visual patterns confirmed (mobile inspection 390×844, dark + light, all 6 routes)

Mobile screenshots live in `.nuxt-screens/` (gitignored - they're scratch). Key patterns the React rewrite must preserve:

- **Mobile header is a single sticky block, not bottom-tab nav.** Top row: logo, theme toggle, logout. Second row directly below: horizontal-scroll nav with **icon stacked above label** (`flex-col` on mobile, `flex-row` on `sm:`). Active item: gray pill background.
- **Mobile dialogs are bottom sheets**, not centered modals. Slide up from the bottom, ~80-90vh, with a **small grey drag-handle pill** at the top center. Content scrolls inside the sheet. → Use **`vaul` Drawer** (responsive `Drawer` below `sm`, `Dialog` at and above `sm`). This is the single biggest divergence from naive shadcn defaults.
- **Each dashboard card has its own accent color** on the title icon and on the list rows:
  - Events → **blue** (calendar)
  - Payments → **amber/orange** title icon, **red/pink** row tint when overdue, red amount
  - Birthdays → **green** (cake), green "za N dana" text on light-green rows
  - Expenses → **purple** (shopping bag), purple amounts on light-purple rows
- **Responsive action pattern in list items**: mobile shows a single **kebab (3-dot vertical) "Akcije" trigger** that opens a dropdown; desktop (`sm:` and up) shows all actions as inline buttons (Pauziraj / Plaćeno / Istorija / Izmeni / Obriši). The set of actions varies by item type (one-time payments hide Pauziraj/Istorija).
- **Expense rows have a visible drag handle** (hamburger ☰ icon) on the left, kebab on the right. With dnd-kit, the handle gets `{...listeners}` only - the rest of the row is non-draggable so the click-to-edit still works.
- **Primary buttons are full-width on mobile, auto-width on desktop**. The page header on mobile stacks vertically (`flex-col`), horizontally on desktop (`sm:flex-row sm:items-center sm:justify-between`).
- **Dashboard grid**: 1 column on mobile, **2 columns** on `sm:` and up (`sm:grid-cols-2`). Cards are full-height within their cell.
- **Status pills** (Prekoračeno, Plaćeno, Mesečno, Jednokratno) are small rounded-pill badges with color-coded backgrounds.
- **Form layout in dialogs**: most are single-column; the **Payment edit dialog uses 2-column on `sm:` for Iznos + Datum dospeća**; recurrence type is **inline radio buttons** (Jednokratno / Mesečno / Ograničeno); "Pauziraj plaćanje" is a checkbox that only appears when editing a recurring payment.
- **Dialog footer buttons are right-aligned**: outline "Otkaži" + filled primary "Dodaj" / "Sačuvaj izmene".
- **Dark mode tokens used**: `bg-gray-900` body, `bg-gray-800` cards/nav, `text-gray-100` body, `text-white` headings, dark variants of all accent tints (e.g. `dark:bg-red-900/20` for overdue rows). The site-wide CSS adds `transition-colors duration-200` on `*` so theme toggle animates smoothly.
- **Login** is a centered Card with `max-w-md`, vertical center on screen, no nav visible.

These findings sharpen the plan but don't change its shape - they're all absorbed into Phase 1B (UI primitives + Drawer) and Phase 3 (per-feature pages must apply the per-feature accent colors and the kebab→inline-buttons split).

---

## 1. What we are porting (inventory)

**Pages → file-based routes (6):**
`/` (dashboard), `/login`, `/events`, `/payments`, `/birthdays`, `/expenses`

**Composables → hooks (9):**
`useSupabase`, `useAuth`, `useProfile`, `useTheme`, `useToast`, `useEvents`, `usePayments`, `useBirthdays`, `useExpenses`

**Components (46 → ~31 React components):**
- Layout/common (5): `AppNav`, `AppNavLink`, `ThemeToggle`, `ConfirmDialog`, `PullToRefresh`
- Dashboard (7): `DashboardCard`, `DashboardCardItem`, `DashboardSummaryCard`, `DashboardEventCard`, `DashboardPaymentCard`, `DashboardBirthdayCard`, `DashboardExpenseCard`
- Events (3): `EventForm`, `EventFormDialog`, `EventListItem`
- Payments (5): `PaymentForm`, `PaymentFormDialog`, `PaymentListItem`, `PaymentHistoryPopup`, `PaymentUndoDialog`
- Birthdays (4): `BirthdayForm`, `BirthdayFormDialog`, `BirthdayDisplayLine`, `BirthdayListItem`
- Expenses (3): `ExpenseForm`, `ExpenseFormDialog`, `ExpenseListItem`
- UI primitives (shadcn re-installs): button, card, dialog, input, label, dropdown-menu, sonner, popover, calendar, separator + custom `date-picker`, `time-picker`

**Utilities (5, pure):** `date.ts`, `birthday.ts`, `event.ts`, `format.ts`, `cn.ts` - port verbatim (only `cn.ts` swaps from manual to `clsx + tailwind-merge`).

**Types:** `types/database.ts` - port verbatim.

**Scripts:** `scripts/setup-family.ts` - port verbatim with VITE-prefixed env handling.

**Schema:** Reuse the live local Supabase DB. Optionally copy SQL migrations into the new repo for completeness (don't re-run).

**Not porting** (matches original):
- i18n (Serbian strings stay hardcoded)
- AI/LLM
- Tests beyond a small util smoke suite

**Added in the React rewrite** (small, user-approved):
- **Supabase Realtime subscriptions** - original has the publication enabled but doesn't subscribe client-side. Adding this is cheap with TanStack Query and gives free cross-device sync between the two family users.

---

## 2. Proposed file layout

```
src/
  main.tsx
  App.tsx                       # mounts router
  routes/                       # TanStack Router file-based
    __root.tsx                  # QueryClientProvider + AuthProvider + ThemeProvider + <Toaster/>
    _app.tsx                    # protected layout: <AppNav/> + <Outlet/>
    _app.index.tsx              # dashboard
    _app.events.tsx
    _app.payments.tsx
    _app.birthdays.tsx
    _app.expenses.tsx
    login.tsx
  components/
    layout/   { AppNav, AppNavLink, ThemeToggle, ProtectedRoute }
    common/   { ConfirmDialog, PullToRefresh }
    dashboard/, events/, payments/, birthdays/, expenses/
    ui/       # shadcn primitives + DatePicker, TimePicker wrappers
  hooks/      { useAuth, useProfile, useSupabase, useTheme, useEvents, usePayments, useBirthdays, useExpenses }
  lib/        { supabase.ts, queryClient.ts, cn.ts }
  types/      { database.ts }
  utils/      { date, birthday, event, format }
  styles/     { index.css }      # Tailwind v4 + ported custom utilities
scripts/      { setup-family.ts }
supabase/migrations/             # copies for repo completeness, not run
.env, .env.local, .env.example
vite.config.ts, tsconfig.json, components.json, package.json
```

---

## 3. Phased plan with parallel sub-agent breakdown

5 waves. Phase 0 sequential. Phases 1-4 each launch as one batch of N parallel sub-agents. Phase 5 is human QA.

Each sub-agent owns a disjoint set of files so multiple can run concurrently without merge conflicts.

### Phase 0 - Scaffold & foundations (1 agent, ~30 min, SEQUENTIAL)

1. `pnpm create vite . --template react-ts` (clean repo, init only)
2. Install runtime deps: `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/router-vite-plugin`, `@tanstack/react-query`, `@tanstack/react-query-devtools`, `@supabase/supabase-js`, `@heroicons/react`, `date-fns`, `react-day-picker`, `sonner`, `@dnd-kit/core`, `@dnd-kit/sortable`, `clsx`, `tailwind-merge`, `pulltorefreshjs`, `class-variance-authority`
3. Install dev deps: `tailwindcss@latest`, `@tailwindcss/vite`, `vitest`, `@vitest/ui`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@types/pulltorefreshjs`, `oxlint`, `oxfmt` (or eslint+prettier)
4. Configure: `vite.config.ts` (with `@tanstack/router-vite-plugin` and `@tailwindcss/vite`), `tsconfig.json` (strict), `vitest.config.ts`
5. Run `pnpm dlx shadcn@latest init` (Tailwind v4 setup, "new-york" or "default" style, neutral base color, CSS variables)
6. Create `src/styles/index.css` with `@import "tailwindcss";` + port custom utilities from original `assets/css/main.css`:
   - `scrollbar-hide`, `animate-fade-in`, `@keyframes fadeIn`, `hover-lift`, `stagger-fade-in` (delays for nth-child)
   - `html.dialog-open` scroll lock
   - Smooth color transitions on `*`
7. Create `.env`, `.env.local`, `.env.example` mirroring the Nuxt project, swapping `NUXT_PUBLIC_` → `VITE_`:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `.env.local` uses `http://127.0.0.1:54321` + the local anon key (copy from sibling `.env.local`)
8. Create `src/types/database.ts` - copy verbatim from `../family-assistant/types/database.ts`
9. Create `src/lib/supabase.ts` - `createClient(import.meta.env.VITE_SUPABASE_URL, ..., { auth: { persistSession: true, autoRefreshToken: true } })`
10. Create `src/lib/cn.ts` - `clsx + twMerge`
11. Create `src/lib/queryClient.ts` - `new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } })`
12. Create `src/routes/__root.tsx` with `<QueryClientProvider/>`, placeholder for `<AuthProvider/>` + `<ThemeProvider/>` + `<Toaster/>` + `<Outlet/>` + `<TanStackRouterDevtools/>`
13. Create `App.tsx` mounting the router; update `main.tsx`
14. Add a "boot OK" placeholder route at `/` that just shows the Supabase URL it loaded - proves env wiring works
15. Add npm scripts: `dev`, `build`, `preview`, `test`, `test:ui`, `lint`, `fmt`, `setup-family`
16. Verify `pnpm dev` boots and `pnpm build` succeeds
17. Commit

**Acceptance:** `pnpm dev` opens browser; page shows "boot OK" + Supabase URL; `pnpm build && pnpm preview` works.

---

### Phase 1 - Cross-cutting (3 agents in PARALLEL after Phase 0, ~30-45 min each)

#### Agent 1A - Auth + Theme + Routing shell

Owns:
- `src/hooks/useSupabase.ts` (just re-exports the singleton - kept for parity)
- `src/hooks/useAuth.ts` - Context + provider. `signIn`, `signOut`, `session`, `user`, `loading`. Use `getSession()` on mount, attach `onAuthStateChange` once (module-level guard).
- `src/hooks/useTheme.ts` - Context + provider. `mode: 'light'|'dark'|'auto'`, `isDark`, `setMode`. Read/write `localStorage['theme-mode']`. Apply `.dark` to `<html>`. Listen for `prefers-color-scheme` change when `mode==='auto'`.
- `src/hooks/useProfile.ts` - TanStack Query hook: fetches `profiles` + `families` for current user. Cached by `user.id`. Returns `{ profile, family, familyId, familyName, isLoading }`.
- `src/components/layout/ProtectedRoute.tsx` - redirects to `/login` when no session. Wire as a TanStack Router `beforeLoad` in `_app.tsx` (preferred) or as a wrapper.
- `src/components/layout/AppNav.tsx`, `AppNavLink.tsx`, `ThemeToggle.tsx` - port verbatim from `components/AppNav.vue` etc., keeping ALL Tailwind classes including:
  - Sticky top bar `sticky top-0 z-40 ... bg-white/80 backdrop-blur-md dark:bg-gray-800/80`
  - Desktop nav links `hidden sm:flex`
  - **Mobile bottom horizontal-scroll nav** `scrollbar-hide flex w-full gap-1 overflow-x-auto border-t ... px-4 py-2 ... sm:hidden`
  - Active state styling
- `src/routes/__root.tsx` - wire AuthProvider + ThemeProvider + Toaster
- `src/routes/_app.tsx` - protected layout: `<div class="min-h-screen w-full overflow-x-hidden bg-gray-50 dark:bg-gray-900"><AppNav/><main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"><Outlet/></main></div>`
- `src/routes/_app.index.tsx` - stub h1, replaced in Phase 4
- `src/routes/login.tsx` - port `pages/login.vue` (centered Card with form, error display, "Prijava" title, Serbian copy verbatim)

**Acceptance:** unauthenticated → `/login` shows the form; logging in with `nikola.pajic@gmail.com / admin123` lands on `/` (stub dashboard) with AppNav visible; mobile viewport (375px) shows bottom horizontal-scroll nav; theme toggle persists across reload.

#### Agent 1B - shadcn UI primitives + ResponsiveDialog + ConfirmDialog

Owns (only `src/components/ui/*` and `src/components/common/ConfirmDialog.tsx`):
- `pnpm dlx shadcn@latest add button card dialog drawer input label dropdown-menu sonner popover calendar separator badge` (drawer ships with the `vaul` integration)
- Extend the Button cva variants to add `success` (green-600 / green-700 hover, used in payments "Plaćeno"). Keep all original variants: default, secondary, destructive, success, outline, ghost, link. Keep sizes: default, sm, lg, icon.
- Build `src/components/ui/responsive-dialog.tsx` - **this is critical**. Renders `<Drawer>` below `sm:` breakpoint (matchMedia or `useMediaQuery` hook) and `<Dialog>` at/above. Both expose the same trigger/content/header/footer slots so feature dialogs work without branching. Drawer must show the grey drag-handle pill (vaul default) and use `max-h-[90vh]`. This component replaces the original Nuxt custom drag-to-close Dialog.
- Build `src/components/ui/date-picker.tsx`: shadcn Popover + react-day-picker. Props `{ value: string|null, onChange, placeholder?, id?, className? }`. Display `DD.MM.YYYY` (date-fns); state stays as `YYYY-MM-DD`. Clear "×" button when value is set.
- Build `src/components/ui/time-picker.tsx`: HH:mm input + clear button.
- Build `src/components/common/ConfirmDialog.tsx`: uses `ResponsiveDialog` so the delete confirmation is also a bottom sheet on mobile. Destructive confirm button.

**Acceptance:** A scratch test route renders one of each primitive; opening any dialog at 390px viewport shows a bottom sheet with drag handle; opening at 1280px shows a centered modal; DatePicker round-trips `2026-02-10` ↔ `10.02.2026`.

#### Agent 1C - Utilities, scripts, test scaffold

Owns:
- `src/utils/date.ts`, `birthday.ts`, `event.ts`, `format.ts` - copy verbatim from `../family-assistant/utils/`. Replace any `~/` imports with relative.
- `scripts/setup-family.ts` - port from `../family-assistant/scripts/setup-family.ts`. Replace its manual `.env` loader with reading `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from `process.env` (run via `tsx --env-file=.env.local`). Add `"setup-family"` and `"setup-family:local"` to `package.json` scripts.
- `vitest.config.ts` if not yet added; one tiny smoke test file at `src/utils/__tests__/utils.test.ts` covering: `addMonth('2026-01-31')`, `subtractMonth('2026-03-31')`, `daysUntilBirthday(...)`, `formatAmount(2500)`, `isOverdue(...)`. 5 tests total.
- `supabase/migrations/*.sql` - copy the 7 SQL files from `../family-assistant/supabase/migrations/`. Don't run; just keep alongside `supabase/config.toml` for repo completeness.

**Acceptance:** `pnpm test` passes (5/5); `pnpm setup-family:local` shows the prompts (don't actually run it against the live DB).

---

### Phase 2 - Feature data hooks (4 agents in PARALLEL after Phase 1, ~20-30 min each)

Each agent ports one composable into a React hook backed by TanStack Query. Pattern for each:

- `useXxxList()` → `useQuery({ queryKey: ['xxx', familyId, filters], queryFn, enabled: !!familyId })`
- `useCreateXxx()`, `useUpdateXxx()`, `useDeleteXxx()` → `useMutation` with `onSuccess: () => qc.invalidateQueries({ queryKey: ['xxx', familyId] })`
- Special payment ops: `useMarkPaymentPaid`, `useTogglePaymentPause`, `useUndoLastPayment` - port the multi-step transactional logic from `usePayments.ts` verbatim. Payments also invalidates the `payment_history` query.
- **Realtime subscription (inside `useXxxList`)** - added per user approval:
  ```ts
  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`xxx-${familyId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'xxx', filter: `family_id=eq.${familyId}` },
        () => queryClient.invalidateQueries({ queryKey: ['xxx', familyId] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [familyId, queryClient]);
  ```
  Payments hook also listens on `payment_history`. Each agent owns this inside their hook - no shared helper needed (one-time use per file, copying it is clearer than abstracting it).

- File ownership is fully disjoint:

| Agent | File |
|---|---|
| 2A | `src/hooks/useEvents.ts` |
| 2B | `src/hooks/usePayments.ts` (largest - port `markAsPaid`, `togglePause`, `undoLastPayment`, `fetchPaymentHistory*`, `hasPaymentHistory` carefully; subscribe to both `payments` and `payment_history`) |
| 2C | `src/hooks/useBirthdays.ts` |
| 2D | `src/hooks/useExpenses.ts` (includes `reorderExpenses` and `markAsPaid`) |

**Acceptance per agent:** the hook file type-checks and exports the same surface as the Vue composable. With two browser windows logged in to the same account, a CRUD action in one window should make the other reflect the change within ~1s without manual refresh.

---

### Phase 3 - Feature UI (4 agents in PARALLEL after Phase 2, ~60-90 min each)

Each agent owns its feature folder and route file end-to-end. Zero file overlap.

#### Agent 3A - Events
Owns: `src/routes/_app.events.tsx`, `src/components/events/{EventListItem,EventForm,EventFormDialog}.tsx`
Port from: `pages/events/index.vue`, `components/events/*`
Notes: DatePicker for `from`/`to` filters; `hideCompleted` checkbox; ConfirmDialog for delete; uses `useEvents` hooks + `isEventEnded` util.

#### Agent 3B - Payments (largest)
Owns: `src/routes/_app.payments.tsx`, `src/components/payments/{PaymentListItem,PaymentForm,PaymentFormDialog,PaymentHistoryPopup,PaymentUndoDialog}.tsx`
Port from: `pages/payments/index.vue`, `components/payments/*`
**Most complex piece - carefully port:**
- `combinedList` / `displayedList` computed: merges `payments` + `payment_history` + synthetic `upcoming` rows per selected month
- `summary` computed: per-month unpaid/paid totals including upcoming
- `getItemClass(item)`: overdue/paused/paid color classes
- Polymorphic `PaymentListItem` (handles `'payment' | 'history' | 'upcoming'`) - consider splitting into 3 small components plus a discriminator in the page, OR keep the discriminated-union pattern with `if (item.type === ...)` blocks
- **Responsive action pattern (visually confirmed):** mobile shows a single kebab button → `DropdownMenu` with the actions; desktop (`sm:` and up) shows each action as an inline `Button` (Pauziraj outline, Plaćeno success, Istorija outline-with-icon, Izmeni outline-with-icon, Obriši destructive-with-icon). The action set depends on item type: one-time payments omit Pauziraj/Istorija; history rows show only Undo; upcoming rows show nothing.
- **Payment form layout (visually confirmed):** Naziv / Opis full width; **Iznos + Datum dospeća are a 2-column grid on `sm:`**; Tip is inline radios; Preostalo uplata appears only when `Ograničeno`; Pauziraj checkbox appears only when editing a recurring payment. Footer right-aligned Otkaži + Sačuvaj izmene.

#### Agent 3C - Birthdays
Owns: `src/routes/_app.birthdays.tsx`, `src/components/birthdays/{BirthdayDisplayLine,BirthdayListItem,BirthdayForm,BirthdayFormDialog}.tsx`
Port from: `pages/birthdays/index.vue`, `components/birthdays/*`
Notes: `BirthdayDisplayLine` builds the "Marko puni 30 godina za 5 dana" text from `currentAge` + `daysUntilBirthday`. Sort by `daysUntilBirthday`.

#### Agent 3D - Expenses
Owns: `src/routes/_app.expenses.tsx`, `src/components/expenses/{ExpenseListItem,ExpenseForm,ExpenseFormDialog}.tsx`
Port from: `pages/expenses/index.vue`, `components/expenses/*`
**Drag-to-reorder change:** swap `sortablejs` for `@dnd-kit/sortable`:
- Wrap list in `<DndContext><SortableContext items={ids}>` and use `useSortable` in `ExpenseListItem`
- On `onDragEnd`: compute new order with `arrayMove`, call `useReorderExpenses` mutation
- Drag handle: `{...attributes} {...listeners}` on a Bars icon

**Acceptance per agent:** route renders; CRUD round-trips with the live local Supabase; UI matches Nuxt at mobile (375px) and desktop (1280px) - spot-check side-by-side.

---

### Phase 4 - Dashboard (1 agent after Phase 3, ~60 min)

Owns:
- `src/components/dashboard/{DashboardCard,DashboardCardItem,DashboardSummaryCard,DashboardEventCard,DashboardPaymentCard,DashboardBirthdayCard,DashboardExpenseCard}.tsx`
- `src/components/common/PullToRefresh.tsx` - wrap `pulltorefreshjs` in a `useEffect` that calls `PullToRefresh.init({ mainElement: ref.current, onRefresh: props.onRefresh })` and destroys on unmount
- Replace stub `src/routes/_app.index.tsx` with the full dashboard, importing the *FormDialog components from Phase 3 folders for the add/edit flow

Port from: `pages/index.vue`, `components/dashboard/*`

Dashboard rules (from PRD):
- Events: next 14 days
- Payments: due soon (next 7 days) + overdue
- Birthdays: next 30 days (with "same-day overflow" handling - see `DashboardBirthdayCard.vue`)
- Expenses: top 5 unpaid

**Per-card accent colors (visually confirmed):**
- Events → blue (calendar icon, blue header pill)
- Payments → amber/orange header icon, **red/pink row tint + red amount** for overdue items
- Birthdays → **green** (cake icon, light-green rows, green "za N dana" text)
- Expenses → **purple** (shopping bag, light-purple rows, purple amounts)

`DashboardCard` should accept an `accent: 'blue' | 'amber' | 'green' | 'purple'` prop and derive both the header-icon background and the `DashboardCardItem` row tint from it. `DashboardCardItem` clicks open the corresponding detail popup (the inline detail Dialog in each Dashboard*Card.vue - port that pattern; it's a separate ResponsiveDialog per card).

**Acceptance:** dashboard mirrors Nuxt's: 2×2 grid on desktop, single column on mobile; pull-to-refresh triggers data reload; clicking an item opens its detail popup → Izmeni from popup opens the feature's edit dialog; add buttons open empty form dialogs; accent colors match per card in both light and dark mode.

---

### Phase 5 - QA, polish, deploy prep (human-driven, ~60 min)

1. Run both apps side by side (Nuxt at `http://localhost:3000/`, React at `http://localhost:5173/` after running `pnpm dev`).
2. Visual diff at mobile (375×812) and desktop (1280×800) for: `/login`, `/`, `/events`, `/payments`, `/birthdays`, `/expenses`. Fix obvious color/spacing drift only - no pixel chasing.
3. Add favicon + `<title>Porodični asistent</title>` in `index.html`.
4. Set Vite `base` for the chosen deploy path (`/family-assistant-react/` or `/`).
5. Update README with: dev workflow, env setup, deploy steps. (Optional: port DEPLOYMENT.md verbatim.)
6. Optional CI workflow under `.github/workflows/deploy.yml`.
7. Smoke test full flow against live local Supabase: log in → add/edit/delete one of each entity → confirm Nuxt sees the same data (proves shared DB works).

---

## 4. Sub-agent dispatch pattern

```
Phase 0   ─ 1 agent (scaffold)
              │ commit
              ▼
Phase 1   ─ 1A ║ 1B ║ 1C        (3 parallel)
              │ commits merged
              ▼
Phase 2   ─ 2A ║ 2B ║ 2C ║ 2D   (4 parallel)
              │ commits merged
              ▼
Phase 3   ─ 3A ║ 3B ║ 3C ║ 3D   (4 parallel)
              │ commits merged
              ▼
Phase 4   ─ 1 agent (dashboard)
              ▼
Phase 5   ─ human QA
```

Each agent prompt should:
- State the phase + agent letter
- Link this `MIGRATION_PLAN.md`
- List the exact files it owns (so it doesn't drift into another agent's files)
- Reference the specific Vue source files to port from
- Spell out the acceptance criteria

---

## 5. Decisions (all resolved)

1. **Router**: TanStack Router (file-based, ecosystem fit with TanStack Query).
2. **Lint/format**: oxlint + oxfmt (oxc toolchain - aligned with where Vite/Rolldown is heading).
3. **Deploy**: GitHub Pages, `base: '/family-assistant-react/'`.
4. **Mobile dialogs**: `vaul` Drawer via `ResponsiveDialog` wrapper (switches Drawer ↔ Dialog at `sm:`).
5. **Realtime**: enabled - each Phase 2 hook subscribes to its table's `postgres_changes` and invalidates the query. Gives free cross-device sync; ~10 LOC per hook.

Plan is ready. Phases 1-4 are designed to dispatch as parallel sub-agent batches without merge conflicts.

---

## 6. Sub-agent prompt templates

Each prompt below is **self-contained** - copy verbatim into the Agent tool. Use `subagent_type: "general-purpose"` unless noted. All agents must:
- Treat `../family-assistant/` as **read-only**.
- Run `pnpm check` (oxlint + oxfmt) before reporting done, and fix anything it flags.
- Commit their work on completion with a clear message; do **not** push.
- Report what they shipped + any deviations from the plan in their final message.

### Phase 0 - Scaffold (1 agent, sequential)

```
You are bootstrapping a Vite + React 19 + TypeScript SPA at /Users/nikolapajic/Desktop/Projekti/family-assistant-react/ that will be a ground-up rewrite of the Nuxt 3 app at /Users/nikolapajic/Desktop/Projekti/family-assistant/ (READ-ONLY). The full plan is in MIGRATION_PLAN.md at the repo root - read it first.

Execute Phase 0 ("Scaffold & foundations") exactly as specified. Key points:
- pnpm only. Latest stable versions of everything.
- Stack: React 19, Vite 7, TypeScript strict, TanStack Router (file-based), TanStack Query v5, Tailwind v4 (@tailwindcss/vite), shadcn/ui, vaul, @supabase/supabase-js, @heroicons/react, date-fns, react-day-picker, sonner, @dnd-kit/sortable, pulltorefreshjs, clsx, tailwind-merge, class-variance-authority. Dev: vitest + RTL + jsdom, oxlint, oxfmt, @types/pulltorefreshjs, tsx.
- Port src/types/database.ts VERBATIM from ../family-assistant/types/database.ts.
- Port the custom Tailwind utilities (scrollbar-hide, animate-fade-in, hover-lift, stagger-fade-in, html.dialog-open scroll lock, smooth color transitions) from ../family-assistant/assets/css/main.css into src/styles/index.css.
- Env: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env / .env.local / .env.example. For .env.local, copy the local Supabase values from ../family-assistant/.env.local (URL http://127.0.0.1:54321 + the local anon key).
- Ship a temporary "boot OK" placeholder route that displays the loaded VITE_SUPABASE_URL - proves env wiring.
- Add npm scripts: dev, build, preview, test, test:ui, lint, fmt, check (oxfmt --check && oxlint --deny-warnings), setup-family, setup-family:local.
- Vite base: '/family-assistant-react/' (commented as the GH Pages base path).
- Verify `pnpm dev` boots and the placeholder route loads cleanly in a browser. Verify `pnpm build` succeeds.
- Commit when green. Do not push.

Acceptance criteria are in MIGRATION_PLAN.md §3 Phase 0. When done, report what was scaffolded and what's ready for Phase 1's three parallel agents.
```

---

### Phase 1A - Auth + Theme + Routing shell

```
Phase 1A of the family-assistant React rewrite. Read MIGRATION_PLAN.md at the repo root, then the Operator's manual and §3 Phase 1 Agent 1A.

You OWN these files (do not touch anything else):
- src/hooks/{useSupabase,useAuth,useTheme,useProfile}.ts
- src/components/layout/{AppNav,AppNavLink,ThemeToggle,ProtectedRoute}.tsx
- src/routes/__root.tsx (wire AuthProvider + ThemeProvider + Toaster)
- src/routes/_app.tsx (new - protected layout with AppNav)
- src/routes/_app.index.tsx (stub h1 only; Phase 4 fills it)
- src/routes/login.tsx (new - port pages/login.vue)

Port from these Nuxt sources (READ-ONLY at ../family-assistant/):
- composables/{useAuth,useSupabase,useTheme,useProfile}.ts
- components/{AppNav,AppNavLink,ThemeToggle}.vue
- layouts/default.vue
- middleware/auth.global.ts
- pages/login.vue

Critical visual patterns (verify against .nuxt-screens/01-login-mobile.png, 02-dashboard-mobile.png, 09-dashboard-dark-mobile.png, 12-dashboard-desktop.png):
- Mobile nav = single sticky header: top row (logo + theme toggle + logout), second row directly below = horizontal-scroll nav with icon STACKED above label (`flex-col sm:flex-row`). Active = gray pill.
- Desktop nav = single row: logo, inline nav links, theme toggle + Odjavi se on the right.
- Layout: `<div class="min-h-screen w-full overflow-x-hidden bg-gray-50 dark:bg-gray-900"><AppNav/><main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"><Outlet/></main></div>`
- Theme toggle: 3 buttons (sun/moon/computer), localStorage key `theme-mode`, applies `dark` class on `<html>`, respects prefers-color-scheme when mode=`auto`.
- Auth: getSession on mount, attach onAuthStateChange ONCE (module-level guard). Redirect unauth → /login via TanStack Router beforeLoad.
- Profile hook returns { profile, family, familyId, familyName, isLoading } via TanStack Query; cache by user.id.

Test login (local Supabase only): nikola.pajic@gmail.com / admin123. After logging in, the stub dashboard at "/" should render with AppNav visible. Theme toggle must persist across reload. At 390px viewport you must see the bottom horizontal-scroll nav row.

Run `pnpm check`. Commit. Report what you shipped.
```

---

### Phase 1B - shadcn primitives + ResponsiveDialog + ConfirmDialog

```
Phase 1B of the family-assistant React rewrite. Read MIGRATION_PLAN.md and §3 Phase 1 Agent 1B.

You OWN (do not touch anything else):
- src/components/ui/*  (all shadcn primitives + custom date-picker, time-picker, responsive-dialog)
- src/components/common/ConfirmDialog.tsx
- components.json (shadcn config)

Steps:
1. `pnpm dlx shadcn@latest add button card dialog drawer input label dropdown-menu sonner popover calendar separator badge` (drawer brings vaul).
2. Extend Button cva variants: add `success` (green-600 / green-700 hover, white text). Keep originals: default, secondary, destructive, success, outline, ghost, link. Keep sizes: default, sm, lg, icon. The original Button.vue is at ../family-assistant/components/ui/button/Button.vue - read it to match styling intent.
3. Build src/components/ui/responsive-dialog.tsx - CRITICAL. At < `sm:` breakpoint renders <Drawer> (vaul), at ≥ `sm:` renders <Dialog>. Both expose identical slots: Root, Trigger, Content, Header, Title, Footer, Close. Drawer shows the grey drag-handle pill (vaul default) and uses max-h-[90vh]. Detection via a useMediaQuery hook is fine; default behavior must be Drawer until the media query confirms desktop (prevents SSR-style flash - though we're SPA, still nice).
4. Build src/components/ui/date-picker.tsx: shadcn Popover + react-day-picker Calendar. Props `{ value: string|null, onChange: (v: string|null) => void, placeholder?, id?, className? }`. Display DD.MM.YYYY (date-fns format); state YYYY-MM-DD. Clear "×" button on the right when value set.
5. Build src/components/ui/time-picker.tsx: HH:mm input + clear button. API mirrors date-picker.
6. Build src/components/common/ConfirmDialog.tsx using ResponsiveDialog. Props `{ open, onOpenChange, title, message, confirmLabel?, loading?, onConfirm }`. Destructive variant confirm button.

Visual reference: .nuxt-screens/07-expense-dialog-mobile.png (bottom-sheet + drag handle), 11-payment-edit-dialog-dark-mobile.png (sheet + 2-col layout intent - the 2-col is the form's job, not yours).

Make a temporary scratch route or storybook-style page that renders one of each primitive so visual eyeballing is possible. Delete it before committing.

Run `pnpm check`. Commit. Report what you shipped.
```

---

### Phase 1C - Utils + scripts + test scaffold

```
Phase 1C of the family-assistant React rewrite. Read MIGRATION_PLAN.md and §3 Phase 1 Agent 1C.

You OWN (do not touch anything else):
- src/utils/{date,birthday,event,format}.ts
- src/lib/cn.ts (if not already created in Phase 0)
- scripts/setup-family.ts
- vitest.config.ts (if not already created)
- src/utils/__tests__/utils.test.ts
- supabase/migrations/*.sql (copies)
- supabase/config.toml (copy)

Steps:
1. Copy src/utils/{date,birthday,event,format}.ts VERBATIM from ../family-assistant/utils/{date,birthday,event,format}.ts. Replace any `~/` imports with relative. These are pure TS + date-fns, no Vue.
2. If src/lib/cn.ts doesn't exist, create it as `clsx + tailwind-merge`. The original utils/cn.ts is a simpler concat - we're upgrading deliberately.
3. Port scripts/setup-family.ts from ../family-assistant/scripts/setup-family.ts. Replace its manual .env loader with reading `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from process.env (the npm script runs it with `tsx --env-file=.env.local`). Keep all Serbian prompts verbatim.
4. Add to package.json scripts: `"setup-family": "tsx --env-file=.env scripts/setup-family.ts"`, `"setup-family:local": "tsx --env-file=.env.local scripts/setup-family.ts"`.
5. vitest.config.ts: jsdom environment, globals true, setupFiles for @testing-library/jest-dom.
6. Write src/utils/__tests__/utils.test.ts with 5 smoke tests: addMonth('2026-01-31') → expected last-day-of-Feb; subtractMonth('2026-03-31') → similar; daysUntilBirthday for a date 10 days from today; formatAmount(2500) → "2.500 RSD"; isOverdue('2020-01-01') → true.
7. Copy ../family-assistant/supabase/migrations/*.sql (all 7 files) into supabase/migrations/ for repo completeness - DO NOT run them. Also copy supabase/config.toml.

Acceptance: `pnpm test` passes 5/5. `pnpm setup-family:local` prints the Serbian prompts when invoked (then Ctrl+C - do NOT actually run it against the live DB).

Run `pnpm check`. Commit. Report what you shipped.
```

---

### Phase 2A - useEvents hook

```
Phase 2A of the family-assistant React rewrite. Read MIGRATION_PLAN.md, especially §3 Phase 2 (the realtime pattern).

You OWN exactly one file: src/hooks/useEvents.ts

Port from ../family-assistant/composables/useEvents.ts (READ-ONLY).

Requirements:
- Convert each fetch function (fetchEvents) into a useQuery - queryKey `['events', familyId, { from, to }]`, queryFn calls supabase. enabled: !!familyId.
- Convert each mutation (createEvent, updateEvent, deleteEvent) into useMutation with onSuccess invalidating `['events', familyId]`.
- Add a realtime subscription inside the list hook (see MIGRATION_PLAN.md Phase 2 realtime snippet) on the `events` table filtered by `family_id=eq.${familyId}`, invalidating on any event.
- Keep the "all-day events first per day, then by start_time" sort logic from the Vue version.
- Export the same surface: a list hook + create/update/delete mutation hooks. Naming convention `useEventsList`, `useCreateEvent`, etc.

Acceptance: hook type-checks; opening two browser windows logged in to the same user shows realtime invalidation (changes in one window propagate to the other within ~1s). Real exercise comes in Phase 3A.

Run `pnpm check`. Commit. Report.
```

---

### Phase 2B - usePayments hook (largest)

```
Phase 2B of the family-assistant React rewrite. Read MIGRATION_PLAN.md §3 Phase 2.

You OWN exactly one file: src/hooks/usePayments.ts

Port from ../family-assistant/composables/usePayments.ts (READ-ONLY) - this is the most complex of the four data hooks. It includes:
- fetchPayments(hidePaid?), fetchPaymentHistory(monthFilter?), fetchPaymentHistoryByPaymentId(paymentId), hasPaymentHistory(paymentId), getLastHistoryEntry(paymentId)
- createPayment, updatePayment, deletePayment
- markAsPaid - transactional: inserts payment_history row, then updates payments based on recurrence_period ('one-time' | 'monthly' | 'limited'). Uses addMonth from utils/date.
- togglePause - flips is_paused; if unpausing and due_date is in the past, advances to the equivalent day in the current month (dueDateInCurrentMonth).
- undoLastPayment - multi-step revert: deletes last payment_history row, reverts payments state per recurrence type. Has an "already reverted" idempotency check that you MUST preserve.

Requirements:
- Wrap each fetch in useQuery with the right queryKey. List queryKey `['payments', familyId, { hidePaid }]`; history `['payment_history', familyId, monthFilter]`; per-payment history `['payment_history', paymentId]`.
- Mutations invalidate both `['payments', familyId]` AND `['payment_history', familyId]` on success.
- Realtime: subscribe to BOTH `payments` and `payment_history` (two .on() calls on the same channel or two channels). Filter by `family_id=eq.${familyId}`.
- Port every line of the recurrence logic verbatim - getting markAsPaid/undoLastPayment wrong will desync the DB.

Acceptance: marking a recurring payment paid in one window advances its due_date in the other window without refresh; undo restores it. Phase 3B exercises this UI.

Run `pnpm check`. Commit. Report.
```

---

### Phase 2C - useBirthdays hook

```
Phase 2C of the family-assistant React rewrite. Read MIGRATION_PLAN.md §3 Phase 2.

You OWN exactly one file: src/hooks/useBirthdays.ts

Port from ../family-assistant/composables/useBirthdays.ts (READ-ONLY). Surface: fetchBirthdays, createBirthday, updateBirthday, deleteBirthday.

Requirements:
- useQuery with queryKey `['birthdays', familyId]`, enabled: !!familyId.
- Mutations invalidate `['birthdays', familyId]` on success.
- Realtime subscription on `birthdays` table filtered by `family_id=eq.${familyId}`.

Acceptance: hook type-checks; realtime invalidation works between two windows.

Run `pnpm check`. Commit. Report.
```

---

### Phase 2D - useExpenses hook

```
Phase 2D of the family-assistant React rewrite. Read MIGRATION_PLAN.md §3 Phase 2.

You OWN exactly one file: src/hooks/useExpenses.ts

Port from ../family-assistant/composables/useExpenses.ts (READ-ONLY). Surface: fetchExpenses(hidePaid?), createExpense (assigns next sort_order at end), updateExpense, deleteExpense, markAsPaid, reorderExpenses (bulk update of sort_order).

Requirements:
- useQuery with queryKey `['expenses', familyId, { hidePaid }]`, enabled: !!familyId. Sort by sort_order ascending.
- Mutations invalidate `['expenses', familyId]` on success. reorderExpenses fires its updates in parallel (Promise.all) - port that.
- Realtime subscription on `expenses` table filtered by `family_id=eq.${familyId}`.

Acceptance: hook type-checks; realtime invalidation works.

Run `pnpm check`. Commit. Report.
```

---

### Phase 3A - Events feature UI

```
Phase 3A of the family-assistant React rewrite. Read MIGRATION_PLAN.md §3 Phase 3, including the visual patterns in §1.a.

You OWN these files (no overlap with other Phase 3 agents):
- src/routes/_app.events.tsx
- src/components/events/{EventListItem,EventForm,EventFormDialog}.tsx

Port from ../family-assistant/{pages/events/index.vue, components/events/*.vue}.

Visual reference: .nuxt-screens/03-events-mobile.png. Side-by-side comparison with the Nuxt app: see operator's manual at the top of MIGRATION_PLAN.md for the start command.

Requirements:
- Page header stacks vertically on mobile (`flex flex-col sm:flex-row`), with "Sakrij završene" checkbox + "Dodaj događaj" button.
- Filter row: Od / Do date pickers + "Prikaži sve" reset button. Use src/components/ui/date-picker.tsx from Phase 1B.
- List item: shows name, date (formatted via utils/date.formatDate), time range (utils/event.formatEventTimeRange), description, notes. Ended events get `opacity-75` + lighter bg. Responsive actions: mobile = kebab DropdownMenu, desktop = inline outline buttons (Izmeni, Obriši).
- EventFormDialog uses src/components/common/ConfirmDialog or ResponsiveDialog from Phase 1B. Form has: name (required), description, date (required), allDay checkbox, startTime/endTime (conditional on !allDay), notes. Right-aligned footer (Otkaži + Sačuvaj).
- Delete uses ConfirmDialog with message `Da li ste sigurni da želite da obrišete "${name}"?`.
- Use the useEventsList + mutation hooks from Phase 2A.

Acceptance: CRUD round-trips via the live local Supabase. At mobile viewport (390×844) matches .nuxt-screens/03-events-mobile.png in spirit. At desktop (1280×800) layout mirrors Nuxt.

Run `pnpm check`. Commit. Report.
```

---

### Phase 3B - Payments feature UI (largest)

```
Phase 3B of the family-assistant React rewrite. Read MIGRATION_PLAN.md §3 Phase 3B (it has more detail than the other features) and §1.a visual patterns.

You OWN these files:
- src/routes/_app.payments.tsx
- src/components/payments/{PaymentListItem,PaymentForm,PaymentFormDialog,PaymentHistoryPopup,PaymentUndoDialog}.tsx

Port from ../family-assistant/{pages/payments/index.vue, components/payments/*.vue}.

Visual references: .nuxt-screens/04-payments-mobile.png, 10-payment-detail-popup-dark-mobile.png, 11-payment-edit-dialog-dark-mobile.png, 13-payments-desktop.png. THIS IS THE MOST VISUAL-HEAVY FEATURE - do side-by-side comparison with the running Nuxt app at port 3002/3000 (see operator's manual for start command).

Hard parts to port carefully (read pages/payments/index.vue closely):
1. `combinedList` / `displayedList` computed: merges payments + payment_history + synthetic 'upcoming' rows per selected month. The discriminated union has three types: 'payment' | 'history' | 'upcoming'. Preserve the deduplication logic (one-time payments due in selected month should NOT also appear as history rows; recurring with existing history should NOT also appear as upcoming).
2. `summary` computed: per-month unpaid/paid totals including upcoming. For "Sva" view: total of all !is_paid && !is_paused.
3. `getItemClass(item)`: maps to overdue/paused/paid/history/upcoming color classes.
4. Polymorphic PaymentListItem (handles all three item types). You may either keep one component with `if (item.type === ...)` branches OR split into three small components. Pick whichever reads cleaner.
5. **Responsive action pattern (visually confirmed in 04 + 13 screenshots):** mobile = single kebab DropdownMenu; desktop (sm:) = inline Buttons (Pauziraj outline / Plaćeno success / Istorija outline+icon / Izmeni outline+icon / Obriši destructive+icon). One-time payments hide Pauziraj/Istorija. History rows show only Undo. Upcoming rows show no actions.
6. **PaymentForm layout (visually confirmed in 11):** Naziv / Opis full width; **Iznos + Datum dospeća are 2-column grid on sm:**; Tip is inline radios (Jednokratno / Mesečno / Ograničeno); Preostalo uplata only when Ograničeno; Pauziraj checkbox only when editing a recurring payment. Recurrence type is disabled if hasPaymentHistory is true. Right-aligned footer.
7. PaymentHistoryPopup: lists paid instances for a recurring payment, with Undo button on the latest entry only.
8. PaymentUndoDialog: confirmation before calling undoLastPayment.

Use the hooks from Phase 2B (usePayments). All recurrence logic lives in the hook - the UI just calls mutations.

Acceptance: every CRUD + mark-paid + togglePause + undo flow round-trips with the live local DB. Mobile and desktop visuals match the screenshots in spirit.

Run `pnpm check`. Commit. Report.
```

---

### Phase 3C - Birthdays feature UI

```
Phase 3C of the family-assistant React rewrite. Read MIGRATION_PLAN.md §3 Phase 3 and §1.a.

You OWN these files:
- src/routes/_app.birthdays.tsx
- src/components/birthdays/{BirthdayDisplayLine,BirthdayListItem,BirthdayForm,BirthdayFormDialog}.tsx

Port from ../family-assistant/{pages/birthdays/index.vue, components/birthdays/*.vue}.

Visual reference: .nuxt-screens/05-birthdays-mobile.png.

Requirements:
- Page header stacks on mobile; "Dodaj rođendan" button.
- Sort birthdays by `daysUntilBirthday` ascending (utility from utils/birthday).
- BirthdayDisplayLine renders "Marko puni 30 godina za 5 dana" - port the Serbian pluralization for "godina/godine/godinu" and "dan/dana/dana" exactly as in the Vue component.
- BirthdayListItem: name + description, with the display line. Responsive actions: mobile kebab dropdown, desktop inline outline buttons (Izmeni, Obriši).
- BirthdayFormDialog form: name (required), description, birth_date (required, DatePicker).
- Delete uses ConfirmDialog.
- Use useBirthdays hooks from Phase 2C.

Acceptance: CRUD round-trips. Visual match to screenshot.

Run `pnpm check`. Commit. Report.
```

---

### Phase 3D - Expenses feature UI

```
Phase 3D of the family-assistant React rewrite. Read MIGRATION_PLAN.md §3 Phase 3D and §1.a.

You OWN these files:
- src/routes/_app.expenses.tsx
- src/components/expenses/{ExpenseListItem,ExpenseForm,ExpenseFormDialog}.tsx

Port from ../family-assistant/{pages/expenses/index.vue, components/expenses/*.vue}.

Visual references: .nuxt-screens/06-expenses-mobile.png, 07-expense-dialog-mobile.png, 08-actions-dropdown-mobile.png.

Drag-to-reorder migration (sortablejs → @dnd-kit/sortable):
- Wrap the list in <DndContext sensors={[useSensor(PointerSensor)]}><SortableContext items={ids} strategy={verticalListSortingStrategy}>.
- ExpenseListItem uses useSortable to get {attributes, listeners, setNodeRef, transform, transition}.
- The drag handle (hamburger ☰ icon, left side of the row - see screenshot 06) gets `{...attributes} {...listeners}`. The rest of the row is NOT draggable so click-to-edit still works.
- onDragEnd: compute new order with arrayMove(items, oldIndex, newIndex), call useReorderExpenses mutation with the new sort_order values (1-indexed).

Other requirements:
- Page header: "Sakrij plaćene" checkbox + "Dodaj trošak" button. "Ukupno neplaćeno: NNN RSD" sentence below header when unpaid > 0.
- ExpenseListItem: name + amount, optional description, optional paid_date. Paid items get opacity-60. Responsive actions: mobile kebab (Označi kao plaćeno if unpaid, Izmeni, Obriši); desktop inline buttons.
- ExpenseFormDialog: name (required), description, amount (required number).
- Use useExpenses hooks from Phase 2D.

Acceptance: CRUD + reorder round-trips. Drag handle is positioned and styled like the screenshot. Mobile/desktop visuals match.

Run `pnpm check`. Commit. Report.
```

---

### Phase 4 - Dashboard

```
Phase 4 of the family-assistant React rewrite. Read MIGRATION_PLAN.md §3 Phase 4 and §1.a. All of Phases 1-3 must be complete before this runs.

You OWN these files:
- src/components/dashboard/{DashboardCard,DashboardCardItem,DashboardSummaryCard,DashboardEventCard,DashboardPaymentCard,DashboardBirthdayCard,DashboardExpenseCard}.tsx
- src/components/common/PullToRefresh.tsx
- src/routes/_app.index.tsx (replace stub with full dashboard)

Port from ../family-assistant/{pages/index.vue, components/dashboard/*.vue}.

Visual references: .nuxt-screens/02-dashboard-mobile.png, 09-dashboard-dark-mobile.png, 10-payment-detail-popup-dark-mobile.png, 12-dashboard-desktop.png.

Per-card accent colors (visually load-bearing - see screenshots):
- Events → blue (calendar icon, blue header pill)
- Payments → amber/orange icon, red/pink row tint + red amount for overdue rows
- Birthdays → green (cake icon, light-green rows, green "za N dana")
- Expenses → purple (shopping bag, light-purple rows, purple amounts)

DashboardCard takes `accent: 'blue' | 'amber' | 'green' | 'purple'` and derives:
- Header icon background pill
- DashboardCardItem row tint (light bg + accent text color)
Each card has primary "Dodaj X" + outline "Pogledaj sve" buttons in the footer.

Filter rules (from PRD):
- Events: next 14 days (utils/date.isUpcoming with 14)
- Payments: due ≤ 7 days OR overdue
- Birthdays: next 30 days (handle the "same-day overflow" - if more than 3 birthdays fall within 30 days, show the closest 3 + any additional ones on the same day as the third)
- Expenses: top 5 unpaid

Each DashboardCardItem click opens an inline detail Dialog/ResponsiveDialog (port from the Dashboard*Card.vue files - each has its own inline popup). Detail popup has "Izmeni" button that opens the feature's edit FormDialog (imported from Phase 3 folders).

PullToRefresh: wrap pulltorefreshjs in a React component. useEffect calls PullToRefresh.init({ mainElement: ref.current, onRefresh: props.onRefresh, ...visual config matching original }) on mount, destroys on unmount. Pull-to-refresh triggers reload of all 4 list queries (use queryClient.invalidateQueries for each).

Grid layout: 1 column on mobile, 2 columns on sm: and up (`grid gap-4 sm:grid-cols-2`). Apply `stagger-fade-in` utility on the grid for the entry animation.

Acceptance: dashboard mirrors screenshots in both light and dark mode. Pull-to-refresh works on mobile. Clicking an item opens its detail popup → Izmeni opens the feature edit dialog. Accent colors visible per card.

Run `pnpm check`. Commit. Report.
```

---

### Phase 5 - QA, polish, deploy (human-driven)

Not an agent task - this is the user driving final QA, side-by-side visual diffing, picking favicon/title tweaks, configuring the GH Pages workflow.
