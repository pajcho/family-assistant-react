import { format, parseISO, isValid } from "date-fns";

import { srLocale } from "@/utils/date";
import type { ListWithItems } from "@/types/database";

/**
 * Client-side export of a single list to Markdown or CSV.
 *
 * Both formats include item name, status, created-at, and completed-at so
 * the export is useful both as a human-readable snapshot (Markdown) and as
 * a spreadsheet-friendly archive (CSV). Files are triggered via a Blob URL
 * — no server round-trip, no temp storage.
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
 * • GitHub-flavoured task list — pastes into Issues / PRs / Notion / Slack
 *   with checkboxes intact.
 * • Active and completed sections are split so the active to-do list is
 *   easy to scan; completed items carry their finished-at timestamp.
 */

const SCOPE_LABEL: Record<ListWithItems["scope"], string> = {
  family: "Porodica",
  personal: "Lično",
};

/** DD.MM.YYYY HH:mm or "" — used in both export formats. */
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

function buildMarkdown(list: ListWithItems): string {
  const active = list.list_items.filter((i) => !i.is_completed);
  const completed = list.list_items.filter((i) => i.is_completed);
  const exportedAt = format(new Date(), "dd.MM.yyyy HH:mm", { locale: srLocale });

  const lines: string[] = [];
  lines.push(`# ${list.name}`);
  lines.push("");
  lines.push(`> ${SCOPE_LABEL[list.scope]} · Eksportovano: ${exportedAt}`);
  lines.push("");

  lines.push(`## Aktivne (${active.length})`);
  lines.push("");
  if (active.length === 0) {
    lines.push("_Nema aktivnih stavki._");
  } else {
    for (const item of active) {
      lines.push(`- [ ] ${item.name}`);
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
      lines.push(stamp ? `- [x] ${item.name} — završeno ${stamp}` : `- [x] ${item.name}`);
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
  const header = ["Stavka", "Status", "Kreirano", "Završeno"].map(csvField).join(",");
  const rows = list.list_items.map((item) => {
    const status = item.is_completed ? "Završena" : "Aktivna";
    return [
      csvField(item.name),
      csvField(status),
      csvField(formatStamp(item.created_at)),
      csvField(formatStamp(item.completed_at)),
    ].join(",");
  });
  // UTF-8 BOM keeps Excel from mojibake-ing Š/Č/Ć/Ž/Đ on Windows.
  return "﻿" + [header, ...rows].join("\r\n") + "\r\n";
}

/**
 * Trigger a download for a string blob. We create the URL, click a
 * synthetic anchor, then revoke the URL so we don't keep references
 * around — same dance used by every "save text as file" snippet.
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

// Exposed for unit tests — pure transforms with no DOM side effects.
export const __testables = { buildMarkdown, buildCsv, slugify, csvField };
