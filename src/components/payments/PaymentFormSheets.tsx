import type { Dispatch, SetStateAction } from "react";
import { ArrowPathIcon, CheckIcon, PauseIcon } from "@heroicons/react/24/outline";

import { NativeSelect } from "@/components/ui/native-select";
import { PAYMENT_REMINDER_OPTIONS, ReminderSelect } from "@/components/ui/reminder-select";
import { FieldGroupLabel, FormInput } from "@/components/common/FormControls";
import { MemberMultiSelect } from "@/components/common/MemberMultiSelect";
import { SwitchRow } from "@/components/common/SwitchRow";
import { PaymentLinkField } from "@/components/payments/PaymentLinkField";
import {
  MONTHLY_INTERVAL_OPTIONS,
  RECURRENCE_OPTIONS,
  WEEKLY_INTERVAL_OPTIONS,
  type PaymentFormState,
} from "@/components/payments/PaymentForm";
import { cn } from "@/lib/cn";

/**
 * The mobile "Brzi unos" sub-views for the payment form. Both are dumb
 * editors over the dialog-owned {@link PaymentFormState} - the SheetStack
 * "←" is the only way out, so everything commits as it's tapped.
 */

type SheetProps = {
  form: PaymentFormState;
  setForm: Dispatch<SetStateAction<PaymentFormState>>;
};

/**
 * Payment type: the recurrence-type option list plus everything conditioned
 * on it (repeat, remaining instalments, variable amount, pause) - all of
 * "how this payment repeats" in one place. Stays open after a selection: the
 * conditional settings below are the reason the user came here.
 */
export function PaymentTipSheet({
  form,
  setForm,
  hasHistory,
  isEdit,
}: SheetProps & { hasHistory: boolean; isEdit: boolean }) {
  const isRecurring = form.recurrence_period !== "one-time";
  const showIntervalSelect =
    form.recurrence_period === "weekly" || form.recurrence_period === "monthly";
  const intervalOptions =
    form.recurrence_period === "weekly" ? WEEKLY_INTERVAL_OPTIONS : MONTHLY_INTERVAL_OPTIONS;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {RECURRENCE_OPTIONS.map((option) => {
          const selected = form.recurrence_period === option.value;
          return (
            <button
              type="button"
              key={option.value}
              disabled={hasHistory}
              aria-pressed={selected}
              onClick={() =>
                setForm((s) => ({
                  ...s,
                  recurrence_period: option.value,
                  // Always reset to 1 - weekly/monthly intervals don't share a
                  // scale, and for one-time/limited it's ignored on submit.
                  recurrence_interval: 1,
                }))
              }
              className={cn(
                "flex min-h-11 w-full items-center justify-between rounded-lg border bg-card px-3.5 py-2.5 text-sm font-normal transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
                "disabled:pointer-events-none disabled:opacity-50",
                selected
                  ? "border-accent bg-accent-soft text-accent-deep"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {option.label}
              {selected ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {hasHistory ? (
        <p className="text-xs font-normal text-warn">
          Tip plaćanja se ne može menjati jer postoji istorija plaćanja.
        </p>
      ) : null}
      {showIntervalSelect ? (
        <div>
          <FieldGroupLabel>
            <label htmlFor="recurrence_interval">Ponavljanje</label>
          </FieldGroupLabel>
          <NativeSelect
            id="recurrence_interval"
            value={form.recurrence_interval}
            onChange={(next) => setForm((s) => ({ ...s, recurrence_interval: next }))}
            options={intervalOptions}
            parse={(raw) => Number(raw)}
          />
        </div>
      ) : null}
      {form.recurrence_period === "limited" ? (
        <div>
          <FieldGroupLabel>
            <label htmlFor="remaining">Preostalo uplata</label>
          </FieldGroupLabel>
          <FormInput
            id="remaining"
            value={form.remaining_occurrences}
            onChange={(e) => setForm((s) => ({ ...s, remaining_occurrences: e.target.value }))}
            type="number"
            min="1"
            placeholder="npr. 4"
          />
        </div>
      ) : null}
      {isRecurring ? (
        <SwitchRow
          icon={ArrowPathIcon}
          title="Promenljiv iznos"
          description="Iznos je okvirni - tačan potvrđuješ pri svakom plaćanju (režije)."
          checked={form.is_variable_amount}
          onChange={(is_variable_amount) => setForm((s) => ({ ...s, is_variable_amount }))}
        />
      ) : null}
      {isEdit && isRecurring ? (
        <SwitchRow
          icon={PauseIcon}
          title="Pauziraj plaćanje"
          description="Dok je pauzirano, plaćanje se ne prikazuje kao dospelo."
          checked={form.is_paused}
          onChange={(is_paused) => setForm((s) => ({ ...s, is_paused }))}
        />
      ) : null}
    </div>
  );
}

/**
 * More details: the rarely-used optional fields (description, person, link,
 * Podsetnik). Set values surface back on the picker row as a summary.
 */
export function PaymentDetailsSheet({
  form,
  setForm,
  isEdit,
  onOpenLink,
}: SheetProps & { isEdit: boolean; onOpenLink: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <FieldGroupLabel>
          <label htmlFor="description">Opis</label>
        </FieldGroupLabel>
        <FormInput
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
        // Only suggest while ADDING - an edited payment's name matching its
        // own (or another) entity is noise, not a signal.
        suggest={isEdit ? null : { name: form.name, date: form.due_date }}
        // This sheet is mobile-only: the picker opens as a sub-view of the
        // same dialog instead of a popover the keyboard would shove around.
        onOpenPicker={onOpenLink}
      />
      <div>
        <FieldGroupLabel>
          <label htmlFor="payment-reminder">Podsetnik</label>
        </FieldGroupLabel>
        <ReminderSelect
          id="payment-reminder"
          value={form.remind_days_before}
          onChange={(value) => setForm((s) => ({ ...s, remind_days_before: value }))}
          options={PAYMENT_REMINDER_OPTIONS}
        />
      </div>
    </div>
  );
}
