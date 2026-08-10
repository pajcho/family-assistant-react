# Plan 005: Fix visible UX drift - member chips (emoji), delete confirmations, quick-add toasts, date formats

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. Touch only in-scope files. On any
> STOP condition, stop and report. Your reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- src/components/dashboard/PersonFilterRow.tsx src/components/dashboard/AgendaFilters.tsx src/components/payments src/components/budget src/components/events src/components/birthdays src/components/lists`
> Changes from plans 001-003 are expected (deleted dead exports); anything else
> touching the excerpted regions is a STOP.

## Status

- **Priority**: P2
- **Effort**: M (a batch of S items)
- **Risk**: LOW
- **Depends on**: plans/003-lint-ratchet.md (branch base)
- **Category**: tech-debt / ux
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

Four small copy-paste families drifted into user-visible inconsistency:

1. The member filter chip row is written 4x; the payments and budget copies
   never got the member-emoji feature, so the same person renders differently
   on different screens.
2. Delete confirmation is hand-rolled in 4 detail dialogs; only activities
   shows a pending label while deleting - the other three give no feedback on
   a slow delete.
3. Of the 5 quick-add flows behind the global "+", only the expense one confirms with a
   toast; adding an event/birthday/payment/list just silently closes.
4. The same date renders as `13.01.2026` (budget list), `13.01.2026.` (receipt
   surfaces) and `13.1.2026.` elsewhere.

Conventions: Serbian UI strings, English comments, NO em/en dash - ASCII `-`
only. Dialog button labels have fixed meanings: `Odustani` (dismiss form),
`Nazad` (step back in a sub-view), `Zatvori` (close read-only), `Otkaži X`
(domain cancel) - the delete sub-view uses `Nazad` + `Obriši`.

## Current state

### A. Member chips (4 copies, 2 without emoji)

- `src/components/dashboard/PersonFilterRow.tsx:41-55` - the RICHEST copy
  (this is the shape to extract):
  ```tsx
  {
    members.map((member) => (
      <FilterChip
        key={member.id}
        active={selected.has(member.id)}
        onToggle={() => onToggle(member.id)}
        color={member.color ?? fallbackColorForProfile(member.id)}
        emoji={memberEmoji(member)}
      >
        {getDisplayName({
          firstName: member.first_name,
          lastName: member.last_name,
          email: null,
        }) || "Bez imena"}
      </FilterChip>
    ));
  }
  ```
  (uses `useFamilyMembers()`, `useMemberEmoji()` from
  `@/hooks/useMemberAvatarStyle`, `fallbackColorForProfile` from
  `@/utils/activity`, `getDisplayName` from `@/utils/identity`; wrapped in
  `FilterChipRow` with a leading "Svi" chip; hides when `members.length <= 1`).
- `src/components/dashboard/AgendaFilters.tsx` (~lines 82-96) - same block
  WITH emoji (it declares `const memberEmoji = useMemberEmoji();` at ~line 48).
- `src/components/payments/PaymentsPage.tsx:741-765` - same block WITHOUT
  emoji, embedded inside a larger `FilterChipRow` after "Sva"/category/"Samo
  plaćena" chips; guarded by `members.length > 1`.
- `src/components/budget/BudgetPage.tsx` (~lines 984-998) - same block WITHOUT
  emoji, same embedding style.
- NOT in scope: `src/components/common/PersonFilterChips.tsx` (PersonChip
  look, used by the events route - different visual family, leave it).

### B. Delete confirmations (4 copies)

- Body copy (in the sheet-stack "delete" view), e.g.
  `src/components/payments/PaymentDetailDialog.tsx:520-524`:
  ```tsx
  <p className="text-sm text-muted-foreground">
    Da li ste sigurni da želite da obrišete „{payment.name}"? Ova radnja se ne može opozvati.
  </p>
  ```
  Footer, `PaymentDetailDialog.tsx:751-764`: `ResponsiveDialogFooter` with
  `<Button variant="outline" onClick={pop} disabled={saving}>Nazad</Button>` and
  `<Button variant="destructive" onClick={() => { void handleDelete(); }} disabled={saving}>Obriši</Button>`.
- Same pair at `src/components/events/EventDetailDialog.tsx` (~303-307 body,
  ~450-464 footer), `src/components/birthdays/BirthdayDetailDialog.tsx`
  (~216-220, ~319-333), `src/components/activities/ActivityDetailDialog.tsx`
  (~199-203 body - with an extra sentence "Brišu se i svi njeni termini.",
  ~283-297 footer - the ONLY one with a pending label `{saving ? "Briše…" : "Obriši"}`).
- The shared module these dialogs already compose from:
  `src/components/common/DetailSheet.tsx` (exports DetailHero,
  DetailInfoRows, DetailActionRow etc.) - the natural home for the shared
  pieces.

### C. Quick-add success toasts

- `src/components/events/EventQuickAddFlow.tsx:30-40` - `handleSubmit` awaits
  `createEvent.mutateAsync(payload)` then `onOpenChange(false)`; NO success
  toast. Same shape in `src/components/birthdays/BirthdayQuickAddFlow.tsx`,
  `src/components/payments/PaymentQuickAddFlow.tsx`,
  `src/components/lists/ListQuickAddFlow.tsx`.
- `src/components/budget/ExpenseQuickAddFlow.tsx` (~line 46) is the one that
  DOES: `toast.success("Trošak je dodat.")` (import `{ toast } from "sonner"`).

### D. Date formats

- Canonical: `src/utils/date.ts:205-209`:
  ```ts
  export function formatDate(date: Date | string): string {
    const dateObj = typeof date === "string" ? parseISO(date) : date;
    if (!isValid(dateObj)) return "-";
    return format(dateObj, "dd.MM.yyyy", { locale: srLocale });
  }
  ```
- Local copy 1: `src/components/budget/ReceiptExpenseDialog.tsx:91-95`
  (`formatDate`, emits trailing dot `13.01.2026.`), used at line ~663.
- Local copy 2: `src/components/budget/receipt/ReceiptPreview.tsx:91-96`
  (`formatReceiptDate`, trailing dot, accepts full ISO timestamps via
  `issuedAt.slice(0, 10)`), used at line ~143.
- DECISION (made): canonical form is `dd.MM.yyyy` WITHOUT trailing dot -
  replace both local copies with `formatDate` from `@/utils/date` (it accepts
  ISO timestamps through `parseISO`). `DateField`'s long-form field label
  formatting is untouched.

## Commands you will need

| Purpose | Command        | Expected |
| ------- | -------------- | -------- |
| Install | `pnpm install` | exit 0   |
| Check   | `pnpm check`   | exit 0   |
| Tests   | `pnpm test`    | all pass |
| Build   | `pnpm build`   | exit 0   |

## Scope

**In scope**:

- NEW `src/components/common/MemberFilterChips.tsx` + test
- `src/components/dashboard/PersonFilterRow.tsx`, `src/components/dashboard/AgendaFilters.tsx`, `src/components/payments/PaymentsPage.tsx`, `src/components/budget/BudgetPage.tsx` (adopt chips)
- `src/components/common/DetailSheet.tsx` (add delete-confirm pieces) + the 4 detail dialogs (adopt)
- The 4 quick-add flow files (toasts)
- `src/components/budget/ReceiptExpenseDialog.tsx`, `src/components/budget/receipt/ReceiptPreview.tsx` (date format)

**Out of scope**: `PersonFilterChips.tsx` and the events/birthdays routes'
filters; `ExpenseFormDialog.tsx`'s own delete flow (different shell, already
has a pending label); any filter STATE logic (only the chip rendering moves);
`ConfirmDialog.tsx` (nested-dialog confirms elsewhere stay as they are).

## Git workflow

- Branch: `git checkout -b advisor/005-ux-drift-pack advisor/003-lint-ratchet` (STOP if base missing).
- English imperative commits per section (4 commits), trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No push, no PR.

## Steps

### Step 1: `MemberFilterChips` shared component

Create `src/components/common/MemberFilterChips.tsx`: renders ONLY the member
chips fragment (no row wrapper, so callers can embed it after their own
chips). Props:

```ts
{
  selected: ReadonlySet<string>;
  onToggle: (personId: string) => void;
}
```

Internally: `useFamilyMembers()`, `useMemberEmoji()`, the exact chip JSX from
the PersonFilterRow excerpt above (color fallback, emoji, display-name
fallback "Bez imena"). Render `null` when `members.length <= 1` (the shared
rule all four sites state). Use a fragment or `<div className="contents">` so
chips join the parent flex row (see `PersonFilterChips.tsx:29` for the
precedent and its comment style).

Then adopt it at the four sites, deleting their inline `members.map(...)`
blocks. PersonFilterRow keeps its own "Svi" chip and `FilterChipRow` wrapper;
PaymentsPage/BudgetPage keep their surrounding chips and simply replace the
member mapping (they GAIN emoji - that is the point); AgendaFilters keeps its
structure. Remove imports that become unused at each site.

**Verify**: `pnpm check` -> exit 0; `grep -rln "useMemberEmoji" src/components/payments/PaymentsPage.tsx src/components/budget/BudgetPage.tsx` -> NO direct hits needed (the shared component owns it); `grep -c "getDisplayName" src/components/payments/PaymentsPage.tsx` -> decreased vs before (member block gone). `pnpm test` -> pass.

### Step 2: Shared delete-confirm pieces

In `src/components/common/DetailSheet.tsx` add two exports (match the file's
existing prop/JSDoc style):

- `DetailDeleteBody({ name, note }: { name: string; note?: string })` ->
  renders the standard paragraph: `Da li ste sigurni da želite da obrišete
