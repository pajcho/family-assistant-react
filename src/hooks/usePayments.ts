import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Payment, PaymentHistory, RecurrencePeriod } from "@/types/database";
import { supabase } from "@/lib/supabase";
import { useProfile } from "@/hooks/useProfile";
import {
  addMonth,
  addWeek,
  dueDateInCurrentMonth,
  isDateBeforeToday,
  subtractMonth,
  subtractWeek,
} from "@/utils/date";

/**
 * Payments data hooks — direct port of `composables/usePayments.ts` from the
 * sibling Nuxt app, backed by TanStack Query + Supabase Realtime.
 *
 * Surface:
 *   - `usePaymentsList({ hidePaid? })`               — list query + realtime
 *   - `usePaymentHistory({ monthFilter? })`          — family-wide history query
 *   - `usePaymentHistoryByPaymentId(paymentId)`      — per-payment history query
 *   - `useCreatePayment()`                           — insert mutation
 *   - `useUpdatePayment()`                           — update mutation
 *   - `useDeletePayment()`                           — delete mutation
 *   - `useMarkPaymentPaid()`                         — multi-step "mark paid"
 *   - `useTogglePaymentPause()`                      — pause/unpause toggle
 *   - `useUndoLastPayment()`                         — multi-step revert
 *   - `hasPaymentHistory(paymentId)`                 — imperative async helper
 *   - `getLastHistoryEntry(paymentId)`               — imperative async helper
 *
 * The recurrence-period branching inside `markAsPaid` / `undoLastPayment`
 * mirrors the Vue source line-for-line. Do not paraphrase — getting it wrong
 * desyncs the DB.
 *
 * Realtime: a single channel subscribes to BOTH `payments` and `payment_history`
 * postgres_changes filtered by `family_id`. Any change invalidates both query
 * trees so the per-payment history query (keyed by paymentId alone) refreshes
 * via partial-key matching.
 */

export interface PaymentListFilters {
  hidePaid?: boolean;
}

export interface PaymentHistoryFilters {
  monthFilter?: string;
}

export type CreatePaymentInput = {
  name: string;
  description?: string | null;
  amount: number;
  due_date: string;
  is_recurring: boolean;
  recurrence_period: RecurrencePeriod | null;
  recurrence_interval?: number;
  remaining_occurrences?: number | null;
  remind_days_before?: number | null;
};

export type UpdatePaymentInput = Partial<
  Pick<
    Payment,
    | "name"
    | "description"
    | "amount"
    | "due_date"
    | "is_recurring"
    | "recurrence_period"
    | "recurrence_interval"
    | "remaining_occurrences"
    | "is_paused"
    | "remind_days_before"
  >
>;

async function fetchPayments(familyId: string, hidePaid: boolean): Promise<Payment[]> {
  let q = supabase
    .from("payments")
    .select("*")
    .eq("family_id", familyId)
    .order("due_date", { ascending: true });
  if (hidePaid) q = q.eq("is_paid", false);
  const { data, error } = await q;
  if (error) return [];
  return (data as Payment[]) ?? [];
}

async function fetchPaymentHistory(
  familyId: string,
  monthFilter?: string,
): Promise<PaymentHistory[]> {
  let q = supabase
    .from("payment_history")
    .select("*")
    .eq("family_id", familyId)
    .order("due_date", { ascending: true });
  if (monthFilter) {
    // Filter by month: monthFilter is "YYYY-MM" format
    const startDate = `${monthFilter}-01`;
    const [year, month] = monthFilter.split("-").map(Number);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
    q = q.gte("due_date", startDate).lt("due_date", endDate);
  }
  const { data, error } = await q;
  if (error) return [];
  return (data as PaymentHistory[]) ?? [];
}

async function fetchPaymentHistoryByPaymentId(paymentId: string): Promise<PaymentHistory[]> {
  const { data, error } = await supabase
    .from("payment_history")
    .select("*")
    .eq("payment_id", paymentId)
    .order("paid_date", { ascending: false });
  if (error) return [];
  return (data as PaymentHistory[]) ?? [];
}

