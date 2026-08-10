# AGENTS.md

Instructions for AI agents (Claude Code, Cursor and the like) working on this repository.

## The codebase is written in English

**Everything that is not shown to a user is written in English.** No exceptions,
no per-file negotiation. That covers:

| Where                 | Rule                                                             |
| --------------------- | ---------------------------------------------------------------- |
| Code comments         | English                                                          |
| Database comments     | English - `COMMENT ON`, and `--` comments inside migrations      |
| Identifiers           | English - variables, functions, types, props, object keys        |
| File and folder names | English                                                          |
| URLs and routes       | English - path segments, search param names, search param values |
| Commit messages       | English                                                          |
| Pull requests         | English - title, description, review comments                    |
| Docs                  | English - `README.md`, this file, `plans/`, every other `.md`    |
| Test names            | English - `describe` / `it` descriptions                         |

The one exception is **text a user reads on screen**: labels, buttons, empty
states, toasts, push notification copy and the kid app's wording are **Serbian
(Latin script)** and stay that way. They live in string literals, so the split
is easy to keep: a Serbian string is data the app renders, everything around it
is English.

Localization comes later, and when it does the Serbian copy moves into a
translation layer. That is the reason for the rule: the code around the copy has
to be language-neutral before the copy can be swapped for a language picker.
Values that are **persisted** (enum keys, `nav_slots` entries, theme names,
category keys) were already English for the same reason - see the rule below.

### Values stored in the database are English

Anything written to the database is an English key (`blue`, `purple`,
`payments`, `receipt`). Serbian belongs only in the label that renders it. A
lookup table maps the key to its label in the UI layer.

### New URLs are English

Every new route, path segment, search param name and search param value is
English: `/calendar?view=week`, not `/kalendar?view=nedelja`. The Serbian paths
that used to exist (`/kalendar`, `/novac`, `/skola`, `/uskoro`, `/kid/veza`,
`/kid/pregled`, `/kid/raspored`, `/kid/porodica`, `/kid/uskoro`) were renamed
with no redirects left behind.

Two legacy English redirect stubs are deliberately still standing: `/payments`
and `/budget` both land on `/money`, because payment reminder push notifications
deep-link to them and those links live on people's phones long after a deploy.

## Punctuation: never a long dash

**Never use a long dash.** Use a plain ASCII hyphen `-` (U+002D).

Forbidden characters, everywhere in the repository - in code, comments,
user-visible text, commit messages, PR descriptions, documentation and SQL:

| Character   | Code                   | Name                |
| ----------- | ---------------------- | ------------------- |
| `—`         | U+2014                 | em dash             |
| `–`         | U+2013                 | en dash             |
| `−`         | U+2212                 | minus sign          |
| `‐` `‑` `―` | U+2010, U+2011, U+2015 | other dash variants |

Always `-` instead:

```
BAD:   Iznos je okvirni — tačan potvrđuješ pri plaćanju.
GOOD:  Iznos je okvirni - tačan potvrđuješ pri plaćanju.

BAD:   income − expenses = remainder        BAD:   6–12 months
GOOD:  income - expenses = remainder        GOOD:  6-12 months
```

Reason: the long dash is a typical trace of AI-generated text and the repository
owner does not want it. This is not a style preference to be renegotiated per
file - it holds for the whole project, without exception.

### Checking

`pnpm check` includes `pnpm check:dashes` ([scripts/check-dashes.sh](scripts/check-dashes.sh)),
which scans every git-tracked file and fails on any of the characters above. Run
it before committing.

The script reads `git ls-files`, so it **does not see files that are not yet
added to git**. When checking a new file, `git add` it first and only then run
`pnpm check` - otherwise it passes for the wrong reason.

This file (`AGENTS.md`) is the only one exempt from the check, because it has to
display the forbidden characters in order to explain what they are.

### Two deliberate exceptions

1. The whole `supabase/migrations/` folder is skipped. Those are applied,
   historical migrations; their text is recorded byte for byte in
   `supabase_migrations.schema_migrations.statements` in production, so editing
   them would create drift for no benefit (every dash there is inside an SQL
   comment). **Write new migrations without a long dash** - the rule holds for
   them too, the script just does not check them retroactively.

2. **`─` (U+2500, box drawing)** - allowed. That is not a dash in a sentence but
   an ASCII-art section separator in comments (`// ──── Section ────`), and it
   stays.

## Other

- Button labels have settled meanings: `Odustani` (dismiss a form), `Otkaži X`
  (domain-level cancellation), `Zatvori` (close a read-only view), `Nazad` (one
  step back inside a sub-view).
- Lint/format is Oxc: `pnpm check` = `oxfmt --check` + `oxlint --deny-warnings` +
  the dash check + `pnpm typecheck`. Typecheck runs standalone and on a fresh
  checkout: `pnpm typecheck` = `tsr generate && tsc -b`, i.e. it generates the
  git-ignored `src/routeTree.gen.ts` itself (settings in [tsr.config.json](tsr.config.json)
  follow the `tanstackRouter` plugin from [vite.config.ts](vite.config.ts)). On
  every PR, CI (`.github/workflows/ci.yml`) runs those same checks as separate
  steps, plus `pnpm test` and `pnpm build`; there `pnpm build` remains the
  authoritative build + typecheck, because `vite build` generates the route tree
  itself. Run `pnpm check` and `pnpm test` locally before opening a PR anyway.
- The job `name:` in `.github/workflows/ci.yml` IS the required status check
  context of the `Protect main` ruleset (today `Lint, tests, build`). Rename the
  job and that check never reports, so every PR sits at
  `mergeStateStatus: BLOCKED` under a green CI - as happened in PR #132. Update
  the ruleset in the same change:
  `gh api -X PUT repos/pajcho/family-assistant-react/rulesets/19621451`.
- Never commit straight to `main` - always a branch, then a PR (squash-merge).
