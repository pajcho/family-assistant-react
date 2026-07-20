import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { QrCodeIcon } from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CurrencyToggle,
  ExchangeRateRow,
  useCurrencyAmount,
} from "@/components/common/CurrencyAmountField";
import { PaymentLinkField, type PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import { categoryIcon } from "@/components/budget/categoryIcons";
import type { Expense } from "@/types/database";
import { useCurrencyOptions } from "@/hooks/useCurrencySettings";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { fallbackColorForProfile } from "@/utils/activity";
import { currencySymbol, parseDecimal } from "@/utils/currency";
import { getDisplayName } from "@/utils/identity";
import { cn } from "@/lib/cn";

/** Submit shape for the quick-add / edit expense form. */
export type ExpenseFormPayload = {
  /** Always RSD — foreign entries are converted here, at submit time. */
  amount: number;
  /** What the member entered in ("RSD" | "EUR"). */
  currency: string;
  /** Typed amount + frozen NBS rate for foreign entries; null for RSD. */
  original_amount: number | null;
  exchange_rate: number | null;
  category_id: string | null;
  spent_on: string;
  person_id: string | null;
  note: string | null;
  activity_id: string | null;
  event_id: string | null;
};

export type ExpenseFormProps = {
  /** Present when editing a manual expense; omit/null when adding. */
  expense?: Expense | null;
  saving?: boolean;
  onSubmit: (payload: ExpenseFormPayload) => void;
  onCancel: () => void;
  /** When adding, offers a "Skeniraj račun" shortcut into the receipt scanner. */
  onScanReceipt?: () => void;
};

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function initialLink(expense: Expense | null | undefined): PaymentLinkValue | null {
  if (expense?.activity_id) return { kind: "activity", id: expense.activity_id };
  if (expense?.event_id) return { kind: "event", id: expense.event_id };
  return null;
}

type FormState = {
  amount: string;
  category_id: string | null;
  spent_on: string | null;
  person_id: string | null;
  note: string;
  link: PaymentLinkValue | null;
};

function initialState(expense: Expense | null | undefined): FormState {
  const foreign = !!expense && expense.currency !== "RSD" && expense.original_amount != null;
  return {
    // Foreign rows edit in their original currency; `amount` (RSD) is derived.
    amount: foreign
      ? String(expense.original_amount)
      : expense?.amount != null
        ? String(expense.amount)
        : "",
    category_id: expense?.category_id ?? null,
    spent_on: expense?.spent_on ?? todayISO(),
    person_id: expense?.person_id ?? null,
    note: expense?.note ?? "",
    link: initialLink(expense),
  };
}

/**
 * Quick-add (and edit) form for an expense, optimised for a ~5-second entry:
 * a big autofocused amount field with the numeric keypad, then a tappable grid
 * of category chips, then "Dodaj". Everything below (date defaults to danas,
 * person, note, link) is optional.
 */
export function ExpenseForm({
  expense,
  saving = false,
  onSubmit,
  onCancel,
  onScanReceipt,
}: ExpenseFormProps) {
  const { categories } = useExpenseCategories();
  const { members } = useFamilyMembers();
  const [form, setForm] = useState<FormState>(() => initialState(expense));
  const ca = useCurrencyAmount(expense, form.spent_on);
  // Offers the family's enabled currencies + this expense's own (so rows in a
  // since-disabled currency still edit cleanly).
  const currencies = useCurrencyOptions(expense?.currency);
  const { reset: resetCurrency } = ca;

  useEffect(() => {
    setForm(initialState(expense));
    resetCurrency(expense?.currency, expense?.exchange_rate);
  }, [expense, resetCurrency]);

  // NOT the `autoFocus` attribute: that focuses while the vaul drawer is
  // still animating in, so iOS "reveals" the field against mid-flight
  // geometry and leaves the sheet's inner container over-scrolled (amount
  // field ends up above the fold, and dragging to fix it dismisses the
  // drawer). Focus only after the enter animation settles, without letting
  // the browser scroll, then pin the sheet's scroll container to its top.
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const input = amountRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      for (let node = input.parentElement; node; node = node.parentElement) {
        if (node.scrollHeight > node.clientHeight) {
          node.scrollTop = 0;
          break;
        }
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, []);

  const isEdit = !!expense?.id;

  const amountNum = parseDecimal(form.amount);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!(amountNum > 0) || !form.spent_on) return;
    // Foreign entries freeze the conversion HERE: the typed amount + rate are
    // kept verbatim, `amount` becomes the RSD value every aggregation sums.
    const frozen = ca.freeze(amountNum);
    if (!frozen) return;
    onSubmit({
      ...frozen,
      category_id: form.category_id,
      spent_on: form.spent_on,
      person_id: form.person_id,
      note: form.note.trim() || null,
      activity_id: form.link?.kind === "activity" ? form.link.id : null,
      event_id: form.link?.kind === "event" ? form.link.id : null,
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {/* Scan a fiscal receipt instead of typing (add mode only). */}
      {onScanReceipt && !isEdit ? (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onScanReceipt}
          disabled={saving}
        >
          <QrCodeIcon className="size-4" />
          Skeniraj račun
        </Button>
      ) : null}

      {/* Amount — the star of the quick-add. Big, autofocused, numeric keypad.
          RSD stays the default; picking EUR reveals the NBS-rate row (what gets
          STORED as `amount` is always the converted RSD). */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="expense-amount">Iznos *</Label>
          <CurrencyToggle value={ca.currency} onChange={ca.setCurrency} options={currencies} />
        </div>
        <div className="relative">
          <Input
            id="expense-amount"
            ref={amountRef}
            value={form.amount}
            onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
            inputMode="decimal"
            required
            placeholder="0"
            className="h-14 pr-14 text-right text-3xl font-semibold tabular-nums"
          />
          <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-muted-foreground">
            {currencySymbol(ca.currency)}
          </span>
        </div>

        {/* NBS-rate row (foreign only): editable rate + live RSD preview, with
            a graceful manual fallback when the rate service is unreachable. */}
        <ExchangeRateRow control={ca} amountNum={amountNum} inputId="expense-rate" />
      </div>

      {/* Category — tappable grid of colored chips. */}
      <div className="space-y-2">
        <Label>Kategorija</Label>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nema kategorija.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {categories.map((c) => {
              const selected = form.category_id === c.id;
              const Icon = categoryIcon(c.icon);
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setForm((s) => ({ ...s, category_id: selected ? null : c.id }))}
                  aria-pressed={selected}
                  style={
                    selected ? { backgroundColor: `${c.color}1F`, borderColor: c.color } : undefined
                  }
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                    selected
                      ? "text-gray-900 dark:text-gray-100"
                      : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
                  )}
                >
                  <Icon className="size-5 shrink-0" style={{ color: c.color }} />
                  <span className="w-full truncate text-[11px] leading-tight">{c.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Date — defaults to danas. */}
      <div className="space-y-2">
        <Label htmlFor="expense-date">Datum</Label>
        <DatePicker
          id="expense-date"
          value={form.spent_on}
          onChange={(value) => setForm((s) => ({ ...s, spent_on: value }))}
          placeholder="Datum troška"
        />
      </div>

      {/* Person — optional single-select chips. */}
      {members.length > 0 ? (
        <div className="space-y-2">
          <Label>Za koga (opciono)</Label>
          <div className="flex flex-wrap gap-2">
            {members.map((person) => {
              const selected = form.person_id === person.id;
              const color = person.color ?? fallbackColorForProfile(person.id);
              const name =
                getDisplayName({
                  firstName: person.first_name,
                  lastName: person.last_name,
                  email: null,
                }) || "Bez imena";
              return (
                <button
                  type="button"
                  key={person.id}
                  onClick={() => setForm((s) => ({ ...s, person_id: selected ? null : person.id }))}
                  aria-pressed={selected}
                  style={
                    selected ? { backgroundColor: `${color}1F`, borderColor: color } : undefined
                  }
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                    selected
                      ? "text-gray-900 dark:text-gray-100"
                      : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
                  )}
                >
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Note. */}
      <div className="space-y-2">
        <Label htmlFor="expense-note">Beleška</Label>
        <Input
          id="expense-note"
          value={form.note}
          onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
          placeholder="npr. pijaca"
        />
      </div>

      {/* Optional link to an activity / event (reuses the payments combobox). */}
      <PaymentLinkField value={form.link} onChange={(link) => setForm((s) => ({ ...s, link }))} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Odustani
        </Button>
        <Button type="submit" disabled={saving}>
          {isEdit ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    </form>
  );
}
