import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAYMENT_REMINDER_OPTIONS, ReminderSelect } from "@/components/ui/reminder-select";
import {
  CurrencyToggle,
  ExchangeRateRow,
  useCurrencyAmount,
} from "@/components/common/CurrencyAmountField";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import { CategorySelect } from "@/components/budget/CategorySelect";
import { PaymentLinkField, type PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import type { Payment, RecurrencePeriod } from "@/types/database";
import { useCurrencyOptions } from "@/hooks/useCurrencySettings";
import { currencySymbol, parseDecimal } from "@/utils/currency";
import { cn } from "@/lib/cn";

/** Form payload — mirrors the Vue PaymentForm.vue submit shape. */
export type PaymentFormPayload = {
  name: string;
  description: string | null;
  /** Always RSD — foreign entries are converted here, at submit time. */
  amount: number;
  /** Currency the payment was entered in ("RSD" | "EUR" | …). */
  currency: string;
  /** Typed amount + frozen NBS rate for foreign entries; null for RSD. */
  original_amount: number | null;
  exchange_rate: number | null;
  due_date: string;
  is_recurring: boolean;
  recurrence_period: RecurrencePeriod;
  /** "Every N periods" — always present, defaults to 1 for one-time/limited. */
  recurrence_interval: number;
  remaining_occurrences?: number | null;
  /** Recurring bill with a per-period amount — see `Payment.is_variable_amount`. */
  is_variable_amount: boolean;
  is_paused?: boolean;
  remind_days_before: number | null;
  /** Linked activity — XOR with the other two; all null when unlinked. */
  activity_id: string | null;
  /** Linked event — XOR with the other two. */
  event_id: string | null;
  /** Linked birthday (poklon tracking) — XOR with the other two. */
  birthday_id: string | null;
  /** Optional budget category (inherited by each paid occurrence's auto-expense). */
  category_id: string | null;
  /** Family members the payment is for. Empty = unassigned (shared bill). */
  personIds: string[];
};

export type PaymentFormProps = {
  payment?: Payment | null;
  /** Assignees of the payment being edited; empty/omitted when adding. */
  initialPersonIds?: string[];
  /** When true, the recurrence type select becomes disabled (history exists). */
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
  recurrence_interval: number;
  /** kept as string for consistent controlled-input behavior */
  remaining_occurrences: string;
  /** Recurring bill with a per-period amount — see `Payment.is_variable_amount`. */
  is_variable_amount: boolean;
  is_paused: boolean;
  remind_days_before: number | null;
  /** Single Jira-style link to an activity or event — see PaymentLinkField. */
  link: PaymentLinkValue | null;
  /** Optional budget category id, or null for "Bez kategorije". */
  category_id: string | null;
  personIds: string[];
};

const RECURRENCE_OPTIONS: ReadonlyArray<{ value: RecurrencePeriod; label: string }> = [
  { value: "one-time", label: "Jednokratno" },
  { value: "weekly", label: "Nedeljno" },
  { value: "monthly", label: "Mesečno" },
  { value: "limited", label: "Ograničeno" },
];

const WEEKLY_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "Svake nedelje" },
  { value: 2, label: "Svake 2 nedelje" },
  { value: 3, label: "Svake 3 nedelje" },
  { value: 4, label: "Svake 4 nedelje" },
];

const MONTHLY_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "Svakog meseca" },
  { value: 2, label: "Svaka 2 meseca" },
  { value: 3, label: "Svaka 3 meseca" },
  { value: 6, label: "Svakih 6 meseci" },
];

/** Tailwind chrome that matches `<Input>` — reused for both native selects below. */
const SELECT_CHROME =
  "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent pr-9 pl-3 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

