import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  AdjustmentsHorizontalIcon,
  QrCodeIcon,
  TagIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/components/ui/responsive-dialog";
import {
  CurrencyToggle,
  ExchangeRateRow,
  type CurrencyAmountControl,
} from "@/components/common/CurrencyAmountField";
import { DateField } from "@/components/common/DateField";
import {
  AmountInputCard,
  Chip,
  ChipRow,
  FieldGroupLabel,
  FormInput,
  Tile,
  TileGrid,
} from "@/components/common/FormControls";
import { PickerRow } from "@/components/common/PickerRow";
import { PaymentLinkField, type PaymentLinkValue } from "@/components/payments/PaymentLinkField";
import { categoryIcon } from "@/components/budget/categoryIcons";
import type { Expense } from "@/types/database";
import { useCurrencyOptions } from "@/hooks/useCurrencySettings";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";
import { useFamilyMembers } from "@/hooks/useFamilyMembers";
import { fallbackColorForProfile } from "@/utils/activity";
import { currencySymbol, parseDecimal } from "@/utils/currency";
import { getDisplayName } from "@/utils/identity";

/** Submit shape for the quick-add / edit expense form. */
export type ExpenseFormPayload = {
  /** Always RSD - foreign entries are converted here, at submit time. */
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

export type ExpenseFormState = {
  amount: string;
  category_id: string | null;
  spent_on: string | null;
  person_id: string | null;
  note: string;
  link: PaymentLinkValue | null;
};

/** Mobile sub-views the form's picker rows can open - see ExpenseFormDialog. */
export type ExpenseFormViewKind = "category" | "details";

/**
 * Expenses link only to activities/events - `expenses` has no birthday column
 * (payments cover the poklon case), so the link pickers must not offer them.
 */
export const EXPENSE_LINK_KINDS = ["activity", "event"] as const;

/**
 * An expense's stored link as the pickers' value shape. Shared with the
 * receipt surfaces - a scanned expense links exactly like a typed one.
 */
export function expenseLinkValue(expense: Expense | null | undefined): PaymentLinkValue | null {
  if (expense?.activity_id) return { kind: "activity", id: expense.activity_id };
  if (expense?.event_id) return { kind: "event", id: expense.event_id };
  return null;
}

/** Seed for the dialog-owned form state; `today` pre-fills spent_on when adding. */
export function initialExpenseFormState(
  expense: Expense | null | undefined,
  today: string,
): ExpenseFormState {
  const foreign = !!expense && expense.currency !== "RSD" && expense.original_amount != null;
  return {
    // Foreign rows edit in their original currency; `amount` (RSD) is derived.
    amount: foreign
      ? String(expense.original_amount)
      : expense?.amount != null
        ? String(expense.amount)
        : "",
    category_id: expense?.category_id ?? null,
    spent_on: expense?.spent_on ?? today,
    person_id: expense?.person_id ?? null,
    note: expense?.note ?? "",
    link: expenseLinkValue(expense),
  };
}

/**
 * Optional single-select person chips ("Za koga") - shared by the desktop
 * layout and the mobile Detalji sub-sheet. Self-fetches the roster; renders
 * nothing for single-member families with no one to pick.
 */
export function ExpensePersonSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (personId: string | null) => void;
}) {
  const { members } = useFamilyMembers();
  if (members.length === 0) return null;
  return (
    <div>
      <FieldGroupLabel>Za koga (opciono)</FieldGroupLabel>
      <ChipRow role="group" aria-label="Za koga">
        {members.map((person) => {
          const selected = value === person.id;
          const color = person.color ?? fallbackColorForProfile(person.id);
          const name =
            getDisplayName({
              firstName: person.first_name,
              lastName: person.last_name,
              email: null,
            }) || "Bez imena";
          return (
            <Chip
              key={person.id}
              selected={selected}
              onClick={() => onChange(selected ? null : person.id)}
              // Member chips keep their own fruit colour on selection - the
              // one place a chip isn't the app accent.
              style={selected ? { backgroundColor: `${color}1F`, borderColor: color } : undefined}
              className={selected ? "text-foreground" : undefined}
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span className="truncate">{name}</span>
              </span>
            </Chip>
          );
        })}
      </ChipRow>
    </div>
  );
}

