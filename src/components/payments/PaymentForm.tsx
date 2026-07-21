import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  AdjustmentsHorizontalIcon,
  ArrowPathIcon,
  BanknotesIcon,
  TagIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PAYMENT_REMINDER_OPTIONS, ReminderSelect } from "@/components/ui/reminder-select";
import { useIsDesktop } from "@/components/ui/responsive-dialog";
import {
  CurrencyToggle,
  ExchangeRateRow,
  type CurrencyAmountControl,
} from "@/components/common/CurrencyAmountField";
import { DateQuickPick } from "@/components/common/DateQuickPick";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import { PickerRow } from "@/components/common/PickerRow";
import { categoryIcon } from "@/components/budget/categoryIcons";
import { CategorySelect } from "@/components/budget/CategorySelect";
import { PaymentLinkField, type PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import type { Payment, RecurrencePeriod } from "@/types/database";
import { useCurrencyOptions } from "@/hooks/useCurrencySettings";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { currencySymbol, parseDecimal } from "@/utils/currency";
import { getDisplayName } from "@/utils/identity";
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

export type PaymentFormState = {
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

/** Mobile sub-views the form's picker rows can open — see PaymentFormDialog. */
export type PaymentFormViewKind = "tip" | "category" | "details";

export const RECURRENCE_OPTIONS: ReadonlyArray<{ value: RecurrencePeriod; label: string }> = [
  { value: "one-time", label: "Jednokratno" },
  { value: "weekly", label: "Nedeljno" },
  { value: "monthly", label: "Mesečno" },
  { value: "limited", label: "Ograničeno" },
];

export const WEEKLY_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "Svake nedelje" },
  { value: 2, label: "Svake 2 nedelje" },
  { value: 3, label: "Svake 3 nedelje" },
  { value: 4, label: "Svake 4 nedelje" },
];

export const MONTHLY_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "Svakog meseca" },
  { value: 2, label: "Svaka 2 meseca" },
  { value: 3, label: "Svaka 3 meseca" },
  { value: 6, label: "Svakih 6 meseci" },
];

function initialLink(payment: Payment | null | undefined): PaymentLinkValue | null {
  if (payment?.activity_id) return { kind: "activity", id: payment.activity_id };
  if (payment?.event_id) return { kind: "event", id: payment.event_id };
  if (payment?.birthday_id) return { kind: "birthday", id: payment.birthday_id };
  return null;
}

/**
 * Seed for the dialog-owned form state. `today` (yyyy-MM-dd) pre-fills the
 * due date when ADDING — the most common due date is "danas", and the quick
 * chips / picker make any other date one tap away.
 */
