#!/usr/bin/env bash
# Fails if any long dash sneaks into the repo. See AGENTS.md.
#
# Banned: em dash (U+2014), en dash (U+2013), minus sign (U+2212), and the
# hyphen variants U+2010 / U+2011 / U+2015. The only correct dash is ASCII "-".
#
# Skipped: supabase/migrations/** (already-applied history, byte-recorded in
# schema_migrations.statements on prod) and U+2500 "─" box-drawing separators,
# which are ASCII art in comments rather than punctuation.
#
# Matching is done in perl, not grep: a bracket expression listing those code
# points is matched byte-wise unless the locale is UTF-8, and since every one of
# them starts with 0xE2 that would also flag arrows, box-drawing and bullets.
#
# AGENTS.md is skipped because it is the rule's own documentation: it has to
# print the banned glyphs in order to say which ones are banned, so it would
# always fail its own check. This file avoids them by naming code points only,
# which is why it needs no exemption.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

# git-tracked, excluding already-applied migrations and the rule doc, text files
# only (-I drops binaries such as icons and screenshots).
files=$(
  git ls-files | grep -vE '^(supabase/migrations/|AGENTS\.md$)' | while IFS= read -r f; do
    grep -Iq . "$f" 2>/dev/null && printf '%s\n' "$f"
  done
)

hits=$(
  printf '%s\n' "$files" | tr '\n' '\0' | xargs -0 perl -CSD -ne '
    print "$ARGV:$.: $_" if /[\x{2014}\x{2013}\x{2212}\x{2010}\x{2011}\x{2015}]/;
    # $. keeps counting across files unless ARGV is closed at each EOF, which
    # would report line 1201 instead of line 1.
    close ARGV if eof;
  '
)

if [ -n "$hits" ]; then
  printf '%s\n' "$hits" >&2
  echo >&2
  echo "Nadjena dugacka crtica. Zameni je obicnim ASCII hyphenom '-'." >&2
  echo "Pravilo: AGENTS.md" >&2
  exit 1
fi

echo "check-dashes: nema dugackih crtica"
