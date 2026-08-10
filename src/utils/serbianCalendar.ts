/**
 * The Serbian calendar name tables, in one place.
 *
 * These were maintained in three copies (the date picker, the kid shell, the
 * budget page) and had already drifted in casing. Everything here is stored
 * LOWERCASE - nominative, the way the names read mid-sentence ("5. oktobar") -
 * and a caller that needs a capitalized title-case form derives it, so there is
 * never a second table to keep in sync.
 */

/** Month names, nominative: "januar" ... "decembar". */
export const MONTHS_LONG_SR = [
  "januar",
  "februar",
  "mart",
  "april",
  "maj",
  "jun",
  "jul",
  "avgust",
  "septembar",
  "oktobar",
  "novembar",
  "decembar",
] as const;

/** Short month labels: "jan" ... "dec". */
export const MONTHS_SHORT_SR = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "avg",
  "sep",
  "okt",
  "nov",
  "dec",
] as const;

/** Weekday headers, Monday first (the app's week starts on Monday). */
export const WEEKDAY_SHORT_SR = ["pon", "uto", "sre", "čet", "pet", "sub", "ned"] as const;