export function initialPaymentFormState(
  payment: Payment | null | undefined,
  personIds: string[],
  today: string,
): PaymentFormState {
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
    due_date: payment?.due_date ?? today,
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

/** "Mesečno · svaka 2 meseca · promenljiv iznos · pauzirano" — the Tip row summary. */
export function recurrenceSummary(form: PaymentFormState): string {
  const parts: string[] = [
    RECURRENCE_OPTIONS.find((o) => o.value === form.recurrence_period)?.label ?? "",
  ];
  if (form.recurrence_period === "weekly" || form.recurrence_period === "monthly") {
    const options =
      form.recurrence_period === "weekly" ? WEEKLY_INTERVAL_OPTIONS : MONTHLY_INTERVAL_OPTIONS;
    const interval = options.find((o) => o.value === form.recurrence_interval);
    if (interval && form.recurrence_interval !== 1) parts.push(interval.label.toLowerCase());
  }
  if (form.recurrence_period === "limited") {
    parts.push(`još ${form.remaining_occurrences || "?"} uplata`);
  }
  if (form.recurrence_period !== "one-time") {
    if (form.is_variable_amount) parts.push("promenljiv iznos");
    if (form.is_paused) parts.push("pauzirano");
  }
  return parts.filter(Boolean).join(" · ");
}

export type PaymentFormProps = {
  /** Dialog-owned state — survives the SheetStack mobile close→reopen hop. */
  form: PaymentFormState;
  setForm: Dispatch<SetStateAction<PaymentFormState>>;
  /** Dialog-owned currency control (same reason). */
  ca: CurrencyAmountControl;
  payment?: Payment | null;
  /** When true, the recurrence type select becomes disabled (history exists). */
  hasHistory?: boolean;
  saving?: boolean;
  onSubmit: (payload: PaymentFormPayload) => void;
  onCancel: () => void;
  /** Mobile "Brzi unos" rows push these sub-views (owned by the dialog's SheetStack). */
  onOpenView: (view: PaymentFormViewKind) => void;
};

/**
 * Mobile (<sm) — the "Brzi unos" layout: the three always-typed fields
 * (Naziv, big Iznos, Datum with quick chips), then three picker rows (Tip
 * plaćanja / Kategorija / Više detalja) opening sub-views in the same sheet,
 * with a sticky Odustani/Dodaj footer.
 *
 * Desktop (sm+) — the classic fully-expanded layout, unchanged:
 *   • Naziv / Opis — full width
 *   • Za koga — assignee pills (optional)
 *   • Poveži sa — link combobox to one activity/event (optional)
 *   • Kategorija — native select
 *   • Tip — native select, disabled when `hasHistory`; gates Ponavljanje /
 *     Preostalo uplata / Promenljiv iznos below it
 *   • Iznos — label + currency toggle row, NBS-rate row for foreign entries
 *   • Datum dospeća, Pauziraj (edit+recurring), Podsetnik
 *   • Right-aligned footer (Odustani / Sačuvaj izmene | Dodaj)
 */
export function PaymentForm({
  form,
  setForm,
  ca,
  payment,
  hasHistory = false,
  saving = false,
  onSubmit,
  onCancel,
  onOpenView,
}: PaymentFormProps) {
  const isDesktop = useIsDesktop();
  // Offers the family's enabled currencies + this payment's own (so payments in
  // a since-disabled currency still edit cleanly).
  const currencies = useCurrencyOptions(payment?.currency);
  // Row summaries (mobile). Both hooks read already-cached family queries.
  const { categories } = useExpenseCategories();
  const { members } = useFamilyMembers();

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

  const amountLabel = form.is_variable_amount ? "Okvirni iznos *" : "Iznos *";

  if (!isDesktop) {
    // ——— Mobile: "Brzi unos" ———
    const selectedCategory = form.category_id
      ? categories.find((c) => c.id === form.category_id)
      : null;

    const detailParts: string[] = [];
    if (form.description.trim()) detailParts.push("Opis ✓");
    if (form.personIds.length > 0) {
      const names = form.personIds
        .map((id) => {
          const person = members.find((m) => m.id === id);
          return person
            ? getDisplayName({
                firstName: person.first_name,
                lastName: person.last_name,
                email: null,
              })
            : null;
        })
        .filter(Boolean);
      detailParts.push(names.length > 0 ? names.join(", ") : `Za koga: ${form.personIds.length}`);
    }
    if (form.link) detailParts.push("Povezano ✓");
    if (form.remind_days_before != null) {
      const reminder = PAYMENT_REMINDER_OPTIONS.find((o) => o.value === form.remind_days_before);
      if (reminder) detailParts.push(reminder.label);
    }
    const detailCount =
      (form.description.trim() ? 1 : 0) +
      (form.personIds.length > 0 ? 1 : 0) +
      (form.link ? 1 : 0) +
      (form.remind_days_before != null ? 1 : 0);

    return (
      <form id="payment-form" className="space-y-4" onSubmit={handleSubmit}>
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
        {/* Amount — the star, mirroring ExpenseForm's quick-add field. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="amount">{amountLabel}</Label>
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
              className="h-14 pr-14 text-right text-3xl font-semibold tabular-nums"
            />
            <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-muted-foreground">
              {currencySymbol(ca.currency)}
            </span>
          </div>
          <ExchangeRateRow
            control={ca}
            amountNum={parseDecimal(form.amount)}
            inputId="payment-rate"
          />
        </div>
        <DateQuickPick
          id="due_date"
          label="Datum dospeća *"
          value={form.due_date}
          onChange={(value) => setForm((s) => ({ ...s, due_date: value }))}
          placeholder="Datum dospeća"
        />
        <div className="space-y-2">
          <PickerRow
            title="Tip plaćanja"
            summary={recurrenceSummary(form)}
            icon={
              form.recurrence_period === "one-time" ? (
                <BanknotesIcon className="size-4" />
              ) : (
                <ArrowPathIcon className="size-4" />
              )
            }
            onClick={() => onOpenView("tip")}
          />
          <PickerRow
            title="Kategorija"
            summary={
              selectedCategory ? (
                <span className="truncate">{selectedCategory.name}</span>
              ) : (
                "Bez kategorije"
              )
            }
            icon={
              selectedCategory ? (
                (() => {
                  const Icon = categoryIcon(selectedCategory.icon);
                  return <Icon className="size-4" style={{ color: selectedCategory.color }} />;
                })()
              ) : (
                <TagIcon className="size-4" />
              )
            }
            onClick={() => onOpenView("category")}
          />
          <PickerRow
            title="Više detalja"
            summary={
              detailParts.length > 0
                ? detailParts.join(" · ")
                : "Opis · za koga · poveži sa · podsetnik"
            }
            icon={<AdjustmentsHorizontalIcon className="size-4" />}
            count={detailCount}
            onClick={() => onOpenView("details")}
          />
        </div>
      </form>
    );
  }

  // ——— Desktop: classic fully-expanded layout (unchanged) ———
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
          share the row, the input carries the currency symbol as a suffix,
          and the NBS-rate row slots directly underneath. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="amount">{amountLabel}</Label>
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
