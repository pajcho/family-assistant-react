import { format, parseISO, isValid } from "date-fns";

import { srLocale } from "@/utils/date";
import type { ListWithItems } from "@/types/database";

/**
 * Client-side export of a single list to Markdown or CSV.
 *
 * Both formats include item name, status, created-at, and completed-at so
 * the export is useful both as a human-readable snapshot (Markdown) and as
 * a spreadsheet-friendly archive (CSV). Files are triggered via a Blob URL
 * - no server round-trip, no temp storage.
 *
 * CSV notes
 * ---------
 * • UTF-8 BOM at the start so Excel on Windows detects encoding and shows
 *   Serbian diacritics correctly. Without the BOM, "š/č/ž/đ" render as
 *   mojibake on the most common Excel default.
 * • Fields are always quoted so commas inside item names ("Mleko, 2L")
 *   don't break parsing. Internal double-quotes are escaped by doubling.
 * • CRLF line terminators because that's what Excel emits and round-trips
 *   cleanest across editors.
 *
 * Markdown notes
 * --------------
 * • GitHub-flavoured task list - pastes into Issues / PRs / Notion / Slack
 *   with checkboxes intact.
 * • Active and completed sections are split so the active to-do list is
 *   easy to scan; completed items carry their finished-at timestamp.
 */

const SCOPE_LABEL: Record<ListWithItems["scope"], string> = {
  family: "Porodica",
  personal: "Lično",
};

/** DD.MM.YYYY HH:mm or "" - used in both export formats. */
function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = parseISO(iso);
  if (!isValid(d)) return "";
  return format(d, "dd.MM.yyyy HH:mm", { locale: srLocale });
}

/** Today as YYYY-MM-DD for the filename. */
function todayForFilename(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * Slug-safe filename component. Replaces diacritics with their Latin base,
 * collapses anything non-alphanumeric to a hyphen, and trims edge hyphens.
 * Result is always at least "lista" so we never produce a dangling
 * "-2026-05-25.csv" if the user named their list with emojis only.
 */
function slugify(name: string): string {
  const normalised = name
    .normalize("NFKD")
    // U+0300..U+036F = combining diacritical marks emitted by NFKD.
    // Written as explicit \u escapes so the source stays ASCII-clean.
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
  const slug = normalised
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "lista";
}

/**
 * Indent every line of a (possibly multi-line, possibly Markdown)
 * description so it nests under a preceding `- [ ] ...` task-list line
 * per GFM's lazy-continuation rules. Two spaces lines the content up
 * with the start of the task text (column 3, after `- `).
 *
 * We do not transform the markdown beyond indentation - any inline
 * formatting (bold/italic/links) survives untouched, so the export
 * stays faithful to what the user typed in the popup.
 */
function indentDescription(description: string): string[] {
  return description
    .trim()
    .split(/\r?\n/)
    .map((line) => `  ${line}`);
}

function buildMarkdown(list: ListWithItems): string {
  const active = list.list_items.filter((i) => !i.is_completed);
  const completed = list.list_items.filter((i) => i.is_completed);
  const exportedAt = format(new Date(), "dd.MM.yyyy HH:mm", { locale: srLocale });

  const lines: string[] = [];
  lines.push(`# ${list.name}`);
  lines.push("");
  lines.push(`> ${SCOPE_LABEL[list.scope]} · Eksportovano: ${exportedAt}`);
  lines.push("");

  // List-level description (if any). Inserted as-is between the
  // metadata blockquote and the first section heading so it shows up
  // in any markdown viewer with its full formatting intact.
  if (list.description && list.description.trim()) {
    lines.push(list.description.trim());
    lines.push("");
  }

  lines.push(`## Aktivne (${active.length})`);
  lines.push("");
  if (active.length === 0) {
    lines.push("_Nema aktivnih stavki._");
  } else {
    for (const item of active) {
      lines.push(`- [ ] ${item.name}`);
      if (item.description && item.description.trim()) {
        lines.push(...indentDescription(item.description));
      }
    }
  }
  lines.push("");

  lines.push(`## Završene (${completed.length})`);
  lines.push("");
  if (completed.length === 0) {
    lines.push("_Nema završenih stavki._");
  } else {
    for (const item of completed) {
      const stamp = formatStamp(item.completed_at);
      lines.push(stamp ? `- [x] ${item.name} - završeno ${stamp}` : `- [x] ${item.name}`);
      if (item.description && item.description.trim()) {
        lines.push(...indentDescription(item.description));
      }
    }
  }
  lines.push("");

  return lines.join("\n");
}

/** Escape one CSV field per RFC 4180: wrap in quotes, double internal quotes. */
function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function buildCsv(list: ListWithItems): string {
  // Per-list metadata header - two-column key/value rows above the
  // items table. CSV doesn't have a "metadata section" standard, but
  // every common viewer (Excel, Numbers, LibreOffice) is happy with a
  // few extra rows above the table proper, and parsers that read by
  // header name (e.g. Python's `csv.DictReader` pointed at the right
  // row) can skip ahead. We include "Opis" only when it's non-empty
  // so the metadata stays terse for lists that don't use it.
  const metaRows: string[] = [];
  metaRows.push([csvField("Lista"), csvField(list.name)].join(","));
  metaRows.push([csvField("Pristup"), csvField(SCOPE_LABEL[list.scope])].join(","));
  if (list.description && list.description.trim()) {
    metaRows.push([csvField("Opis"), csvField(list.description.trim())].join(","));
  }
  // Blank line separates the metadata block from the items table so
  // spreadsheets render it as a visual gap.
  metaRows.push("");

  const header = ["Stavka", "Opis", "Status", "Kreirano", "Završeno"].map(csvField).join(",");
  const rows = list.list_items.map((item) => {
    const status = item.is_completed ? "Završena" : "Aktivna";
    return [
      csvField(item.name),
      csvField(item.description?.trim() ?? ""),
      csvField(status),
      csvField(formatStamp(item.created_at)),
      csvField(formatStamp(item.completed_at)),
    ].join(",");
  });
  // UTF-8 BOM keeps Excel from mojibake-ing Š/Č/Ć/Ž/Đ on Windows.
  return "﻿" + [...metaRows, header, ...rows].join("\r\n") + "\r\n";
}

/**
 * Trigger a download for a string blob. We create the URL, click a
 * synthetic anchor, then revoke the URL so we don't keep references
 * around - same dance used by every "save text as file" snippet.
 */
function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a tick to actually start the download before we
  // invalidate the URL. Safari in particular has been seen to abort if
  // we revoke synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportListAsMarkdown(list: ListWithItems): void {
  const filename = `${slugify(list.name)}-${todayForFilename()}.md`;
  downloadBlob(buildMarkdown(list), filename, "text/markdown");
}

export function exportListAsCsv(list: ListWithItems): void {
  const filename = `${slugify(list.name)}-${todayForFilename()}.csv`;
  downloadBlob(buildCsv(list), filename, "text/csv");
}

// Exposed for unit tests - pure transforms with no DOM side effects.
export const __testables = { buildMarkdown, buildCsv, slugify, csvField };
