import * as React from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Payment, RecurrencePeriod } from "@/types/database";
import { cn } from "@/lib/cn";

/** Form payload — mirrors the Vue PaymentForm.vue submit shape. */
export type PaymentFormPayload = {
  name: string;
  description: string | null;
  amount: number;
  due_date: string;
  is_recurring: boolean;
  recurrence_period: RecurrencePeriod;
  remaining_occurrences?: number | null;
  is_paused?: boolean;
};

export type PaymentFormProps = {
  payment?: Payment | null;
  /** When true, the recurrence radios become disabled (history exists). */
  hasHistory?: boolean;
  saving?: boolean;
  onSubmit: (payload: PaymentFormPayload) => void;
  onCancel: () => void;
};

type FormState = {
  name: string;
  description: string;
  /** kept as string so the controlled <input type="number"> can be empty */
  amount: string;
  due_date: string | null;
  recurrence_period: RecurrencePeriod;
  /** kept as string for consistent controlled-input behavior */
  remaining_occurrences: string;
  is_paused: boolean;
};

function initialState(payment: Payment | null | undefined): FormState {
  return {
    name: payment?.name ?? "",
    description: payment?.description ?? "",
    amount: payment?.amount != null ? String(payment.amount) : "",
    due_date: payment?.due_date ?? null,
    recurrence_period: (payment?.recurrence_period ?? "one-time") as RecurrencePeriod,
    remaining_occurrences:
      payment?.remaining_occurrences != null ? String(payment.remaining_occurrences) : "4",
    is_paused: payment?.is_paused ?? false,
  };
}

/**
 * Direct port of `components/payments/PaymentForm.vue` from the sibling Nuxt app.
 *
 * Layout (matches `.nuxt-screens/11-payment-edit-dialog-dark-mobile.png`):
 *   • Naziv / Opis — full width
 *   • Iznos (RSD) + Datum dospeća — `grid-cols-2` (2-column at all widths,
 *     just like the Vue source, which uses `grid grid-cols-2 gap-4` with no
 *     responsive prefix)
 *   • Tip — inline radios (Jednokratno / Mesečno / Ograničeno). Disabled
 *     when `hasHistory` is true.
 *   • Preostalo uplata — only when `recurrence_period === 'limited'`
 *   • Pauziraj plaćanje — only when editing a recurring (non one-time) payment
 *   • Right-aligned footer (Otkaži / Sačuvaj izmene | Dodaj)
 */
export function PaymentForm({
  payment,
  hasHistory = false,
  saving = false,
  onSubmit,
  onCancel,
}: PaymentFormProps) {
  const [form, setForm] = React.useState<FormState>(() => initialState(payment));

  // Reseed when the parent swaps `payment` (matches Vue's
  // `watch(() => props.payment, ..., { immediate: true })`).
  React.useEffect(() => {
    setForm(initialState(payment));
  }, [payment]);

  const isEdit = !!payment?.id;
  const isRecurring = form.recurrence_period !== "one-time";
  const showPauseToggle = isEdit && isRecurring;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const amountNum = Number(form.amount);
    if (!form.name.trim() || !form.due_date || !(amountNum > 0)) return;
    const remainingNum =
      form.remaining_occurrences === "" ? null : Number(form.remaining_occurrences);
    onSubmit({
      name: form.name.trim(),
      description: form.description.trim() || null,
      amount: amountNum,
      due_date: form.due_date,
      is_recurring: isRecurring,
      recurrence_period: form.recurrence_period,
      remaining_occurrences: form.recurrence_period === "limited" ? (remainingNum ?? null) : null,
      is_paused: isRecurring ? form.is_paused : false,
    });
  };

  const radioGroupName = React.useId();

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="name">Naziv *</Label>
        <Input
          id="name"
          value={form.name}
          onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
          required
          placeholder="npr. Internet račun"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Opis</Label>
        <Input
          id="description"
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
          placeholder="detalji plaćanja"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="amount">Iznos (RSD) *</Label>
          <Input
            id="amount"
            value={form.amount}
            onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
            type="number"
            min="0"
            step="1"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="due_date">Datum dospeća *</Label>
          <DatePicker
            id="due_date"
            value={form.due_date}
            onChange={(value) => setForm((s) => ({ ...s, due_date: value }))}
            placeholder="Datum dospeća"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Tip</Label>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={radioGroupName}
              value="one-time"
              checked={form.recurrence_period === "one-time"}
              onChange={() => setForm((s) => ({ ...s, recurrence_period: "one-time" }))}
              disabled={hasHistory}
            />
            <span className={cn(hasHistory && "text-gray-400")}>Jednokratno</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={radioGroupName}
              value="monthly"
              checked={form.recurrence_period === "monthly"}
              onChange={() => setForm((s) => ({ ...s, recurrence_period: "monthly" }))}
              disabled={hasHistory}
            />
            <span className={cn(hasHistory && "text-gray-400")}>Mesečno</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={radioGroupName}
              value="limited"
              checked={form.recurrence_period === "limited"}
              onChange={() => setForm((s) => ({ ...s, recurrence_period: "limited" }))}
              disabled={hasHistory}
            />
            <span className={cn(hasHistory && "text-gray-400")}>Ograničeno</span>
          </label>
        </div>
        {hasHistory ? (
          <p className="text-xs text-amber-600">
            Tip plaćanja se ne može menjati jer postoji istorija plaćanja.
          </p>
        ) : null}
      </div>
      {form.recurrence_period === "limited" ? (
        <div className="space-y-2">
          <Label htmlFor="remaining">Preostalo uplata</Label>
          <Input
            id="remaining"
            value={form.remaining_occurrences}
            onChange={(e) => setForm((s) => ({ ...s, remaining_occurrences: e.target.value }))}
            type="number"
            min="1"
            placeholder="npr. 4"
          />
        </div>
      ) : null}
      {showPauseToggle ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_paused}
              onChange={(e) => setForm((s) => ({ ...s, is_paused: e.target.checked }))}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">Pauziraj plaćanje</span>
          </label>
          {form.is_paused ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Dok je pauzirano, plaćanje se neće prikazivati kao dospelo.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Otkaži
        </Button>
        <Button type="submit" disabled={saving}>
          {isEdit ? "Sačuvaj izmene" : "Dodaj"}
        </Button>
      </div>
    </form>
  );
}