„{name}"?{note ? " " + note : ""} Ova radnja se ne može opozvati.`
- `DetailDeleteFooter({ deleting, onBack, onConfirm }: { deleting: boolean; onBack: () => void; onConfirm: () => void })`
  -> `ResponsiveDialogFooter` with outline `Nazad` (disabled while deleting)
  and destructive button labeled `{deleting ? "Brišem…" : "Obriši"}`.

Adopt in the 4 detail dialogs: replace each body paragraph and footer branch.
ActivityDetailDialog passes `note="Brišu se i svi njeni termini."`. The
standardized pending label is `Brišem…` (first person, matching
ExpenseFormDialog) - the activities' old `Briše…` goes away.

**Verify**: `grep -rn "ne može opozvati" src/components/payments src/components/events src/components/birthdays src/components/activities` -> only via the shared component (no inline copies); `grep -rn "Briše…" src` -> no output; `pnpm check && pnpm test` -> pass.

### Step 3: Quick-add success toasts

Add `import { toast } from "sonner";` and a success toast after the awaited
create in each of the 4 flows, matching ExpenseQuickAddFlow's placement
(after `mutateAsync` succeeds, before/with closing). Serbian gender matters:

- EventQuickAddFlow: `toast.success("Događaj je dodat.")`
- BirthdayQuickAddFlow: `toast.success("Rođendan je dodat.")`
- PaymentQuickAddFlow: `toast.success("Plaćanje je dodato.")`
- ListQuickAddFlow: `toast.success("Lista je dodata.")` (this flow has an
  extra stage - place the toast where the list is actually created; read the
  file first and mirror where ExpenseQuickAddFlow fires relative to its
  stages; if the flow already navigates into the new list as its own feedback,
  note that and STILL add the toast for consistency unless it double-fires).