/**
 * Imperative helper — called from inside mutations / UI handlers (e.g. the
 * payments page checks this before opening the edit dialog to disable the
 * recurrence-type radios). Not a React Query hook on purpose.
 */
export async function hasPaymentHistory(paymentId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("payment_history")
    .select("id", { count: "exact", head: true })
    .eq("payment_id", paymentId);
  if (error) return false;
  return (count ?? 0) > 0;
}

/**
 * Imperative helper — used by `undoLastPayment` to fetch the latest history
 * row for idempotency checks. Returns `null` when no history exists.
 */
export async function getLastHistoryEntry(paymentId: string): Promise<PaymentHistory | null> {
  const { data, error } = await supabase
    .from("payment_history")
    .select("*")
    .eq("payment_id", paymentId)
    .order("paid_date", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return data as PaymentHistory;
}

/**
 * Subscribes to realtime changes on BOTH `payments` and `payment_history`
 * tables. Invalidates the family-scoped query trees on every event so both
 * the list and history queries (including the per-payment history keyed by
 * `paymentId` alone) refresh via partial-key matching.
 */
function usePaymentsRealtime(familyId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!familyId) return;
    const channel = supabase
      .channel(`payments-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payments",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["payments", familyId] });
          void queryClient.invalidateQueries({ queryKey: ["payment_history"] });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_history",
          filter: `family_id=eq.${familyId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ["payments", familyId] });
          void queryClient.invalidateQueries({ queryKey: ["payment_history"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [familyId, queryClient]);
}

export function usePaymentsList(filters: PaymentListFilters = {}) {
  const { familyId } = useProfile();
  const hidePaid = filters.hidePaid ?? false;

  const query = useQuery({
    queryKey: ["payments", familyId, { hidePaid }],
    queryFn: () => fetchPayments(familyId as string, hidePaid),
    enabled: !!familyId,
  });

  usePaymentsRealtime(familyId);

  return query;
}

export function usePaymentHistory(filters: PaymentHistoryFilters = {}) {
  const { familyId } = useProfile();
  const { monthFilter } = filters;

  return useQuery({
    queryKey: ["payment_history", familyId, monthFilter],
    queryFn: () => fetchPaymentHistory(familyId as string, monthFilter),
    enabled: !!familyId,
  });
}

export function usePaymentHistoryByPaymentId(paymentId: string | null | undefined) {
  return useQuery({
    queryKey: ["payment_history", paymentId],
    queryFn: () => fetchPaymentHistoryByPaymentId(paymentId as string),
    enabled: !!paymentId,
  });
}

/**
 * Invalidate every query produced by this hook family. Mutations call this
 * on success so the list, family-wide history, and per-payment history all
 * refresh — the partial-key form for `payment_history` covers both shapes.
 */
function invalidateAll(
  queryClient: ReturnType<typeof useQueryClient>,
  familyId: string | null,
): void {
  void queryClient.invalidateQueries({ queryKey: ["payments", familyId] });
  void queryClient.invalidateQueries({ queryKey: ["payment_history"] });
}

export function useCreatePayment() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreatePaymentInput): Promise<Payment> => {
      if (!familyId) throw new Error("Nema porodice");
      const { data, error } = await supabase
        .from("payments")
        .insert({
          family_id: familyId,
          ...payload,
          is_paid: false,
          paid_date: null,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Payment;
    },
    onSuccess: () => {
      invalidateAll(queryClient, familyId);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri dodavanju plaćanja");
    },
  });
}

export function useUpdatePayment() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: string; payload: UpdatePaymentInput }): Promise<Payment> => {
      const { data, error } = await supabase
        .from("payments")
        .update(args.payload)
        .eq("id", args.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as Payment;
    },
    onSuccess: () => {
      invalidateAll(queryClient, familyId);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri izmeni plaćanja");
    },
  });
}

export function useDeletePayment() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("payments").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidateAll(queryClient, familyId);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri brisanju plaćanja");
    },
  });
}