function NativeSelect<T extends string | number>({
  id,
  value,
  onChange,
  options,
  disabled,
  parse,
}: {
  id?: string;
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
  parse: (raw: string) => T;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={String(value)}
        onChange={(e) => onChange(parse(e.target.value))}
        disabled={disabled}
        className={SELECT_CHROME}
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)}>
            {opt.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-60"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

function initialLink(payment: Payment | null | undefined): PaymentLinkValue | null {
  if (payment?.activity_id) return { kind: "activity", id: payment.activity_id };
  if (payment?.event_id) return { kind: "event", id: payment.event_id };
  if (payment?.birthday_id) return { kind: "birthday", id: payment.birthday_id };
  return null;
}

function initialState(payment: Payment | null | undefined, personIds: string[]): FormState {
  const foreign = !!payment && payment.currency !== "RSD" && payment.original_amount != null;
  return {
    name: payment?.name ?? "",
    description: payment?.description ?? "",
    // Foreign payments edit in their original currency; `amount` (RSD) is derived.
    amount: foreign
      ? String(payment.original_amount)
      : payment?.amount != null
        ? String(payment.amount)
        : "",
    due_date: payment?.due_date ?? null,
    recurrence_period: (payment?.recurrence_period ?? "one-time") as RecurrencePeriod,
    recurrence_interval: payment?.recurrence_interval ?? 1,
    remaining_occurrences:
      payment?.remaining_occurrences != null ? String(payment.remaining_occurrences) : "4",
    is_variable_amount: payment?.is_variable_amount ?? false,
    is_paused: payment?.is_paused ?? false,
    remind_days_before: payment?.remind_days_before ?? null,
    link: initialLink(payment),
    category_id: payment?.category_id ?? null,
    personIds,
  };
}

/**
 * Layout:
 *   • Naziv / Opis — full width
 *   • Za koga — assignee pills (optional)
 *   • Poveži sa — link combobox to one activity/event (optional)
 *   • Tip — native select (Jednokratno / Nedeljno / Mesečno / Ograničeno).
 *     Disabled when `hasHistory` is true. Sits above Iznos because it gates the
 *     conditional fields that follow.
 *   • Ponavljanje — native select shown only for `weekly` / `monthly`. Lets
 *     the user pick "every N weeks" / "every N months".
 *   • Preostalo uplata — only when `recurrence_period === 'limited'`
 *   • Iznos — full width (label + currency toggle in one row, currency symbol
 *     as the input suffix, NBS-rate row underneath for foreign entries).
 *     Label becomes "Okvirni iznos" when the variable-amount toggle is on.
 *   • Promenljiv iznos — checkbox directly UNDER Iznos (it describes the
 *     amount); recurring payments only; marks the amount as a per-period
 *     default confirmed at mark-paid time.
 *   • Datum dospeća — full width.
 *   • Pauziraj plaćanje — only when editing a recurring (non one-time) payment
 *   • Right-aligned footer (Odustani / Sačuvaj izmene | Dodaj)
 */
export function PaymentForm({
  payment,
  initialPersonIds,
  hasHistory = false,
  saving = false,
  onSubmit,
  onCancel,
}: PaymentFormProps) {
  const [form, setForm] = useState<FormState>(() => initialState(payment, initialPersonIds ?? []));
  const ca = useCurrencyAmount(payment, form.due_date);
  // Offers the family's enabled currencies + this payment's own (so payments in
  // a since-disabled currency still edit cleanly).
  const currencies = useCurrencyOptions(payment?.currency);
  const { reset: resetCurrency } = ca;

  // Serialized so the effect reseeds when the assignees finish loading
  // without firing on every render from a fresh array reference.
  const personSeed = (initialPersonIds ?? []).join(",");

  useEffect(() => {
    setForm(initialState(payment, personSeed ? personSeed.split(",") : []));
    resetCurrency(payment?.currency, payment?.exchange_rate);
  }, [payment, personSeed, resetCurrency]);

  const isEdit = !!payment?.id;
  const isRecurring = form.recurrence_period !== "one-time";
  const showPauseToggle = isEdit && isRecurring;
  const showIntervalSelect =
    form.recurrence_period === "weekly" || form.recurrence_period === "monthly";

  const intervalOptions =
    form.recurrence_period === "weekly" ? WEEKLY_INTERVAL_OPTIONS : MONTHLY_INTERVAL_OPTIONS;

  const handleRecurrenceChange = (next: RecurrencePeriod) => {
    setForm((s) => ({
      ...s,
      recurrence_period: next,
      // Always reset to 1 — weekly/monthly intervals don't share a scale, and
      // for one-time/limited the interval is ignored on submit anyway.
      recurrence_interval: 1,
    }));
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const amountNum = parseDecimal(form.amount);
    if (!form.name.trim() || !form.due_date || !(amountNum > 0)) return;
    // Foreign entries freeze the conversion HERE (typed amount + NBS rate kept
    // verbatim, `amount` becomes RSD) — same contract as ExpenseForm.
    const frozen = ca.freeze(amountNum);
    if (!frozen) return;
    const remainingNum =
      form.remaining_occurrences === "" ? null : Number(form.remaining_occurrences);
    onSubmit({
      name: form.name.trim(),
      description: form.description.trim() || null,
      ...frozen,
      due_date: form.due_date,
      is_recurring: isRecurring,
      recurrence_period: form.recurrence_period,
      recurrence_interval: showIntervalSelect ? form.recurrence_interval : 1,
      remaining_occurrences: form.recurrence_period === "limited" ? (remainingNum ?? null) : null,
      // Variable amount is a recurring-only concept — never persist a stray flag
      // if the user toggled it on and then switched Tip back to one-time.
      is_variable_amount: isRecurring ? form.is_variable_amount : false,
      is_paused: isRecurring ? form.is_paused : false,
      remind_days_before: form.remind_days_before,
      activity_id: form.link?.kind === "activity" ? form.link.id : null,
      event_id: form.link?.kind === "event" ? form.link.id : null,
      birthday_id: form.link?.kind === "birthday" ? form.link.id : null,
      category_id: form.category_id,
      personIds: form.personIds,
    });
  };

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
      <MemberMultiSelect
        label="Za koga (opciono)"
        value={form.personIds}
        onChange={(personIds) => setForm((s) => ({ ...s, personIds }))}
      />
      <PaymentLinkField
        value={form.link}
        onChange={(link) => setForm((s) => ({ ...s, link }))}
        // Only suggest while ADDING — an edited payment's name matching its
        // own (or another) entity is noise, not a signal.
        suggestFromName={isEdit ? undefined : form.name}
      />
      <CategorySelect
        id="payment-category"
        value={form.category_id}
        onChange={(category_id) => setForm((s) => ({ ...s, category_id }))}
      />
      {/* Tip drives the conditional fields below it (Ponavljanje, Preostalo
          uplata, Promenljiv iznos), so it sits ABOVE Iznos/Datum — the birač
          comes first, then everything that depends on it. */}
      <div className={cn("grid gap-4", showIntervalSelect ? "grid-cols-2" : "grid-cols-1")}>
        <div className="space-y-2">
          <Label htmlFor="recurrence_period">Tip</Label>
          <NativeSelect
            id="recurrence_period"
            value={form.recurrence_period}
            onChange={handleRecurrenceChange}
            options={RECURRENCE_OPTIONS}
            disabled={hasHistory}
            parse={(raw) => raw as RecurrencePeriod}
          />
        </div>
        {showIntervalSelect ? (
          <div className="space-y-2">
            <Label htmlFor="recurrence_interval">Ponavljanje</Label>
            <NativeSelect
              id="recurrence_interval"
              value={form.recurrence_interval}
              onChange={(next) => setForm((s) => ({ ...s, recurrence_interval: next }))}
              options={intervalOptions}
              parse={(raw) => Number(raw)}
            />
          </div>
        ) : null}
      </div>
      {hasHistory ? (
        <p className="text-xs text-amber-600">
          Tip plaćanja se ne može menjati jer postoji istorija plaćanja.
        </p>
      ) : null}
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
      {/* Iznos — full-width, mirroring ExpenseForm: label and currency toggle
          share the row (the old [Iznos | Datum] grid squeezed the label into
          wrapping on mobile), the input carries the currency symbol as a
          suffix, and the NBS-rate row slots directly underneath. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="amount">{form.is_variable_amount ? "Okvirni iznos *" : "Iznos *"}</Label>
          <CurrencyToggle value={ca.currency} onChange={ca.setCurrency} options={currencies} />
        </div>
        <div className="relative">
          <Input
            id="amount"
            value={form.amount}
            onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
            inputMode="decimal"
            required
            placeholder="0"
            className="pr-12 text-right tabular-nums"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
            {currencySymbol(ca.currency)}
          </span>
        </div>
        <ExchangeRateRow
          control={ca}
          amountNum={parseDecimal(form.amount)}
          inputId="payment-rate"
        />
      </div>
      {/* Variable amount sits directly under Iznos — it describes the amount,
          not the date. Recurring-only concept (režije koje variraju); the
          toggle depends on the Tip value, not on whether the Tip select is
          enabled — so it still shows for a payment with history you want to
          convert to variable. */}
      {isRecurring ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.is_variable_amount}
              onChange={(e) => setForm((s) => ({ ...s, is_variable_amount: e.target.checked }))}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-700 dark:text-gray-200">Promenljiv iznos</span>
          </label>
          {form.is_variable_amount ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Uneseni iznos je okvirni — pri svakom označavanju kao plaćeno potvrđuješ tačan iznos.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="due_date">Datum dospeća *</Label>
        <DatePicker
          id="due_date"
          value={form.due_date}
          onChange={(value) => setForm((s) => ({ ...s, due_date: value }))}
          placeholder="Datum dospeća"
        />
      </div>
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
      <div className="space-y-2">
        <Label htmlFor="payment-reminder">Podsetnik</Label>
        <ReminderSelect
          id="payment-reminder"
          value={form.remind_days_before}
          onChange={(value) => setForm((s) => ({ ...s, remind_days_before: value }))}
          options={PAYMENT_REMINDER_OPTIONS}
        />
      </div>
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
