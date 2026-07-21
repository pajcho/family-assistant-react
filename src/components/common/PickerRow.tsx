import type { ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";

/**
 * The "Brzi unos" picker row: a tappable row with a title, a summary of the
 * current selection and a "›" chevron, opening a sub-view in the same sheet
 * (SheetStack). One shape for Tip plaćanja, Kategorija and Više detalja —
 * the mobile replacement for inline selects/grids on long entry forms.
 */
export type PickerRowProps = {
  title: string;
  /** Current selection, rendered under the title ("Mesečno · promenljiv iznos"). */
  summary?: ReactNode;
  /** Leading icon, sized by the caller (usually `size-4`). */
  icon?: ReactNode;
  /** Set-fields badge (Više detalja); hidden when 0/undefined. */
  count?: number;
  onClick: () => void;
  disabled?: boolean;
};

export function PickerRow({ title, summary, icon, count, onClick, disabled }: PickerRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border border-input px-3.5 py-2.5 text-left transition-colors",
        "hover:bg-gray-50 dark:hover:bg-gray-800/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {summary ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            {summary}
          </span>
        ) : null}
      </span>
      {count ? (
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">
          {count}
        </span>
      ) : null}
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
