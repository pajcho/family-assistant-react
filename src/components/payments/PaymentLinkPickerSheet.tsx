import { useMemo, useState } from "react";
import { CheckIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { Input } from "@/components/ui/input";
import { MemberBadges } from "@/components/common/MemberBadges";
import { PaymentLinkIcon } from "@/components/payments/PaymentLinkChip";
import {
  usePaymentLinkOptions,
  type LinkOption,
  type PaymentLinkValue,
} from "@/components/payments/PaymentLinkField";
import type { PaymentLinkKind } from "@/hooks/usePaymentLinks";
import { formatDate } from "@/utils/date";
import { cn } from "@/lib/cn";

export type PaymentLinkPickerSheetProps = {
  value: PaymentLinkValue | null;
  onChange: (value: PaymentLinkValue | null) => void;
  /** Called after a pick / unlink - the hosting dialog pops back a level. */
  onDone: () => void;
  /** Which link kinds are offered (expense forms exclude birthdays). */
  kinds?: ReadonlyArray<PaymentLinkKind>;
};

const GROUPS: ReadonlyArray<{ kind: PaymentLinkKind; label: string }> = [
  { kind: "activity", label: "Aktivnosti" },
  { kind: "event", label: "Događaji" },
  { kind: "birthday", label: "Rođendani" },
];

/**
 * Full-sheet "Poveži sa" picker - the mobile replacement for the
 * `PaymentLinkField` popover, which the software keyboard shoves off-screen
 * inside a bottom sheet. Rendered as a sheet-stack sub-view ("←" pops back):
 * a search box (no autofocus - tapping it is the member's choice), then the
 * grouped scrollable option list. Tapping an option links it and pops back;
 * the current link is check-marked and can be removed via "Ukloni vezu".
 */
export function PaymentLinkPickerSheet({
  value,
  onChange,
  onDone,
  kinds,
}: PaymentLinkPickerSheetProps) {
  const [query, setQuery] = useState("");
  const options = usePaymentLinkOptions(kinds);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  const pick = (option: LinkOption) => {
    onChange({ kind: option.kind, id: option.id });
    onDone();
  };

  const renderOption = (option: LinkOption) => {
    const isSelected = !!value && value.kind === option.kind && value.id === option.id;
    return (
      <li key={`${option.kind}-${option.id}`}>
        <button
          type="button"
          onClick={() => pick(option)}
          aria-pressed={isSelected}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
            isSelected ? "border-blue-600 bg-blue-600/10" : "border-border hover:bg-muted",
          )}
        >
          <PaymentLinkIcon kind={option.kind} className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-foreground">{option.name}</span>
          {option.personIds.length > 0 ? (
            <MemberBadges personIds={option.personIds} size="xs" max={3} className="shrink-0" />
          ) : null}
          {option.date ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDate(option.date)}
            </span>
          ) : null}
          {isSelected ? (
            <CheckIcon
              className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
              aria-hidden="true"
            />
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Pretraži…"
        aria-label="Pretraži aktivnosti, događaje i rođendane"
      />

      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange(null);
            onDone();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
        >
          <XMarkIcon className="size-4 shrink-0" />
          Ukloni vezu
        </button>
      ) : null}

      {filtered.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Nema rezultata.</p>
      ) : (
        GROUPS.map(({ kind, label }) => {
          const group = filtered.filter((o) => o.kind === kind);
          if (group.length === 0) return null;
          return (
            <div key={kind} className="space-y-2">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {label}
              </p>
              <ul className="space-y-2">{group.map(renderOption)}</ul>
            </div>
          );
        })
      )}
    </div>
  );
}
