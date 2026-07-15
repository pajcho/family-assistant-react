import type { ComponentType, ReactNode, SVGProps } from "react";

import { cn } from "@/lib/cn";

/**
 * Pill-shaped boolean filter toggle — the chip idiom the events page
 * introduced for "Sakrij završene", extracted so every page's list filters
 * (plaćanja, događaji, rođendani) read the same. Sits inline with
 * PersonFilterChips; `aria-pressed` carries the state for screen readers.
 */
export type ToggleChipProps = {
  active: boolean;
  onToggle: () => void;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  children: ReactNode;
  className?: string;
};

export function ToggleChip({ active, onToggle, icon: Icon, children, className }: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
        "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none",
        active
          ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
          : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800",
        className,
      )}
    >
      {Icon ? (
        <Icon
          className={cn(
            "size-4 shrink-0",
            active ? "text-blue-500 dark:text-blue-400" : "text-gray-400 dark:text-gray-500",
          )}
        />
      ) : null}
      {children}
    </button>
  );
}
