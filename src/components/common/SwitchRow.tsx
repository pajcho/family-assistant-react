import type { ComponentType, ReactNode, SVGProps } from "react";

import { cn } from "@/lib/cn";

/**
 * A bordered option card with a title, a one-line description and a toggle
 * switch on the right (".swrow2") - the redesign's replacement for bare
 * checkboxes (Promenljiv iznos, Pauziraj plaćanje, Više dana, Ceo dan). The
 * whole card is the tap target.
 */
export type SwitchRowProps = {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Leading glyph, matching the prototype's ".swrow2 svg". */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  icon: Icon,
}: SwitchRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={cn(
        "flex min-h-11 w-full items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5 text-left transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        checked ? "border-accent" : "border-border hover:bg-muted",
      )}
    >
      {Icon ? (
        <Icon className="size-[17px] shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      <Switch checked={checked} />
    </button>
  );
}

/** The switch glyph on its own, for rows that manage their own layout. */
export function Switch({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-pos" : "bg-border",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
          checked && "translate-x-5",
        )}
      />
    </span>
  );
}
