import { format, lastDayOfMonth, parseISO } from "date-fns";

import type {
  Activity,
  ActivityOverride,
  ActivityParticipant,
  ActivitySchedule,
  PaymentHistory,
  SchoolShiftAnchor,
} from "@/types/database";
import { resolveBlocksInRange } from "@/utils/activity";
import { srLocale, subtractMonth } from "@/utils/date";

/**
 * Per-month "termini held vs. money paid" breakdown for an activity with
 * linked payments — the read-only section in the activity edit dialog
 * ("Jun 2026 · 8 termina · 4.000 RSD").
 *
 * Pure (no React / Supabase) so it can be unit-tested against the schedule
 * resolver directly and reused server-side later (digests) without hooks.
 */

export interface ActivityMonthlySummary {
  /** YYYY-MM. */
  month: string;
  /** Display label, e.g. "Jun 2026" (Serbian-Latin, capitalized). */
  label: string;
  /** Termini actually held that month — see `computeActivityMonthlySummaries`. */
  heldSessions: number;
  /** RSD paid across the linked payments, bucketed by the history row's due month. */
  paidTotal: number;
}

/** "Jun 2026" — date-fns gives the lowercase standalone month; capitalize it. */
function monthLabel(month: string): string {
  const raw = format(parseISO(month + "-01T12:00:00"), "LLLL yyyy", { locale: srLocale });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Compute the monthly breakdown for `currentMonth` and the `monthsBack`
 * months before it, newest first.
 *
 * Held sessions: the activity's schedule is expanded month by month through
 * `resolveBlocksInRange` (the same resolver the week grid and agenda use, so
 * A/B patterns, "every N weeks", the season window, and pauses all apply),
 * then reduced to DISTINCT termini — one `(rule, date)` slot counts once no
 * matter how many siblings attend it. A slot is "held" when at least one
 * participant's block is neither canceled nor a moved-away ghost; a termin
 * rescheduled to a different day counts in the month of its NEW date (the
 * resolver emits the moved-here block there).
 *
 * Paid total: `payment_history` rows with `status: 'paid'` belonging to
 * `linkedPaymentIds`, bucketed by the month of their `due_date` — matching
 * the payments page, whose month filter groups history by due date rather
 * than by the day the button was pressed.
 *
 * The family-wide `schedule` / `participants` / `overrides` arrays can be
 * passed as-is — rules of other activities are skipped by the resolver.
 */
export function computeActivityMonthlySummaries(args: {
  activity: Activity;
  schedule: ReadonlyArray<ActivitySchedule>;
  participants: ReadonlyArray<ActivityParticipant>;
  shiftAnchorsByPersonId: ReadonlyMap<string, SchoolShiftAnchor>;
  overrides?: ReadonlyArray<ActivityOverride>;
  /** Ids of the payments linked to this activity. */
  linkedPaymentIds: ReadonlySet<string>;
  history: ReadonlyArray<Pick<PaymentHistory, "payment_id" | "due_date" | "amount" | "status">>;
  /** Anchor month (YYYY-MM) — normally the current month. */
  currentMonth: string;
  /** How many months back from `currentMonth` to include. Default 6. */
  monthsBack?: number;
}): ActivityMonthlySummary[] {
  const {
    activity,
    schedule,
    participants,
    shiftAnchorsByPersonId,
    overrides = [],
    linkedPaymentIds,
    history,
    currentMonth,
    monthsBack = 6,
  } = args;

  const summaries: ActivityMonthlySummary[] = [];
  for (let i = 0; i <= monthsBack; i++) {
    const month = subtractMonth(currentMonth + "-01", i).slice(0, 7);
    const from = `${month}-01`;
    const to = format(lastDayOfMonth(parseISO(from + "T12:00:00")), "yyyy-MM-dd");

    const blocks = resolveBlocksInRange({
      from,
      to,
      activities: [activity],
      schedule,
      participants,
      shiftAnchorsByPersonId,
      overrides,
    });

    // Distinct (rule, date) slots with at least one attending participant.
    const heldSlots = new Set<string>();
    for (const block of blocks) {
      if (block.override?.action === "cancel") continue;
      // A moved-away ghost stays on the original date only as a marker — the
      // real termin is the moved-here block on `override_date`.
      if (block.override?.movedTo) continue;
      heldSlots.add(`${block.scheduleId}|${block.date}`);
    }

    let paidTotal = 0;
    for (const entry of history) {
      if (entry.status !== "paid") continue;
      if (!linkedPaymentIds.has(entry.payment_id)) continue;
      if (!entry.due_date.startsWith(month)) continue;
      paidTotal += entry.amount;
    }

    summaries.push({ month, label: monthLabel(month), heldSessions: heldSlots.size, paidTotal });
  }

  return summaries;
}
