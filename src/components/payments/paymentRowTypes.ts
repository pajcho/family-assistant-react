import type {
  Payment,
  PaymentHistoryStatus,
  PaymentOverride,
  RecurrencePeriod,
} from "@/types/database";

/* --- Discriminated union of /payments list-item shapes (mirrors Vue source) ---
 *
 * The payments list interleaves three row kinds, distinguished by `type`:
 *   - "payment"  — a live occurrence (the current due of a series / one-time).
 *   - "history"  — a past paid or skipped occurrence, frozen in payment_history.
 *   - "upcoming" — a projected future repetition, synthesized client-side.
 *
 * `computeCombinedList` in the route builds them; `PaymentTimeline` renders them.
 */

export type PaymentRowItem = Payment & {
  type: "payment";
  /** Original projected due date — the override key. Equals due_date when not moved. */
  occurrenceDate: string;
  override?: PaymentOverride | null;
};

export type HistoryRowItem = {
  type: "history";
  id: string;
  payment_id: string;
  name: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  status: PaymentHistoryStatus;
  note: string | null;
  /** Only the latest history entry shows the Undo action. */
  isLast: boolean;
};

export type UpcomingRowItem = {
  type: "upcoming";
  id: string;
  paymentId: string;
  name: string;
  amount: number;
  /** Effective (displayed) date — override_date when rescheduled, else the occurrence. */
  due_date: string;
  /** Original projected due date — the override key. */
  occurrenceDate: string;
  override?: PaymentOverride | null;
  description: string | null;
  recurrence_period: RecurrencePeriod | null;
  recurrence_interval: number;
  remaining_occurrences: number | null;
};

export type PaymentListItemUnion = PaymentRowItem | HistoryRowItem | UpcomingRowItem;