export type ExpenseFormProps = {
  /** Dialog-owned state - survives a sub-view opening over the form. */
  form: ExpenseFormState;
  setForm: Dispatch<SetStateAction<ExpenseFormState>>;
  /** Dialog-owned currency control (same reason). */
  ca: CurrencyAmountControl;
  /** Present when editing a manual expense; omit/null when adding. */
  expense?: Expense | null;
  saving?: boolean;
  onSubmit: (payload: ExpenseFormPayload) => void;
  onCancel: () => void;
  /** When adding, offers a "Skeniraj račun" shortcut into the receipt scanner. */
  onScanReceipt?: () => void;
  /**
   * When editing a manual expense, offers the same shortcut with the opposite
   * meaning: scan the receipt for a row that already exists, so it picks up
   * the real amount and its items. Hosts that can't run the scanner omit it.
   */
  onAttachReceipt?: () => void;
  /** Mobile "Brzi unos" row pushes the Detalji sub-view (dialog's SheetStack). */
  onOpenView: (view: ExpenseFormViewKind) => void;
  /**
   * When editing, opens the delete confirm (the dialog pushes a "delete"
   * sub-view). Renders the bottom-left "Obriši" in the desktop footer; absent
   * while adding.
   */
  onRequestDelete?: () => void;
};

/**
 * Quick-add (and edit) form for an expense, optimised for a ~5-second entry:
 * a big amount field with the numeric keypad (no autofocus - the member picks
 * where to start), then a tappable grid of category chips, then "Dodaj".
 *
 * Mobile (<sm) - the "Brzi unos" layout: Iznos, Kategorija grid and Datum
 * (danas + Juče/Prekjuče chips) stay inline; Za koga, Beleška and Poveži sa
 * move behind a "Više detalja" row into a sub-view. The Odustani/Dodaj bar
 * is pinned by the dialog below the scroll area.
 *
 * Desktop (sm+) - the classic fully-expanded layout, unchanged.
 */
