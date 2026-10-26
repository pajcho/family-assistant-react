import { Chip, ChipRow, FormInput } from "@/components/common/FormControls";
import { Label } from "@/components/ui/label";
import { parseDecimal, sanitizeDecimalInput } from "@/utils/currency";

/**
 * The fields of an expense EXTRA - money spent together with a receipt but
 * missing from it, the cash tip being the case it exists for. Shared by the
 * scan preview (add a tip before saving) and the receipt detail (add or edit
 * one afterwards). Fully controlled; the host owns the draft.
 *
 * The percent chips round to whole tens of dinars, the way a tip is actually
 * left on the table.
 */

export type ExpenseExtraDraft = { amount: string; note: string };

/** What a new extra starts as: the tip, since that is what it is for. */
export const NEW_EXTRA_DRAFT: ExpenseExtraDraft = { amount: "", note: "Bakšiš" };

const TIP_PERCENTS = [5, 10, 15] as const;

function tipFor(base: number, percent: number): number {
  return Math.max(10, Math.round((base * percent) / 1000) * 10);
}

/** The draft's amount when it is a valid positive number, else null. */
export function extraDraftAmount(draft: ExpenseExtraDraft): number | null {
  const amount = parseDecimal(draft.amount);
  return amount > 0 ? Math.round(amount * 100) / 100 : null;
}

export function ReceiptExtraFields({
  idPrefix,
  draft,
  onChange,
  baseAmount,
  disabled,
}: {
  idPrefix: string;
  draft: ExpenseExtraDraft;
  onChange: (draft: ExpenseExtraDraft) => void;
  /** The receipt amount the percent chips are taken from. */
  baseAmount: number;
  disabled?: boolean;
}) {
  const typed = extraDraftAmount(draft);
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-amount`}>Iznos</Label>
        <div className="relative">
          <FormInput
            id={`${idPrefix}-amount`}
            value={draft.amount}
            onChange={(e) => onChange({ ...draft, amount: sanitizeDecimalInput(e.target.value) })}
            inputMode="decimal"
            placeholder="0"
            disabled={disabled}
            className="pr-14 text-right font-bold tabular-nums"
          />
          <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm font-medium text-muted-foreground/75">
            RSD
          </span>
        </div>
        {baseAmount > 0 ? (
          <ChipRow>
            {TIP_PERCENTS.map((percent) => {
              const value = tipFor(baseAmount, percent);
              return (
                <Chip
                  key={percent}
                  selected={typed === value}
                  hint={value.toLocaleString("sr-Latn-RS")}
                  disabled={disabled}
                  onClick={() => onChange({ ...draft, amount: String(value) })}
                >
                  {percent}%
                </Chip>
              );
            })}
          </ChipRow>
        ) : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-note`}>Naziv</Label>
        <FormInput
          id={`${idPrefix}-note`}
          value={draft.note}
          onChange={(e) => onChange({ ...draft, note: e.target.value })}
          placeholder="npr. bakšiš, parking, dostava"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
