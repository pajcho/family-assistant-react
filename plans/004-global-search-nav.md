# Plan 004: Global search derives its page list from navSections (Kalendar/Novac/Skola become searchable)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Touch
> only in-scope files. On any STOP condition, stop and report. Your reviewer
> maintains `plans/README.md` - do not edit it.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- src/components/search src/components/layout/navSections.ts`
> Excerpts below were taken at f46bc51; on mismatch beyond plans 001-003's own
> changes, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW-MED (typed router params)
- **Depends on**: plans/003-lint-ratchet.md (branch base)
- **Category**: tech-debt / ux
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

The Cmd+K palette keeps its own hardcoded page table from before the 2026-08
redesign. Typing "kalendar", "novac" or "skola" finds nothing - three of the
app's ten sections are unsearchable - while "uskoro", "placanja" and "budzet"
return entries that navigate to redirect-stub routes (an extra hop plus a
history rewrite). The repo already has a single source of truth for sections:
`src/components/layout/navSections.ts` (`NAV_SECTIONS`, 10 entries). Deriving
the search page list from it makes the palette permanently un-stale.

Conventions: Serbian UI strings, English comments, NO em/en dash characters
anywhere - ASCII `-` only.

## Current state

- `src/components/search/GlobalSearchDialog.tsx:57-83` - local `PageEntry`
  type (a literal union of 9 paths including dead `/uskoro`, `/payments`,
  `/budget`) and the hardcoded `PAGES` array with per-page heroicons.
- `GlobalSearchDialog.tsx:175-183` - `pageResults` useMemo filters `PAGES` by
  `normalizeTerm(p.label).includes(q)` and maps to
  `{ kind: "page", id: p.to, title: p.label, subtitle: null }`.
- `GlobalSearchDialog.tsx` select handler (~line 218):
  ```tsx
  case "page": {
    const page = PAGES.find((p) => p.to === result.id);
    if (page) void navigate({ to: page.to });
    break;
  }
  ```
  and the `external` case (~line 244) does `void navigate({ to: "/uskoro" })`.
- `src/components/layout/navSections.ts:65-82` - `NAV_SECTIONS`: 10 entries
  `{ key, to, search?, label, icon }`. Note `family` links to `/settings` WITH
  `search: { tab: "family" }`, and `settings` links to plain `/settings` - two
  entries share a path and differ by search params.
- Precedent that plain-string `to` works with the router: `src/components/layout/AppNav.tsx:177,258,286` pass `to={section.to}` (a `string`) straight to `Link`.
- Rendering: search rows use per-result icons only through `GROUP_META` today
  (one icon per GROUP). Check how the page group renders before assuming
  per-row icons are shown; the current `PageEntry.Icon` may already be unused
  at render time - if so, do NOT add per-row icon plumbing, just drop it.
- Existing test dir: `src/components/layout/__tests__/` (has a navSections
  test). CI has NO Supabase env - a test must never import anything that
  transitively reaches `src/lib/supabase.ts`. `GlobalSearchDialog.tsx` DOES
  transitively reach it (via `useGlobalSearch` and `LinkedEntityEditor`), so
  the derivation logic must live in a separate, dependency-light module to be
  testable.

## Commands you will need

| Purpose                                | Command        | Expected |
| -------------------------------------- | -------------- | -------- |
| Install                                | `pnpm install` | exit 0   |
| Check (incl. typecheck after plan 002) | `pnpm check`   | exit 0   |
| Tests                                  | `pnpm test`    | all pass |
| Build                                  | `pnpm build`   | exit 0   |

## Scope

**In scope**:

- `src/components/search/searchPages.ts` (NEW - pure derivation module)
- `src/components/search/GlobalSearchDialog.tsx`
- `src/components/search/__tests__/searchPages.test.ts` (NEW)

**Out of scope**: `navSections.ts` itself; the redirect stub routes
(`_app.uskoro.tsx`, `_app.payments.tsx`, `_app.budget.tsx` stay - they serve
push deep links and bookmarks); `useGlobalSearch.ts`; any entity-search logic.

## Git workflow

- Branch: create from plan 003's result: `git checkout -b advisor/004-global-search-nav advisor/003-lint-ratchet` (STOP if that base branch does not exist).
- Commit style: Serbian imperative, e.g. `Pretraga zna za Kalendar, Novac i Skolu - stranice iz navSections`. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Do NOT push or open a PR.

## Steps

### Step 1: Create `src/components/search/searchPages.ts`

A pure module importing ONLY from `@/components/layout/navSections` (and
types). Export:

```ts
export interface SearchPage {
  id: string;            // stable: section key
  to: string;
  search?: Record<string, string>;
  label: string;
}
export const SEARCH_PAGES: readonly SearchPage[] = NAV_SECTIONS.map(...);
```

`id` must be the section KEY (unique), not the path - `family` and `settings`
share `/settings`, so a path-keyed `find` would return the wrong entry.

**Verify**: `pnpm check` -> exit 0.

### Step 2: Rewire GlobalSearchDialog

- Delete the local `PageEntry` type and `PAGES` array.
- `pageResults` maps over `SEARCH_PAGES`, producing `id: page.id`.
- `case "page"`: look up by `SEARCH_PAGES.find((p) => p.id === result.id)` and
  navigate with `void navigate({ to: page.to, search: page.search })` (search
  may be undefined - fine). If TypeScript rejects the plain-string `to`,
  mirror AppNav's exact pattern; as a last resort a `to: page.to as never`
  cast is NOT acceptable - STOP instead and report the typing obstacle.
- `case "external"`: first read `src/routes/_app.kalendar.tsx` and determine
  the search-param shape (`validateSearch`) and its default view. If the
  agenda view is the default, change the navigate target to
  `void navigate({ to: "/kalendar" })`; otherwise pass the explicit search
  param for the agenda view. The `/uskoro` stub must no longer be referenced
  from this file.
- Remove now-unused heroicon imports (oxlint will flag them).

**Verify**: `pnpm check` -> exit 0; `grep -n '"/uskoro"\|"/payments"\|"/budget"' src/components/search/GlobalSearchDialog.tsx` -> no output.

### Step 3: Test the derivation

`src/components/search/__tests__/searchPages.test.ts`, modeled structurally on
the existing test in `src/components/layout/__tests__/`. Assert:

- `SEARCH_PAGES` has one entry per `NAV_SECTIONS` entry (length 10) and ids are unique.
- Labels include "Kalendar", "Novac", "Škola".
- No entry's `to` is one of `/uskoro`, `/payments`, `/budget`.
- The `family` entry carries `search.tab === "family"`.

**Verify**: `pnpm test -- searchPages` -> new tests pass; full `pnpm test` -> all pass (in particular, this test file must not error on import - if it fails with a Supabase env error, the module has a forbidden transitive import: STOP and fix the import chain, not the env).

### Step 4: Full gate

**Verify**: `pnpm check && pnpm test && pnpm build` -> all exit 0.

## Done criteria

- [ ] Typing normalized "kalendar", "novac", "skola" would match: `SEARCH_PAGES` contains those labels (asserted by test)
- [ ] `grep -rn '"/uskoro"' src/components/search` -> no output
- [ ] All commands in the table exit 0
- [ ] Only in-scope files changed (`git status`)

## STOP conditions

- Base branch `advisor/003-lint-ratchet` missing.
- Router typing rejects string `to` and AppNav's pattern does not transfer.
- The kalendar route's search validation REQUIRES params such that plain
  `/kalendar` navigation fails validation.
- The new test cannot avoid importing the Supabase chain.

## Maintenance notes

- Adding an 11th nav section now becomes searchable automatically; the test
  pins the derivation, not the count - update the length assertion when
  sections change.
- Follow-up (not here): the "Nedavno"/recents system and search could share
  per-section icons; GROUP_META currently gives all pages one generic icon.