**Verify**: `grep -rn "toast.success" src/components/events/EventQuickAddFlow.tsx src/components/birthdays/BirthdayQuickAddFlow.tsx src/components/payments/PaymentQuickAddFlow.tsx src/components/lists/ListQuickAddFlow.tsx` -> 4 hits; `pnpm test` -> pass.

### Step 4: Date format consolidation

Delete the local `formatDate` in `ReceiptExpenseDialog.tsx` and
`formatReceiptDate` in `ReceiptPreview.tsx`; import `formatDate` from
`@/utils/date` and use it at their call sites (line ~663 and ~143). The
visible change: receipt dates lose the trailing dot and match the budget list.

**Verify**: `grep -rn "function formatDate\|formatReceiptDate" src/components/budget` -> no local declarations remain; `pnpm check && pnpm test && pnpm build` -> all pass.

### Step 5: Test for the shared chips

`src/components/common/__tests__/MemberFilterChips.test.tsx`, modeled on an
existing test in the same dir (e.g. the EmptyState or FilterChips test - read
one first for the mocking style; `useFamilyMembers`/`useMemberEmoji` must be
mocked the way sibling tests mock hooks, never importing the real Supabase
chain). Assert: renders one chip per member with display name; renders null
with 0 or 1 member; onToggle fires with the member id; active follows the
`selected` set.

**Verify**: `pnpm test -- MemberFilterChips` -> pass. Full `pnpm test` -> pass.

## Done criteria

- [ ] One member-chip implementation: `grep -rn "fallbackColorForProfile" src/components/payments/PaymentsPage.tsx src/components/budget/BudgetPage.tsx src/components/dashboard/PersonFilterRow.tsx src/components/dashboard/AgendaFilters.tsx` -> 0 hits (all via MemberFilterChips)
- [ ] `grep -rn "Briše…" src` -> empty; all four dialogs render `Brišem…` while deleting
- [ ] 4 new `toast.success` calls in the quick-add flows
- [ ] No local date formatters left in `src/components/budget`
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0; only in-scope files changed

## STOP conditions

- Base branch `advisor/003-lint-ratchet` missing.
- A detail dialog's delete view turns out to have extra per-entity controls
  beyond body+footer (the plan's premise is they are uniform) - report which.
- MemberFilterChips cannot be tested without the Supabase chain (mock style
  missing) - report rather than shipping an untested component.
- Any existing test asserts the old wording/format you are changing - update
  ONLY if the test is clearly pinning the drifted copy (say so in NOTES);
  otherwise STOP.

## Maintenance notes

- New screens with member filtering must use `MemberFilterChips` - reviewers
  should reject fresh `members.map(... FilterChip ...)` blocks.
- The `emptyMeans` semantics divergence (empty = all vs "Svi" chip) is NOT
  unified by this plan - PersonFilterRow keeps its "Svi" chip, chips-only
  callers keep their local semantics. A future pass may unify.
- Deferred: folding the 5 QuickAddFlow files into one factory (batch C);
  this plan only fixes the visible toast drift so the factory can land later
  without UX pressure.
