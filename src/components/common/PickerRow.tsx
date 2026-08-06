import type { ComponentProps, ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

import { cn } from "@/lib/cn";

/**
 * The redesign's field row (".prow"): a tappable card-height row with an icon,
 * a label on the left and the current selection on the right, plus a "›"
 * chevron. It is the single shape behind every "opens something else" field -
 * Kategorija, Datum, Vreme, Poveži sa, Više detalja - on both the mobile
 * sheets and the desktop forms.
 *
 * `min-h-11` (44px) is the floor for every instance: these rows are the main
 * tap targets of the entry forms.
 */
export type PickerRowProps = Omit<ComponentProps<"button">, "value" | "title"> & {
  title: ReactNode;
  /** Current selection, right-aligned ("Mesečno · promenljiv iznos"). */
  summary?: ReactNode;
  /** Leading icon, sized by the caller (usually `size-[17px]`). */
  icon?: ReactNode;
  /** Set-fields badge (Više detalja); hidden when 0/undefined. */
  count?: number;
  /** Hide the trailing chevron for rows that act instead of drilling in. */
  chevron?: boolean;
  /** Dashed border for the "add something" affordance (Skeniraj račun, Dodaj termin). */
  dashed?: boolean;
};

export function PickerRow({
  title,
  summary,
  icon,
  count,
  chevron = true,
  dashed = false,
  className,
  ...props
}: PickerRowProps) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5 text-left transition-colors",
        dashed ? "border-dashed border-border" : "border-border",
        "hover:bg-muted",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      <span className="flex-1 text-sm font-normal">{title}</span>
      {summary ? (
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-normal text-muted-foreground">
          {summary}
        </span>
      ) : null}
      {count ? (
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
          {count}
        </span>
      ) : null}
      {chevron ? (
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      ) : null}
    </button>
  );
}

/** Two picker rows side by side (Početak / Kraj). */
export function PickerRowPair({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 [&>*]:min-w-0 [&>*]:flex-1">{children}</div>;
}
