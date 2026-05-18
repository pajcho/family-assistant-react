import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Expense } from "@/types/database";

export type ExpenseFormPayload = {
  name: string;
  description: string | null;
  amount: number;
};

export type ExpenseFormProps = {
  expense?: Expense | null;
  saving?: boolean;
  onSubmit: (payload: ExpenseFormPayload) => void;
  onCancel: () => void;
};

type FormState = {
  name: string;
  description: string;
  /**
   * Stored as string so the controlled `<Input type="number">` doesn't fight
   * the user mid-typing (e.g. clearing the field, intermediate "0" values).
   * Parsed to a Number once at submit time.
   */
  amount: string;
};

function initialState(expense: Expense | null | undefined): FormState {
  return {
    name: expense?.name ?? "",
    description: expense?.description ?? "",
    amount: expense?.amount != null ? String(expense.amount) : "",
  };
}

/**
 * Direct port of `components/expenses/ExpenseForm.vue` from the sibling Nuxt app.
 *
 * Controlled inputs (per the migration plan's "no react-hook-form" stack
 * decision). Submitting fires `onSubmit` with a serialized payload — the
 * dialog wrapper owns the mutation call so this component stays pure.
 *
 * Validation matches the Vue source: name must be non-empty after trim,
 * amount must parse to a positive number. Invalid submits no-op silently
 * (the `required` + `type="number"` attributes handle the browser-level UX).
 */
export function ExpenseForm({ expense, saving = false, onSubmit, onCancel }: ExpenseFormProps) {
  const [form, setForm] = React.useState<FormState>(() => initialState(expense));

  // When the parent swaps `expense` (e.g. opening edit vs. switching between
  // expenses without unmounting the form), reseed local state. Mirrors Vue's
  // `watch(() => props.expense, ..., { immediate: true })`.
  React.useEffect(() => {
    setForm(initialState(expense));
  }, [expense]);

  const isEdit = !!expense?.id;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const amountNum = Number(form.amount);
    if (!form.name.trim() || !(amountNum > 0)) return;
    onSubmit({
      name: form.name.trim(),
      description: form.description.trim() || null,
      amount: amountNum,
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
          placeholder="npr. Novi laptop"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Opis</Label>
        <Input
          id="description"
          value={form.description}
          onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
          placeholder="detalji, specifikacije"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="amount">Iznos (RSD) *</Label>
        <Input
          id="amount"
          type="number"
          min="0"
          step="1"
          value={form.amount}
          onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
          required
        />
      </div>
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
