import type { RecurrencePeriod } from "@/types/database";

/**
 * Short label for a payment's recurrence — used in list rows, dashboard cards,
 * and the detail popup. Returns the natural Serbian (Latin) phrasing based on
 * the period + interval combination.
 *
 *   one-time              → "Jednokratno"
 *   limited               → "Ograničeno"
 *   weekly, interval=1    → "Nedeljno"
 *   weekly, interval=2..4 → "Svake 2 nedelje" / "Svake 3 nedelje" / …
 *   monthly, interval=1   → "Mesečno"
 *   monthly, interval=2-4 → "Svaka 2 meseca" / "Svaka 3 meseca" / "Svaka 4 meseca"
 *   monthly, interval=5+  → "Svakih 6 meseci" / "Svakih 12 meseci" / …
 *
 * The 2-4 vs 5+ split for months follows Serbian paucal grammar: `dva/tri/četiri
 * meseca` (paucal) vs `pet meseci` (plural genitive). Weeks (nedelja, feminine)
 * use `nedelje` for all paucal values, which is what speakers actually say.
 */
export function recurrenceLabel(period: RecurrencePeriod | null, interval: number = 1): string {
  if (period === "one-time" || period == null) return "Jednokratno";
  if (period === "limited") return "Ograničeno";
  const n = Math.max(1, Math.floor(interval));

  if (period === "weekly") {
    if (n === 1) return "Nedeljno";
    return `Svake ${n} nedelje`;
  }

  if (period === "monthly") {
    if (n === 1) return "Mesečno";
    if (n >= 2 && n <= 4) return `Svaka ${n} meseca`;
    return `Svakih ${n} meseci`;
  }

  return "Jednokratno";
}
