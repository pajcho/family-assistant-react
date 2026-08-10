# Plan 003: Enable the zero-cost oxlint ratchet rules and fix the two context-value re-render sites

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report - do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f46bc51..HEAD -- .oxlintrc.json .oxfmtrc.json src/hooks/useAuth.tsx src/hooks/useTheme.tsx supabase/functions`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (001 recommended first so lint runs on less code, not required)
- **Category**: dx
- **Planned at**: commit `f46bc51`, 2026-08-09

## Why this matters

The lint config enables only the `correctness` category. Measurement at commit
f46bc51 shows several high-value rules would cost almost nothing to turn on
because the codebase already complies: `typescript/no-explicit-any` has 4
violations (all in Deno edge functions), `typescript/ban-ts-comment` has 0,
`eqeqeq` with the `null: ignore` option has 0, `no-console` has 1 legitimate
`console.error` in `src`. Enabling them now converts an unenforced convention
into a ratchet - the next `as any` or stray `console.log` fails CI instead of
landing silently.

Two measured React findings ride along because they are one-line fixes with
app-wide effect: both global context providers (`useAuth`, `useTheme`) pass a
freshly-constructed object as `value`, so EVERY consumer of auth or theme
re-renders whenever either provider renders. The rule that catches this
(`react/jsx-no-constructed-context-values`) gets enabled in the same config
change.

Also fixes a latent config asymmetry: `.oxfmtrc.json` declares
`ignorePatterns` but `.oxlintrc.json` has none and currently relies on
`.gitignore` alone; if `src/routeTree.gen.ts` is ever committed (a live option
in Plan 002's fallback), 25 generated `as any` casts would instantly break CI
under the new rules.

Repo conventions: user-visible strings Serbian, comments English, em dash /
en dash / Unicode minus FORBIDDEN everywhere - ASCII `-` only.

## Current state

- `.oxlintrc.json` (verbatim rules section today):
  ```json
  "categories": { "correctness": "error" },
  "rules": {
    "react/react-in-jsx-scope": "off",
    "import/no-namespace": "error",
    "jsx-a11y/control-has-associated-label": "off",
    "jsx-a11y/no-autofocus": "off",
    "jsx-a11y/prefer-tag-over-role": "off",
    "react/rules-of-hooks": "error",
    "import/no-cycle": "error",
    "import/no-duplicates": "error"
  },
  "overrides": [
    { "files": ["**/*.test.ts", "**/*.test.tsx", "src/**/__tests__/**"], "plugins": ["vitest"] }
  ]
  ```
- `.oxfmtrc.json` has `ignorePatterns` covering `dist/`, `src/routeTree.gen.ts`, `.nuxt-screens/`; `.oxlintrc.json` has no `ignorePatterns` key.
- oxlint version 1.77.x (floating `latest`); rule names below verified to exist in `node_modules/oxlint/configuration_schema.json`.
- Measured violations at f46bc51 (via `oxlint -A all -D <rule>`):
  - `typescript/no-explicit-any`: 4 - `supabase/functions/send-due-pushes/index.ts:142`, `:277`, `:373` and `supabase/functions/notify-on-create/index.ts:208`
  - `typescript/ban-ts-comment`: 0
  - `eqeqeq` with `{"null":"ignore"}`: 0 (all 120 loose comparisons in the repo are deliberate `x == null` nullish checks)
  - `no-console` with `allow: ["warn","error"]`: 0 in `src/` (the one `src` hit, `src/hooks/usePwaUpdate.tsx:46`, is a `console.error`); `scripts/` and `supabase/functions/` use console as their logger and get an override
  - `unicorn/prefer-node-protocol`: 1 (autofixable; run the lint to locate it - it is in a Node-context file such as a script or config)
  - `react/jsx-no-constructed-context-values`: 2 - see below
- `src/hooks/useAuth.tsx` (~lines 104-112):
  ```tsx
  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    signIn,
    signOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  ```
  (`signIn` and `signOut` are already `useCallback`-wrapped in this file.)
- `src/hooks/useTheme.tsx` (~line 112):
  ```tsx
  return (
    <ThemeContext.Provider value={{ mode, isDark, setMode }}>{children}</ThemeContext.Provider>
  );
  ```
- One legacy suppression comment: `src/components/dashboard/AgendaUpcomingList.tsx:372` has a hand-written `eslint-disable`-style comment naming `react-hooks/exhaustive-deps`; oxlint's rule id is `react/exhaustive-deps`.

## Commands you will need

| Purpose         | Command                            | Expected on success    |
| --------------- | ---------------------------------- | ---------------------- |
| Lint            | `pnpm exec oxlint --deny-warnings` | exit 0, no diagnostics |
| Full check      | `pnpm check`                       | exit 0                 |
| Tests           | `pnpm test`                        | exit 0                 |
| Build/typecheck | `pnpm build`                       | exit 0                 |

## Scope

**In scope**:

- `.oxlintrc.json`
- `supabase/functions/send-due-pushes/index.ts`, `supabase/functions/notify-on-create/index.ts` (4 `any` fixes)
- `src/hooks/useAuth.tsx`, `src/hooks/useTheme.tsx` (2 `useMemo` fixes)
- The single `prefer-node-protocol` site the lint reports
- `src/components/dashboard/AgendaUpcomingList.tsx` (normalize/remove one suppression comment)
- `plans/README.md` (status update)

**Out of scope**:

- Enabling whole categories (`suspicious`, `pedantic`, `style`, `restriction`) - measured and rejected; see plans/README.md.
- `react/no-unstable-nested-components` (23 sites) and `react/no-object-type-as-default-prop` (4 sites) - real but each fix needs judgment; separate batch.
- `react/no-array-index-key` - all 9 current sites are benign (skeleton loaders, PIN pad, static strips); not worth the rule today.
- Type-aware linting (`oxlint-tsgolint`) - separate spike.
- Edge-function behavior - the 4 `any` fixes must be type-level only.

## Git workflow

- Branch: `advisor/003-lint-ratchet`
- Commit style: English imperative, e.g. `Lint ratchet: no-explicit-any, eqeqeq, no-console and the context-value rules`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extend `.oxlintrc.json`

Add to the existing `rules` object (keep everything already there):

```json
"typescript/no-explicit-any": "error",
"typescript/ban-ts-comment": "error",
"eqeqeq": ["error", "always", { "null": "ignore" }],
"no-console": ["error", { "allow": ["warn", "error"] }],
"unicorn/prefer-node-protocol": "error",
"react/jsx-no-constructed-context-values": "error"
```

Add a top-level `ignorePatterns` key mirroring the formatter config:

```json
"ignorePatterns": ["dist", "src/routeTree.gen.ts", ".nuxt-screens"]
```

(Match the exact pattern strings used in `.oxfmtrc.json` - read that file
first and copy its values verbatim.)

Append to the existing `overrides` array (do not replace the vitest entry):

```json
{
  "files": ["scripts/**", "supabase/functions/**"],
  "rules": { "no-console": "off" }
}
```

**Verify**: `pnpm exec oxlint --deny-warnings` -> exits NON-zero listing exactly the expected violations (4x no-explicit-any in the two edge functions, 1x prefer-node-protocol, 2x jsx-no-constructed-context-values). If the list contains anything else, STOP.

### Step 2: Fix the 4 edge-function `any`s

In `supabase/functions/send-due-pushes/index.ts:142,277,373` and
`supabase/functions/notify-on-create/index.ts:208`, replace `any` with
`unknown` plus the minimal narrowing the surrounding code needs (or a precise
local interface if the shape is obvious from usage). Behavior must not change;
these are Deno files not covered by `tsc -b`, so correctness here is judged by
lint + reading.

**Verify**: `pnpm exec oxlint --deny-warnings` no longer reports `no-explicit-any`; `pnpm test` still exits 0 (edge-function tests live under `supabase/functions/**` and run in vitest).

### Step 3: Fix the two context values

`src/hooks/useAuth.tsx`: wrap the `value` object in
`useMemo(() => ({ session, user: session?.user ?? null, loading, signIn, signOut }), [session, loading, signIn, signOut])`.

`src/hooks/useTheme.tsx`: hoist the inline object into
`const value = useMemo(() => ({ mode, isDark, setMode }), [mode, isDark, setMode]);`
and pass `value={value}`.

Add the `useMemo` import if missing. Do not change anything else in either file.

**Verify**: `pnpm exec oxlint --deny-warnings` -> jsx-no-constructed-context-values gone; `pnpm test` -> exit 0 (auth/theme behavior covered indirectly by component tests).

### Step 4: Fix the `prefer-node-protocol` site and the legacy suppression

Apply the one `prefer-node-protocol` fix the lint reports (prefix the bare
Node builtin import with `node:`).

At `src/components/dashboard/AgendaUpcomedList.tsx:372` - note: the actual
file is `AgendaUpcomingList.tsx` - first try DELETING the legacy
`eslint-disable` comment and running the lint; if `react/exhaustive-deps`
then fires on that line, replace the comment with
`// oxlint-disable-next-line react/exhaustive-deps -- <keep the original justification text>`;
if nothing fires, leave the comment deleted.

**Verify**: `pnpm exec oxlint --deny-warnings` -> exit 0, zero diagnostics.

### Step 5: Full gate

**Verify**: `pnpm check && pnpm test && pnpm build` -> all exit 0.

## Test plan

No new tests. The context-provider change is behavior-preserving (same values,
stable identity); the existing suite plus a manual sanity check that the lint
output is empty is sufficient. If you want extra confidence on Step 3, run
`pnpm test -- useAuth` style filters to execute any provider-adjacent tests.

## Done criteria

- [ ] `pnpm exec oxlint --deny-warnings` exits 0
- [ ] `.oxlintrc.json` contains the 6 new rules, `ignorePatterns`, and the scripts/functions override
- [ ] `grep -rn ": any" supabase/functions --include='*.ts' | grep -v test` returns no hits at the four planned lines
- [ ] `useAuth.tsx` and `useTheme.tsx` both memoize their provider `value`
- [ ] `pnpm check && pnpm test && pnpm build` all exit 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's lint run reports violations NOT in the measured list (the floating
  `oxlint@latest` may have shipped new checks or renamed a rule since
  measurement) - report the full diagnostic list.
- A rule name is rejected as unknown by the config schema (rename upstream).
- An edge-function `any` fix requires changing runtime logic to satisfy the
  type - that code path needs a human look.
- Step 3 causes any test failure - do not chase it; report which test.

## Maintenance notes

- These rules are ratchets: they only stay valuable if `--deny-warnings` keeps
  CI red on violations. Do not add suppression comments to bypass them without
  a `-- reason` suffix.
- Follow-up candidates measured but deferred: `react/no-unstable-nested-components`
  (23 sites), `react/no-object-type-as-default-prop` (4), `oxc/no-map-spread`
  (8), type-aware rules via `oxlint-tsgolint` (needs a spike), and `knip` for
  unused-export detection. See plans/README.md.
- If Plan 002's fallback (committing `src/routeTree.gen.ts`) is ever taken,
  the `ignorePatterns` entry added here is what keeps CI green.