/**
 * Multi-step "mark as paid":
 *   1. Read the live `payments` row.
 *   2. Insert a `payment_history` row capturing the snapshot.
 *   3. Update the live row based on `recurrence_period` + `recurrence_interval`:
 *      - one-time / non-recurring → `is_paid: true, paid_date: today`.
 *      - monthly → roll `due_date` forward `interval` months.
 *      - weekly → roll `due_date` forward `interval * 7` days.
 *      - limited → decrement `remaining_occurrences`; if it hits 0, finalize
 *        with `is_paid: true, paid_date: today, remaining_occurrences: 0`
 *        (do NOT advance `due_date`); otherwise advance `due_date` by one
 *        month and keep `is_paid: false`. Limited ignores `recurrence_interval`.
 *
 * Not transactional — supabase-js doesn't expose Postgres transactions.
 * If any step fails the toast surfaces it and realtime re-syncs state.
 */
export function useMarkPaymentPaid() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { data: row, error: fetchErr } = await supabase
        .from("payments")
        .select("*")
        .eq("id", id)
        .single();
      if (fetchErr || !row) throw new Error(fetchErr?.message ?? "Nije pronađeno");

      const now = new Date().toISOString();
      const period = row.recurrence_period as RecurrencePeriod | null;
      const isRecurring = row.is_recurring === true;
      const interval = Math.max(1, Number(row.recurrence_interval ?? 1));

      // Insert into payment_history before updating
      const { error: historyErr } = await supabase.from("payment_history").insert({
        payment_id: id,
        family_id: row.family_id,
        amount: row.amount,
        due_date: row.due_date,
        paid_date: now,
      });
      if (historyErr) throw new Error(historyErr.message);

      if (!isRecurring || period === "one-time") {
        const { error } = await supabase
          .from("payments")
          .update({ is_paid: true, paid_date: now })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }

      if (period === "monthly") {
        const { error } = await supabase
          .from("payments")
          .update({
            is_paid: false,
            paid_date: null,
            due_date: addMonth(row.due_date, interval),
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }

      if (period === "weekly") {
        const { error } = await supabase
          .from("payments")
          .update({
            is_paid: false,
            paid_date: null,
            due_date: addWeek(row.due_date, interval),
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }

      if (period === "limited") {
        const remaining = (row.remaining_occurrences ?? 1) - 1;
        if (remaining <= 0) {
          const { error } = await supabase
            .from("payments")
            .update({ is_paid: true, paid_date: now, remaining_occurrences: 0 })
            .eq("id", id);
          if (error) throw new Error(error.message);
          return;
        }
        const { error } = await supabase
          .from("payments")
          .update({
            is_paid: false,
            paid_date: null,
            due_date: addMonth(row.due_date),
            remaining_occurrences: remaining,
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
        return;
      }

      // Fallback: treat as one-time (matches Vue source's tail behaviour).
      const { error } = await supabase
        .from("payments")
        .update({ is_paid: true, paid_date: now })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidateAll(queryClient, familyId);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri označavanju plaćanja");
    },
  });
}

/**
 * Toggle the `is_paused` flag. When un-pausing a payment whose `due_date`
 * is already in the past, advance it to the equivalent calendar day in the
 * current month (via `dueDateInCurrentMonth`). Pausing never touches the
 * due date.
 */
export function useTogglePaymentPause() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { data: row, error: fetchErr } = await supabase
        .from("payments")
        .select("is_paused, due_date")
        .eq("id", id)
        .single();
      if (fetchErr || !row) throw new Error(fetchErr?.message ?? "Nije pronađeno");

      const willUnpause = row.is_paused === true;
      const updates: { is_paused: boolean; due_date?: string } = { is_paused: !row.is_paused };

      if (willUnpause && row.due_date && isDateBeforeToday(row.due_date)) {
        updates.due_date = dueDateInCurrentMonth(row.due_date);
      }

      const { error } = await supabase.from("payments").update(updates).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidateAll(queryClient, familyId);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri menjanju pauze");
    },
  });
}