export function ExpenseForm({
  form,
  setForm,
  ca,
  expense,
  saving = false,
  onSubmit,
  onCancel,
  onScanReceipt,
  onAttachReceipt,
  onOpenView,
  onRequestDelete,
}: ExpenseFormProps) {
  const isDesktop = useIsDesktop();
  const { categories } = useExpenseCategories();
  const { members } = useFamilyMembers();
  // Offers the family's enabled currencies + this expense's own (so rows in a
  // since-disabled currency still edit cleanly).
  const currencies = useCurrencyOptions(expense?.currency);

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

  // Same row, two jobs. Adding: scan instead of typing. Editing a manual row:
  // scan the receipt you found afterwards - the amount and the items come from
  // it, everything already on the row stays.
  const scanButton =
    !isEdit && onScanReceipt ? (
      <PickerRow
        dashed
        title="Skeniraj račun"
        summary="stavke stižu same"
        icon={<QrCodeIcon className="size-[17px]" />}
        onClick={onScanReceipt}
        disabled={saving}
      />
    ) : isEdit && onAttachReceipt ? (
      <PickerRow
        dashed
        title="Skeniraj račun"
        summary="uzmi iznos i stavke sa računa"
        icon={<QrCodeIcon className="size-[17px]" />}
        onClick={onAttachReceipt}
        disabled={saving}
      />
    ) : null;

  // The amount is the star of the quick-add: one big centred value with the
  // numeric keypad, the currency CODE right under it (never a symbol) and the
  // NBS conversion line only when it applies.
  const amountField = (
    <AmountInputCard
      id="expense-amount"
      label="Iznos *"
      value={form.amount}
      onChange={(amount) => setForm((s) => ({ ...s, amount }))}
      currencyCode={currencySymbol(ca.currency)}
      currencyToggle={
        <CurrencyToggle value={ca.currency} onChange={ca.setCurrency} options={currencies} />
      }
      // NBS-rate row (foreign only): editable rate + live RSD preview, with a
      // graceful manual fallback when the rate service is unreachable.
      footer={<ExchangeRateRow control={ca} amountNum={amountNum} inputId="expense-rate" />}
    />
  );

  const categoryField = (
    <div>
      <FieldGroupLabel>Kategorija</FieldGroupLabel>
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nema kategorija.</p>
      ) : (
        <TileGrid>
          {categories.map((c) => {
            const selected = form.category_id === c.id;
            return (
              <Tile
                key={c.id}
                icon={categoryIcon(c.icon)}
                iconColor={c.color ?? undefined}
                label={c.name}
                selected={selected}
                onClick={() => setForm((s) => ({ ...s, category_id: selected ? null : c.id }))}
                style={
                  selected ? { backgroundColor: `${c.color}1F`, borderColor: c.color } : undefined
                }
                className={selected ? "text-foreground" : undefined}
              />
            );
          })}
        </TileGrid>
      )}
    </div>
  );

  if (!isDesktop) {
    // --- Mobile: "Brzi unos" ---
    const selectedCategory = form.category_id
      ? categories.find((c) => c.id === form.category_id)
      : null;
    const detailParts: string[] = [];
    if (form.person_id) {
      const person = members.find((m) => m.id === form.person_id);
      const name = person
        ? getDisplayName({
            firstName: person.first_name,
            lastName: person.last_name,
            email: null,
          })
        : null;
      detailParts.push(name || "Za koga ✓");
    }
    if (form.note.trim()) detailParts.push("Beleška ✓");
    if (form.link) detailParts.push("Povezano ✓");
    const detailCount = (form.person_id ? 1 : 0) + (form.note.trim() ? 1 : 0) + (form.link ? 1 : 0);

    return (
      <form id="expense-form" className="space-y-3" onSubmit={handleSubmit}>
        {scanButton}
        {amountField}
        <DateField
          id="expense-date"
          label="Datum"
          mode="past"
          value={form.spent_on}
          onChange={(value) => setForm((s) => ({ ...s, spent_on: value }))}
          placeholder="Datum troška"
        />
        <div className="space-y-2">
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
                  return <Icon className="size-[17px]" style={{ color: selectedCategory.color }} />;
                })()
              ) : (
                <TagIcon className="size-[17px]" />
              )
            }
            onClick={() => onOpenView("category")}
          />
          <PickerRow
            title="Više detalja"
            summary={
              detailParts.length > 0 ? detailParts.join(" · ") : "Za koga · beleška · poveži sa"
            }
            icon={<AdjustmentsHorizontalIcon className="size-[17px]" />}
            count={detailCount}
            onClick={() => onOpenView("details")}
          />
        </div>
      </form>
    );
  }

  // --- Desktop: fully-expanded layout, same field order ---
  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      {/* Scan a fiscal receipt instead of typing (add mode only). */}
      {scanButton}

      {/* Amount - the star of the quick-add. Big, numeric keypad. RSD stays
          the default; picking EUR reveals the NBS-rate row (what gets STORED
          as `amount` is always the converted RSD). */}
      {amountField}

      {/* Category - tappable grid of colored tiles. */}
      {categoryField}

      {/* Date - defaults to danas. */}
      <DateField
        id="expense-date"
        label="Datum"
        mode="past"
        value={form.spent_on}
        onChange={(value) => setForm((s) => ({ ...s, spent_on: value }))}
        placeholder="Datum troška"
      />

      {/* Person - optional single-select chips. */}
      <ExpensePersonSelect
        value={form.person_id}
        onChange={(person_id) => setForm((s) => ({ ...s, person_id }))}
      />

      {/* Note. */}
      <div>
        <FieldGroupLabel>
          <label htmlFor="expense-note">Beleška</label>
        </FieldGroupLabel>
        <FormInput
          id="expense-note"
          value={form.note}
          onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
          placeholder="npr. pijaca"
        />
      </div>

      {/* Optional link to an activity / event (reuses the payments combobox).
          An expense has no name field, so the beleška is what the suggestions
          read - the date does the heavy lifting here. */}
      <PaymentLinkField
        value={form.link}
        onChange={(link) => setForm((s) => ({ ...s, link }))}
        kinds={EXPENSE_LINK_KINDS}
        suggest={isEdit ? null : { name: form.note, date: form.spent_on }}
      />

      <div className="flex items-center justify-between gap-2 pt-2">
        {onRequestDelete ? (
          <Button
            type="button"
            variant="ghost"
            className="text-neg hover:bg-neg-soft hover:text-neg"
            onClick={onRequestDelete}
            disabled={saving}
          >
            <TrashIcon className="size-4" />
            Obriši
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Odustani
          </Button>
          <Button type="submit" disabled={saving}>
            {isEdit ? "Sačuvaj izmene" : "Dodaj"}
          </Button>
        </div>
      </div>
    </form>
  );
}