/**
 * Multi-step "undo last payment":
 *   1. Read the live `payments` row.
 *   2. Read the last `payment_history` row for this payment. If none exists
 *      surface a friendly "već vraćeno" error — the entry has already been
 *      reverted on another device or in a previous attempt.
 *   3. Delete that history row.
 *   4. Revert the live row based on `recurrence_period`, guarded by an
 *      "already reverted" idempotency check: if the deleted history row's
 *      `due_date` matches the current live `due_date`, the previous attempt
 *      already rolled the live row back (only the history delete failed) —
 *      skip the write to avoid double-reverting.
 *
 * Revert rules:
 *   - one-time / non-recurring → `is_paid: false, paid_date: null`.
 *   - monthly → roll `due_date` back one month via `subtractMonth`.
 *   - limited → increment `remaining_occurrences`; if the payment was marked
 *     `is_paid: true` (because the prior mark-paid drove `remaining_occurrences`
 *     to 0), additionally flip `is_paid: false, paid_date: null`. Always roll
 *     `due_date` back.
 */
export function useUndoLastPayment() {
  const { familyId } = useProfile();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paymentId: string): Promise<void> => {
      // 1. Get payment details
      const { data: payment, error: paymentErr } = await supabase
        .from("payments")
        .select("*")
        .eq("id", paymentId)
        .single();
      if (paymentErr || !payment) {
        throw new Error(paymentErr?.message ?? "Plaćanje nije pronađeno");
      }

      // 2. Get the last history entry
      const lastHistory = await getLastHistoryEntry(paymentId);
      if (!lastHistory) {
        throw new Error("Nema istorije za poništavanje");
      }

      // 3. Delete the history entry
      const { error: deleteErr } = await supabase
        .from("payment_history")
        .delete()
        .eq("id", lastHistory.id);
      if (deleteErr) throw new Error(deleteErr.message);

      // 4. Revert payment state based on type
      const period = payment.recurrence_period as RecurrencePeriod | null;
      const isRecurring = payment.is_recurring === true;
      const interval = Math.max(1, Number(payment.recurrence_interval ?? 1));

      // Check if due_date was already reverted (history due_date matches current payment due_date)
      // This can happen if previous undo attempt failed to delete history but succeeded in reverting
      const alreadyReverted = lastHistory.due_date === payment.due_date;

      if (!isRecurring || period === "one-time") {
        // One-time: just mark as unpaid (only if not already reverted)
        if (!alreadyReverted) {
          const { error } = await supabase
            .from("payments")
            .update({ is_paid: false, paid_date: null })
            .eq("id", paymentId);
          if (error) throw new Error(error.message);
        }
        return;
      }

      if (period === "monthly") {
        // Monthly: move due_date back by interval months (only if not already reverted)
        if (!alreadyReverted) {
          const { error } = await supabase
            .from("payments")
            .update({
              due_date: subtractMonth(payment.due_date, interval),
            })
            .eq("id", paymentId);
          if (error) throw new Error(error.message);
        }
        return;
      }

      if (period === "weekly") {
        // Weekly: move due_date back by interval weeks (only if not already reverted)
        if (!alreadyReverted) {
          const { error } = await supabase
            .from("payments")
            .update({
              due_date: subtractWeek(payment.due_date, interval),
            })
            .eq("id", paymentId);
          if (error) throw new Error(error.message);
        }
        return;
      }

      if (period === "limited") {
        // Limited: move due_date back + increment remaining_occurrences (only if not already reverted)
        if (!alreadyReverted) {
          const updates: {
            due_date?: string;
            remaining_occurrences?: number;
            is_paid?: boolean;
            paid_date?: null;
          } = {};

          // If payment was marked as fully paid (is_paid=true), revert that
          if (payment.is_paid) {
            updates.is_paid = false;
            updates.paid_date = null;
          }

          // Move due_date back
          updates.due_date = subtractMonth(payment.due_date);

          // Increment remaining occurrences
          updates.remaining_occurrences = (payment.remaining_occurrences ?? 0) + 1;

          const { error } = await supabase.from("payments").update(updates).eq("id", paymentId);
          if (error) throw new Error(error.message);
        }
        return;
      }
    },
    onSuccess: () => {
      invalidateAll(queryClient, familyId);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Greška pri poništavanju plaćanja");
    },
  });
}
